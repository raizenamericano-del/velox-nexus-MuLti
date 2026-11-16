/* ==========================================================================
   VELOX NEXUS — GitHub module
   ZIP / folder / file → repository, plus a read-only repo browser.

   SECURITY MODEL
   ─ Token lives in a module-scoped variable. Optionally mirrored to
     sessionStorage ("ingat di tab ini"), which dies with the tab. It is never
     written to localStorage, never sent to this origin, and never logged.
   ─ Every request goes straight to api.github.com from the browser, so the
     token is not part of any server payload or server log.
   ─ Paths coming out of a ZIP are sanitised (no ../, no absolute paths, no
     backslashes) before they are used as blob paths, so a malicious archive
     cannot write outside the tree it declares.
   ─ Size/count caps come from /api/capabilities so the browser and the server
     agree on one set of limits.
   ========================================================================== */
'use strict';

(() => {
  const N = window.NEXUS;
  const { $, $$, esc, toast } = N;

  const API = 'https://api.github.com';
  const SS_KEY = 'velox.gh.token';
  const IDLE_LOCK_MS = 30 * 60 * 1000;
  const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
  const SKIP_PATHS = [/(^|\/)__MACOSX(\/|$)/, /(^|\/)\.git(\/|$)/, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/, /(^|\/)desktop\.ini$/i];

  const state = {
    token: null,
    user: null,
    scopes: [],
    files: [],          // [{ path, size, kind: 'file'|'zip-entry', file?, entry? }]
    zip: null,
    srcMode: 'zip',
    targetMode: 'new',
    busy: false,
    repos: [],
    reposLoaded: false,
    lastRepo: null,
  };

  // ── token storage ─────────────────────────────────────────────────────
  const readStoredToken = () => {
    try {
      const v = sessionStorage.getItem(SS_KEY);
      return v && /^(gh[pousr]_|github_pat_)/.test(v) ? v : null;
    } catch { return null; }
  };
  const storeToken = (value) => {
    try {
      if (value) sessionStorage.setItem(SS_KEY, value);
      else sessionStorage.removeItem(SS_KEY);
    } catch { /* private mode: stay in memory */ }
  };
  const setToken = (value, { remember = false } = {}) => {
    state.token = value || null;
    if (remember) storeToken(state.token);
    else storeToken(null);
    resetIdleTimer();
  };
  const clearToken = () => {
    state.token = null;
    state.user = null;
    state.scopes = [];
    storeToken(null);
  };

  // ── idle lock ─────────────────────────────────────────────────────────
  let idleTimer = null;
  let lastActivity = Date.now();

  function resetIdleTimer() {
    lastActivity = Date.now();
    clearTimeout(idleTimer);
    if (!state.token) return;
    idleTimer = setTimeout(() => {
      if (state.busy) { resetIdleTimer(); return; }
      if (Date.now() - lastActivity < IDLE_LOCK_MS - 1000) { resetIdleTimer(); return; }
      clearToken();
      renderGate();
      toast('warn', 'Token dikunci otomatis', 'Tidak ada aktivitas 30 menit. Masukkan token lagi untuk melanjutkan.', 7000);
    }, IDLE_LOCK_MS);
  }
  ['click', 'keydown', 'input'].forEach((evt) => document.addEventListener(evt, () => {
    if (state.token) { lastActivity = Date.now(); resetIdleTimer(); }
  }, { passive: true }));

  // ── GitHub client ─────────────────────────────────────────────────────
  class GhError extends Error {
    constructor(status, message, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }

  const friendly = (err) => {
    const s = err?.status;
    if (s === 401) return 'Token tidak valid atau sudah kedaluwarsa.';
    if (s === 403) {
      const m = String(err.message || '').toLowerCase();
      if (m.includes('rate limit')) return 'Rate limit GitHub tercapai. Tunggu beberapa menit.';
      const m2 = String(err.message || '').toLowerCase();
      if (m2.includes('not accessible') || m2.includes('resource not accessible')) {
        return 'Token tidak punya izin ini. Untuk membuat repo: Administration: Read and write + akses All repositories.';
      }
      return 'Akses ditolak. Pastikan token punya Contents: Read and write (dan Administration untuk membuat repo).';
    }
    if (s === 404) return 'Repository atau resource tidak ditemukan (atau tidak terlihat oleh token ini).';
    if (s === 409) return 'Branch ini berubah saat proses berjalan. Coba lagi.';
    if (s === 422) return err.message || 'Data ditolak GitHub (nama repo atau payload tidak valid).';
    if (s >= 500) return 'GitHub sedang bermasalah. Coba lagi sebentar.';
    return err?.message || 'Permintaan ke GitHub gagal.';
  };

  async function gh(path, { method = 'GET', body, accept = 'application/vnd.github+json', raw = false, allow404 = false } = {}) {
    if (!state.token) throw new GhError(401, 'Token belum diisi');
    const headers = {
      Authorization: `Bearer ${state.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (allow404 && res.status === 404) return { data: null, res };
    const text = await res.text();
    if (!res.ok) {
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
      throw new GhError(res.status, data?.message || `HTTP ${res.status}`, data);
    }
    if (raw) return { data: text, res };
    try { return { data: text ? JSON.parse(text) : null, res }; } catch { return { data: null, res }; }
  }

  // ── console ───────────────────────────────────────────────────────────
  function logLine(text, kind = '') {
    const host = $('#consoleBody');
    if (!host) return;
    if (host.querySelector('.console-muted')) host.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'console-line';
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    p.innerHTML = `<span class="t">${esc(time)}</span><span class="${kind}">${esc(text)}</span>`;
    host.appendChild(p);
    host.scrollTop = host.scrollHeight;
  }
  const setConsoleState = (value, label) => {
    const el = $('#consoleState');
    if (!el) return;
    el.dataset.state = value;
    el.textContent = label;
  };
  const setProgress = (ratio) => {
    const bar = $('#pushProgress');
    if (bar) bar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  };

  // ── helpers ───────────────────────────────────────────────────────────
  const toBase64 = (u8) => {
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(out);
  };

  const sanitizePath = (raw) => {
    let p = String(raw || '').replace(/\\/g, '/').trim();
    p = p.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!p) return null;
    if (p.includes('\u0000')) return null;
    const parts = p.split('/').filter((seg) => seg && seg !== '.');
    if (!parts.length) return null;
    if (parts.some((seg) => seg === '..')) return null;          // zip-slip
    if (parts.some((seg) => /^[a-zA-Z]:$/.test(seg))) return null; // windows drive
    p = parts.join('/');
    if (p.length > 400) return null;
    return p;
  };

  const skipPath = (p) => SKIP_PATHS.some((re) => re.test(p));

  const bytes = (n) => N.fmtBytes(n);

  // ── source picker ─────────────────────────────────────────────────────
  const limits = () => N.getCapabilities()?.github || {
    maxFileBytes: 45 * 1048576, maxFiles: 1500, maxTotalBytes: 220 * 1048576, maxNameLength: 100,
  };

  function setSrcMode(mode) {
    state.srcMode = mode;
    $$('.src-tab').forEach((b) => {
      const active = b.dataset.src === mode;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });
    const input = $('#fileInput');
    const title = $('#dropTitle');
    const hintText = $('#dropHint');
    input.value = '';
    input.removeAttribute('webkitdirectory');
    input.removeAttribute('directory');
    if (mode === 'zip') {
      input.accept = '.zip,application/zip';
      input.multiple = false;
      title.textContent = 'Lepas ZIP di sini';
      hintText.innerHTML = `atau klik untuk memilih file · maks <b id="dropLimit">${bytes(limits().maxFileBytes)}</b> total`;
    } else if (mode === 'folder') {
      input.accept = '';
      input.multiple = true;
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
      title.textContent = 'Pilih folder proyek';
      hintText.innerHTML = `semua file di dalamnya ikut · <b id="dropLimit">${bytes(limits().maxFileBytes)}</b>/file`;
    } else {
      input.accept = '';
      input.multiple = true;
      title.textContent = 'Pilih satu atau beberapa file';
      hintText.innerHTML = `bisa multi-pilih · <b id="dropLimit">${bytes(limits().maxFileBytes)}</b>/file`;
    }
    clearFiles();
  }

  function clearFiles() {
    state.files = [];
    state.zip = null;
    const list = $('#fileList');
    if (list) { list.hidden = true; list.innerHTML = ''; }
    const summary = $('#srcSummary');
    if (summary) summary.hidden = true;
    const badge = $('#srcBadge');
    if (badge) { badge.textContent = 'belum ada'; badge.dataset.state = ''; }
    updatePushButton();
  }

  function updatePushButton() {
    const btn = $('#pushBtn');
    if (!btn) return;
    const ok = !!state.token && state.files.length > 0 && !state.busy;
    btn.disabled = !ok;
  }

  async function acceptFileList(fileList) {
    const max = limits();
    const files = [...fileList];
    if (!files.length) return;

    if (state.srcMode === 'zip') {
      const file = files.find((f) => /\.zip$/i.test(f.name)) || files[0];
      if (!/\.zip$/i.test(file.name)) {
        toast('warn', 'Bukan file ZIP', 'Pilih file .zip, atau ganti tab ke Folder / File.');
        return;
      }
      if (file.size > max.maxTotalBytes) {
        toast('error', 'ZIP terlalu besar', `Maksimal ${bytes(max.maxTotalBytes)}.`);
        return;
      }
      try {
        logLine(`Membaca ${file.name} (${bytes(file.size)})…`);
        const zip = await JSZip.loadAsync(file);
        const entries = [];
        zip.forEach((path, entry) => {
          if (entry.dir) return;
          const clean = sanitizePath(path);
          if (!clean || skipPath(clean)) return;
          const size = entry._data?.uncompressedSize || 0;
          entries.push({ path: clean, size, kind: 'zip-entry', entry });
        });
        if (!entries.length) { toast('warn', 'ZIP kosong', 'Tidak ada file yang bisa dikirim.'); return; }
        state.zip = zip;
        state.files = entries;
        toast('ok', 'ZIP terbaca', `${entries.length} file siap dikirim.`);
      } catch (err) {
        toast('error', 'ZIP tidak bisa dibaca', err.message || 'File mungkin rusak atau terenkripsi.');
        clearFiles();
        return;
      }
    } else {
      const entries = [];
      for (const f of files) {
        const clean = sanitizePath(f.webkitRelativePath || f.name);
        if (!clean || skipPath(clean)) continue;
        entries.push({ path: clean, size: f.size, kind: 'file', file: f });
      }
      if (!entries.length) { toast('warn', 'Tidak ada file', 'Folder itu kosong.'); return; }
      state.zip = null;
      state.files = entries;
      toast('ok', 'Sumber siap', `${entries.length} file dipilih.`);
    }
    renderFiles();
  }

  function renderFiles() {
    const max = limits();
    const list = $('#fileList');
    const summary = $('#srcSummary');
    const badge = $('#srcBadge');
    if (!list) return;

    const total = state.files.reduce((a, f) => a + (f.size || 0), 0);
    const tooMany = state.files.length > max.maxFiles;
    const tooBig = total > max.maxTotalBytes;
    const oversized = state.files.filter((f) => f.size > max.maxFileBytes).length;

    list.hidden = false;
    list.innerHTML = state.files.slice(0, 200).map((f) => {
      const skip = f.size > max.maxFileBytes;
      return `<div class="file-row" data-skip="${skip}">
        <svg class="ico" aria-hidden="true"><use href="#i-file"/></svg>
        <span class="file-name">${esc(f.path)}</span>
        <span class="file-size">${esc(bytes(f.size))}</span>
      </div>`;
    }).join('') + (state.files.length > 200 ? `<div class="file-row"><span class="file-name">… dan ${state.files.length - 200} file lainnya</span></div>` : '');

    if (summary) {
      summary.hidden = false;
      $('#sumFiles').textContent = state.files.length.toLocaleString('id-ID');
      $('#sumSize').textContent = bytes(total);
      const biggest = state.files.reduce((a, f) => (f.size > (a?.size || 0) ? f : a), null);
      $('#sumBiggest').textContent = biggest ? bytes(biggest.size) : '—';
    }
    if (badge) {
      const blocked = tooMany || tooBig;
      badge.textContent = blocked ? 'melebihi batas' : `${state.files.length} file · ${bytes(total)}`;
      badge.dataset.state = blocked ? '' : 'ready';
    }
    if (tooMany) toast('warn', 'Terlalu banyak file', `Maksimal ${max.maxFiles} file per push.`);
    if (tooBig) toast('warn', 'Total terlalu besar', `Maksimal ${bytes(max.maxTotalBytes)} per push.`);
    if (oversized) toast('warn', `${oversized} file terlalu besar`, `File > ${bytes(max.maxFileBytes)} akan dilewati.`);
    updatePushButton();
  }

  // ── gate rendering ────────────────────────────────────────────────────
  function renderGate() {
    const gate = $('#tokenGate');
    const workspace = $('#pushWorkspace');
    const chip = $('#ghChip');
    const loggedIn = !!state.token && !!state.user;

    if (gate) gate.hidden = loggedIn;
    if (workspace) workspace.hidden = !loggedIn;
    if (chip) {
      chip.hidden = !loggedIn;
      if (loggedIn) {
        const avatar = $('#ghAvatar');
        if (avatar && N.safeUrl(state.user.avatar_url)) avatar.src = state.user.avatar_url;
        $('#ghLogin').textContent = `@${state.user.login}`;
      }
    }
    if (loggedIn) renderAccount();
    updatePushButton();
  }

  function renderAccount() {
    const u = state.user;
    if (!u) return;
    const avatar = $('#accountAvatar');
    if (avatar && N.safeUrl(u.avatar_url)) avatar.src = u.avatar_url;
    $('#accountName').textContent = u.name ? `${u.name} · @${u.login}` : `@${u.login}`;
    $('#accountMeta').textContent = `${u.public_repos ?? 0} repo publik${u.total_private_repos != null ? ` · ${u.total_private_repos} privat` : ''}`;
    const badge = $('#scopeBadge');
    const hasRepo = state.scopes.includes('repo') || state.scopes.length === 0;
    badge.textContent = state.scopes.length ? `scope: ${state.scopes.join(', ')}` : 'fine-grained token';
    badge.dataset.ok = String(hasRepo);
  }

  async function validateToken(token) {
    state.token = token;
    const { data, res } = await gh('/user');
    state.user = data;
    state.scopes = String(res.headers.get('x-oauth-scopes') || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    return data;
  }

  // ── repo target ───────────────────────────────────────────────────────
  function setTargetMode(mode) {
    state.targetMode = mode;
    $$('.seg-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.target === mode));
    $('#targetNew').hidden = mode !== 'new';
    $('#targetExisting').hidden = mode !== 'existing';
    if (mode === 'existing' && state.token && !state.reposLoaded) loadRepos({ silent: true });
  }

  async function loadRepos({ silent = false } = {}) {
    if (!state.token) { if (!silent) toast('warn', 'Token belum terpasang'); return; }
    try {
      const { data } = await gh('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member');
      state.repos = Array.isArray(data) ? data : [];
      state.reposLoaded = true;
      renderRepoSelect();
      renderReposView();
      const count = state.repos.length;
      const pill = $('#repoCount');
      if (pill) { pill.hidden = !count; pill.textContent = String(count); }
      if (!silent) toast('ok', 'Daftar repo dimuat', `${count} repository.`);
    } catch (err) {
      if (!silent) toast('error', 'Gagal memuat repo', friendly(err));
    }
  }

  function renderRepoSelect() {
    const sel = $('#existingRepo');
    if (!sel) return;
    if (!state.repos.length) {
      sel.innerHTML = '<option value="">— tidak ada repo —</option>';
      return;
    }
    sel.innerHTML = state.repos.map((r) => `<option value="${esc(r.full_name)}" data-branch="${esc(r.default_branch || 'main')}">${esc(r.full_name)}${r.private ? ' · private' : ''}</option>`).join('');
  }

  // ── the push itself ───────────────────────────────────────────────────
  async function ensureRepo() {
    if (state.targetMode === 'existing') {
      const full = $('#existingRepo')?.value;
      if (!full) throw new Error('Pilih repository tujuan dulu.');
      const [owner, repo] = full.split('/');
      const branch = ($('#existingBranch')?.value || 'main').trim() || 'main';
      return { owner, repo, branch, mode: $('#updateMode')?.value || 'merge', existed: true };
    }

    const max = limits();
    const name = ($('#repoName')?.value || '').trim();
    if (!name) throw new Error('Nama repository masih kosong.');
    if (name.length > max.maxNameLength || !NAME_RE.test(name) || name.startsWith('.') || name.endsWith('.')) {
      throw new Error('Nama repo tidak valid. Gunakan huruf, angka, titik, garis bawah, atau strip.');
    }
    const branch = ($('#repoBranch')?.value || 'main').trim() || 'main';
    const body = {
      name,
      description: ($('#repoDesc')?.value || '').trim() || 'Dibuat dengan VELOX NEXUS',
      private: ($('#repoVisibility')?.value || 'public') === 'private',
      auto_init: true,
    };
    logLine(`Membuat repository ${state.user.login}/${name}…`);
    const { data } = await gh('/user/repos', { method: 'POST', body });
    logLine(`Repository dibuat: ${data.full_name}`, 'ok');
    // A repo created with auto_init starts on its default branch; if the user
    // asked for another branch we simply create it from the first commit.
    return {
      owner: data.owner.login,
      repo: data.name,
      branch,
      mode: 'merge',
      existed: false,
      defaultBranch: data.default_branch || 'main',
      htmlUrl: data.html_url,
      fullName: data.full_name,
      private: data.private,
    };
  }

  async function readEntryBase64(entry) {
    if (entry.kind === 'zip-entry') {
      const b64 = await entry.entry.async('base64');
      return b64;
    }
    const buf = await entry.file.arrayBuffer();
    return toBase64(new Uint8Array(buf));
  }

  async function runPush() {
    if (state.busy) return;
    const max = limits();
    if (!state.token) { toast('warn', 'Token belum ada'); return; }
    if (!state.files.length) { toast('warn', 'Sumber belum dipilih'); return; }

    const usable = state.files.filter((f) => f.size <= max.maxFileBytes);
    const skipped = state.files.length - usable.length;
    if (!usable.length) { toast('error', 'Semua file terlalu besar', `Batas ${bytes(max.maxFileBytes)} per file.`); return; }
    if (usable.length > max.maxFiles) { toast('error', 'Terlalu banyak file', `Maksimal ${max.maxFiles}.`); return; }
    const totalBytes = usable.reduce((a, f) => a + (f.size || 0), 0);
    if (totalBytes > max.maxTotalBytes) { toast('error', 'Total terlalu besar', `Maksimal ${bytes(max.maxTotalBytes)}.`); return; }

    state.busy = true;
    const btn = $('#pushBtn');
    btn.classList.add('is-busy');
    btn.disabled = true;
    setConsoleState('running', 'berjalan');
    setProgress(0);
    $('#consoleBody').innerHTML = '';
    $('#pushResult').hidden = true;

    const commitMessage = ($('#commitMsg')?.value || '').trim() || 'feat: update dari VELOX NEXUS';

    try {
      logLine('Menghubungkan ke GitHub…');
      const target = await ensureRepo();

      // 1. base commit / tree
      let baseTree = null;
      let parentSha = null;
      logLine(`Membaca ref ${target.owner}/${target.repo}@${target.branch}…`);
      const ref = await gh(`/repos/${target.owner}/${target.repo}/git/ref/heads/${encodeURIComponent(target.branch)}`, { allow404: true });
      if (ref.data?.object?.sha) {
        parentSha = ref.data.object.sha;
        const commit = await gh(`/repos/${target.owner}/${target.repo}/git/commits/${parentSha}`);
        baseTree = commit.data?.tree?.sha || null;
        logLine(`HEAD ${parentSha.slice(0, 7)} · base tree ${baseTree ? baseTree.slice(0, 7) : 'kosong'}`);
      } else {
        logLine('Branch belum ada — akan dibuat dari commit pertama.', 'warn');
      }
      if (target.mode === 'replace') {
        baseTree = null;
        logLine('Mode timpa total: isi lama tidak dipertahankan.', 'warn');
      }

      // 2. optional README
      const payload = usable.slice();
      if ($('#autoReadme')?.checked && !payload.some((f) => /^readme\.md$/i.test(f.path))) {
        const slug = `${target.owner}/${target.repo}`;
        const readme = [
          `# ${target.repo}`,
          '',
          'Dibuat dan dikirim dengan **VELOX NEXUS**.',
          '',
          `- Repository: \`${slug}\``,
          `- Branch: \`${target.branch}\``,
          `- Berkas: ${payload.length} file`,
          `- Waktu: ${new Date().toISOString()}`,
          '',
          '> Downloader + GitHub push dalam satu workspace.',
          '',
        ].join('\n');
        payload.push({
          path: 'README.md',
          size: readme.length,
          kind: 'file',
          file: new File([readme], 'README.md', { type: 'text/markdown' }),
        });
        logLine('README.md otomatis ditambahkan.');
      }

      // 3. blobs
      logLine(`Mengunggah ${payload.length} blob…`);
      const tree = [];
      let done = 0;
      let uploadedBytes = 0;

      const CONCURRENCY = 3;
      const queue = payload.slice();

      const worker = async () => {
        for (;;) {
          const entry = queue.shift();
          if (!entry) return;
          try {
            const content = await readEntryBase64(entry);
            const { data } = await gh(`/repos/${target.owner}/${target.repo}/git/blobs`, {
              method: 'POST',
              body: { content, encoding: 'base64' },
            });
            tree.push({ path: entry.path, mode: '100644', type: 'blob', sha: data.sha });
            uploadedBytes += entry.size || 0;
            done += 1;
            logLine(`${done}/${payload.length} · ${entry.path} (${bytes(entry.size)})`);
            setProgress(done / (payload.length + 2));
          } catch (err) {
            logLine(`gagal: ${entry.path} → ${friendly(err)}`, 'err');
            throw err;
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      if (!tree.length) throw new Error('Tidak ada file yang berhasil diunggah.');

      // 4. tree
      logLine('Menyusun tree…');
      const treeBody = { tree };
      if (baseTree) treeBody.base_tree = baseTree;
      const { data: treeRes } = await gh(`/repos/${target.owner}/${target.repo}/git/trees`, {
        method: 'POST',
        body: treeBody,
      });
      setProgress((payload.length + 1) / (payload.length + 2));

      // 5. commit
      logLine('Membuat commit…');
      const commitBody = { message: commitMessage, tree: treeRes.sha, parents: parentSha ? [parentSha] : [] };
      const { data: commitRes } = await gh(`/repos/${target.owner}/${target.repo}/git/commits`, {
        method: 'POST',
        body: commitBody,
      });

      // 6. move the branch
      logLine('Memindahkan branch…');
      if (parentSha) {
        await gh(`/repos/${target.owner}/${target.repo}/git/refs/heads/${encodeURIComponent(target.branch)}`, {
          method: 'PATCH',
          body: { sha: commitRes.sha, force: true },
        });
      } else {
        await gh(`/repos/${target.owner}/${target.repo}/git/refs`, {
          method: 'POST',
          body: { ref: `refs/heads/${target.branch}`, sha: commitRes.sha },
        });
      }

      // 7. make sure the pushed branch is the default one for brand-new repos
      if (!target.existed && target.branch !== target.defaultBranch) {
        await gh(`/repos/${target.owner}/${target.repo}`, { method: 'PATCH', body: { default_branch: target.branch } }).catch(() => {});
      }

      setProgress(1);
      setConsoleState('ok', 'selesai');
      logLine('Selesai.', 'ok');
      if (skipped) logLine(`${skipped} file dilewati karena melebihi batas ukuran.`, 'warn');

      const full = target.fullName || `${target.owner}/${target.repo}`;
      const htmlUrl = target.htmlUrl || `https://github.com/${full}`;
      state.lastRepo = { full, htmlUrl, branch: target.branch, private: target.private, files: tree.length, bytes: uploadedBytes };
      showResult(state.lastRepo);
      toast('ok', 'Berhasil dikirim', `${tree.length} file → ${full}`, 6000);
      state.reposLoaded = false;
    } catch (err) {
      setConsoleState('error', 'gagal');
      logLine(friendly(err), 'err');
      toast('error', 'Push gagal', friendly(err), 7000);
    } finally {
      state.busy = false;
      btn.classList.remove('is-busy');
      updatePushButton();
    }
  }

  function showResult(result) {
    const card = $('#pushResult');
    if (!card) return;
    card.hidden = false;
    const link = $('#resultRepo');
    link.href = result.htmlUrl;
    $('#resultRepoName').textContent = result.full;
    $('#resultRepoMeta').textContent = `${result.files} file · ${bytes(result.bytes || 0)} · branch ${result.branch}`;
    const railway = $('#resultRailway');
    const vercel = $('#resultVercel');
    if (railway) railway.href = `https://railway.app/new/template?template=${encodeURIComponent(result.htmlUrl)}`;
    if (vercel) vercel.href = `https://vercel.com/new/clone?repository-url=${encodeURIComponent(result.htmlUrl)}`;
    const copyBtn = $('#resultCopy');
    if (copyBtn) {
      copyBtn.onclick = () => N.copy(`https://github.com/${result.full}.git`, 'Clone URL tersalin');
    }
  }

  // ── repos view ────────────────────────────────────────────────────────
  let repoQuery = '';
  let repoFilter = 'all';
  let repoSort = 'updated';

  function filteredRepos() {
    let list = state.repos.slice();
    if (repoFilter === 'public') list = list.filter((r) => !r.private);
    if (repoFilter === 'private') list = list.filter((r) => r.private);
    if (repoFilter === 'fork') list = list.filter((r) => r.fork);
    if (repoQuery) {
      const q = repoQuery.toLowerCase();
      list = list.filter((r) => `${r.full_name} ${r.description || ''} ${(r.topics || []).join(' ')}`.toLowerCase().includes(q));
    }
    const by = {
      updated: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
      pushed: (a, b) => new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0),
      stars: (a, b) => b.stargazers_count - a.stargazers_count,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(by[repoSort] || by.updated);
  }

  const LANG_COLOR = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', HTML: '#e34c26', CSS: '#563d7c',
    Shell: '#89e051', Go: '#00ADD8', Rust: '#dea584', Java: '#b07219', PHP: '#4F5D95', Ruby: '#701516',
    Vue: '#41b883', Svelte: '#ff3e00', Dart: '#00B4AB', Kotlin: '#A97BFF', C: '#555555', 'C++': '#f34b7d',
  };

  function renderReposView() {
    const grid = $('#repoGrid');
    const empty = $('#repoEmpty');
    const stats = $('#repoStats');
    if (!grid) return;

    if (!state.token || !state.user) {
      grid.innerHTML = '';
      if (empty) {
        empty.hidden = false;
        $('#repoEmptyText').textContent = 'Hubungkan token dulu di tab Push, lalu daftar repository-mu muncul di sini.';
      }
      if (stats) stats.hidden = true;
      return;
    }
    if (!state.reposLoaded) {
      grid.innerHTML = '';
      if (empty) {
        empty.hidden = false;
        $('#repoEmptyText').textContent = state.repos.length ? 'Memuat…' : 'Muat daftar repository dengan tombol di atas.';
      }
      return;
    }

    const list = filteredRepos();
    if (empty) empty.hidden = list.length > 0;
    if (!list.length) {
      $('#repoEmptyText').textContent = state.repos.length
        ? 'Tidak ada repo yang cocok dengan filter ini.'
        : 'Token ini belum punya repository. Buat yang pertama dari tab Push.';
    }
    if (stats && state.repos.length) {
      stats.hidden = false;
      $('#statTotal').textContent = String(state.repos.length);
      $('#statPublic').textContent = String(state.repos.filter((r) => !r.private).length);
      $('#statPrivate').textContent = String(state.repos.filter((r) => r.private).length);
      $('#statStars').textContent = String(state.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0));
    }

    grid.innerHTML = list.map((r) => {
      const lang = r.language;
      return `<button class="repo-card" type="button" data-repo="${esc(r.full_name)}">
        <div class="repo-card-top">
          <svg class="ico" aria-hidden="true"><use href="#i-repo"/></svg>
          <span class="repo-card-name">${esc(r.name)}</span>
          <span class="repo-vis" data-private="${!!r.private}">${r.private ? 'private' : 'public'}</span>
        </div>
        <p class="repo-desc">${esc(r.description || 'Tanpa deskripsi.')}</p>
        <div class="repo-meta">
          ${lang ? `<span class="repo-lang"><i class="lang-dot" style="background:${LANG_COLOR[lang] || 'var(--muted)'}"></i>${esc(lang)}</span>` : ''}
          <span><svg class="ico" aria-hidden="true"><use href="#i-star"/></svg>${r.stargazers_count || 0}</span>
          <span><svg class="ico" aria-hidden="true"><use href="#i-branch"/></svg>${esc(r.default_branch || 'main')}</span>
          <span style="margin-left:auto">${new Date(r.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
        </div>
      </button>`;
    }).join('');
  }

  async function openRepoDrawer(fullName) {
    const repo = state.repos.find((r) => r.full_name === fullName);
    if (!repo) return;

    const body = document.createElement('div');
    body.innerHTML = `<p class="section-note">Memuat detail…</p>`;
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';

    N.openDrawer({ eyebrow: repo.private ? 'PRIVATE REPOSITORY' : 'PUBLIC REPOSITORY', title: repo.full_name, body, footer });

    const [owner, name] = repo.full_name.split('/');
    const branch = repo.default_branch || 'main';

    const detail = {
      readme: '',
      files: [],
      commits: [],
    };

    await Promise.all([
      gh(`/repos/${owner}/${name}/readme`, { accept: 'application/vnd.github.raw', raw: true, allow404: true })
        .then((r) => { detail.readme = r.data || ''; }).catch(() => {}),
      gh(`/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { allow404: true })
        .then((r) => { detail.files = (r.data?.tree || []).filter((t) => t.type === 'blob').slice(0, 400); }).catch(() => {}),
      gh(`/repos/${owner}/${name}/commits?per_page=8`, { allow404: true })
        .then((r) => { detail.commits = Array.isArray(r.data) ? r.data : []; }).catch(() => {}),
    ]);

    body.innerHTML = `
      <p class="repo-desc" style="min-height:0">${esc(repo.description || 'Tanpa deskripsi.')}</p>
      <div class="repo-stats" style="margin:14px 0">
        <div><strong>${repo.stargazers_count || 0}</strong><span>bintang</span></div>
        <div><strong>${repo.forks_count || 0}</strong><span>fork</span></div>
        <div><strong>${detail.files.length || 0}</strong><span>file</span></div>
        <div><strong>${esc(repo.language || '—')}</strong><span>bahasa</span></div>
      </div>
      ${detail.readme ? `<section class="md-body">${window.MiniMarkdown.render(detail.readme)}</section>` : '<p class="section-note">README belum ada.</p>'}
      ${detail.commits.length ? `<h3 style="font-size:13px;margin:20px 0 9px">Commit terakhir</h3>
        <div class="file-list" style="max-height:190px">${detail.commits.map((c) => `
          <div class="file-row">
            <span class="file-name">${esc((c.commit?.message || '').split('\n')[0].slice(0, 90))}</span>
            <span class="file-size">${esc(c.sha.slice(0, 7))}</span>
          </div>`).join('')}</div>` : ''}
      ${detail.files.length ? `<h3 style="font-size:13px;margin:20px 0 9px">File (${detail.files.length})</h3>
        <div class="file-list" style="max-height:220px">${detail.files.slice(0, 120).map((f) => `
          <div class="file-row"><svg class="ico"><use href="#i-file"/></svg>
            <span class="file-name">${esc(f.path)}</span>
            <span class="file-size">${bytes(f.size || 0)}</span>
          </div>`).join('')}</div>` : ''}
    `;

    const open = document.createElement('a');
    open.className = 'btn btn-ghost btn-sm';
    open.href = repo.html_url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Buka di GitHub';
    footer.appendChild(open);

    const zip = document.createElement('a');
    zip.className = 'btn btn-ghost btn-sm';
    zip.href = `${repo.html_url}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
    zip.rel = 'noopener noreferrer';
    zip.textContent = 'Unduh ZIP';
    footer.appendChild(zip);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost btn-sm';
    del.style.color = 'var(--danger)';
    del.innerHTML = '<svg class="ico"><use href="#i-trash"/></svg> Hapus repo';
    del.addEventListener('click', async () => {
      const confirmName = window.prompt(`Ketik nama repo lengkap untuk menghapus permanen:\n${repo.full_name}`);
      if (confirmName !== repo.full_name) { toast('info', 'Dibatalkan', 'Nama tidak cocok.'); return; }
      try {
        await gh(`/repos/${owner}/${name}`, { method: 'DELETE' });
        toast('ok', 'Repository dihapus', repo.full_name);
        state.repos = state.repos.filter((r) => r.full_name !== repo.full_name);
        N.closeDrawer();
        renderReposView();
        renderRepoSelect();
      } catch (err) {
        toast('error', 'Gagal menghapus', friendly(err));
      }
    });
    footer.appendChild(del);
  }

  // ── wiring ────────────────────────────────────────────────────────────
  function boot() {
    // restore a token the user explicitly chose to remember for this tab
    const stored = readStoredToken();
    if (stored) {
      state.token = stored;
      validateToken(stored)
        .then(() => renderGate())
        .catch(() => { clearToken(); renderGate(); });
    } else {
      renderGate();
    }

    // token form
    $('#tokenEye')?.addEventListener('click', () => {
      const input = $('#tokenInput');
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      $('#tokenEye').innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${shown ? 'i-eye' : 'i-eye-off'}"/></svg>`;
      $('#tokenEye').setAttribute('aria-label', shown ? 'Tampilkan token' : 'Sembunyikan token');
    });

    $('#tokenForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#tokenInput');
      const value = input.value.trim();
      const btn = $('#tokenSubmit');
      if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(value)) {
        toast('warn', 'Format token tidak dikenal', 'Token GitHub biasanya diawali ghp_ atau github_pat_.');
        input.focus();
        return;
      }
      btn.classList.add('is-busy');
      btn.disabled = true;
      try {
        const user = await validateToken(value);
        setToken(value, { remember: $('#tokenRemember')?.checked });
        input.value = '';
        renderGate();
        loadRepos({ silent: true });
        toast('ok', `Halo, @${user.login}`, 'Token valid dan hanya tersimpan di tab ini.', 5200);
      } catch (err) {
        clearToken();
        toast('error', 'Token ditolak', friendly(err), 6000);
      } finally {
        btn.classList.remove('is-busy');
        btn.disabled = false;
      }
    });

    $('#lockToken')?.addEventListener('click', () => {
      clearToken();
      renderGate();
      state.repos = [];
      state.reposLoaded = false;
      renderReposView();
      toast('ok', 'Token dihapus', 'Tidak ada salinan tersisa di browser ini.');
    });

    $('#ghChip')?.addEventListener('click', () => N.setView('repos'));

    // source tabs + drop zone
    $$('.src-tab').forEach((b) => b.addEventListener('click', () => setSrcMode(b.dataset.src)));
    const input = $('#fileInput');
    const drop = $('#dropZone');
    input?.addEventListener('change', () => acceptFileList(input.files));

    ['dragenter', 'dragover'].forEach((evt) => drop?.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((evt) => drop?.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
    }));
    drop?.addEventListener('drop', async (e) => {
      const items = e.dataTransfer?.files;
      if (!items?.length) return;
      if (state.srcMode !== 'zip' && items.length && /\.zip$/i.test(items[0].name)) setSrcMode('zip');
      await acceptFileList(items);
    });

    // target
    $$('.seg-btn').forEach((b) => b.addEventListener('click', () => setTargetMode(b.dataset.target)));
    $('#existingRepo')?.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      if (opt?.dataset.branch) $('#existingBranch').value = opt.dataset.branch;
    });
    $('#reloadRepos')?.addEventListener('click', () => loadRepos());
    $('#pushBtn')?.addEventListener('click', runPush);

    // repos view
    $('#reposRefresh')?.addEventListener('click', () => {
      if (!state.token) { toast('warn', 'Token belum terpasang', 'Buka tab Push untuk menghubungkan.'); return; }
      state.reposLoaded = false;
      renderReposView();
      loadRepos();
    });
    $('#repoSearch')?.addEventListener('input', (e) => { repoQuery = e.target.value.trim(); renderReposView(); });
    $('#repoFilter')?.addEventListener('change', (e) => { repoFilter = e.target.value; renderReposView(); });
    $('#repoSort')?.addEventListener('change', (e) => { repoSort = e.target.value; renderReposView(); });
    $('#repoGrid')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-repo]');
      if (card) openRepoDrawer(card.dataset.repo);
    });

    document.addEventListener('nexus:view', (e) => {
      if (e.detail.view === 'repos') {
        renderReposView();
        if (state.token && !state.reposLoaded) loadRepos({ silent: true });
      }
      if (e.detail.view === 'push') renderGate();
    });

    setSrcMode('zip');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
