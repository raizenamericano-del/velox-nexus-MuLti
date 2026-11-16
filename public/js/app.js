/* ==========================================================================
   VELOX NEXUS — downloader view
   Talks to /api/resolve and streams files through /api/dl.
   ========================================================================== */
'use strict';

(() => {
  const N = window.NEXUS;
  const { $, $$, esc, toast, copy, fmtBytes } = N;

  // ── client-side platform hints (instant feedback; the server is the judge) ─
  const HOSTS = {
    tiktok: ['tiktok.com'], instagram: ['instagram.com'], youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    facebook: ['facebook.com', 'fb.watch', 'fb.com'], twitter: ['twitter.com', 'x.com', 'fxtwitter.com', 'vxtwitter.com'],
    pinterest: ['pinterest.com', 'pinterest.co.id', 'pin.it'], rednote: ['xiaohongshu.com', 'xhslink.com'],
    snapchat: ['snapchat.com'], threads: ['threads.net', 'threads.com'], linkedin: ['linkedin.com', 'lnkd.in'],
    vimeo: ['vimeo.com'], dailymotion: ['dailymotion.com', 'dai.ly'], twitch: ['twitch.tv', 'clips.twitch.tv'],
    soundcloud: ['soundcloud.com', 'snd.sc'], spotify: ['open.spotify.com', 'spotify.link', 'spoti.fi'],
    reddit: ['reddit.com', 'redd.it'], bluesky: ['bsky.app'], tumblr: ['tumblr.com'],
    bilibili: ['bilibili.com', 'b23.tv'], douyin: ['douyin.com'], capcut: ['capcut.com'],
    likee: ['likee.video'], kwai: ['kwai.com'], streamable: ['streamable.com'], rumble: ['rumble.com'],
    vk: ['vk.com', 'vkvideo.ru'], okru: ['ok.ru'], weibo: ['weibo.com'], bandcamp: ['bandcamp.com'],
    mixcloud: ['mixcloud.com'], audiomack: ['audiomack.com'], coub: ['coub.com'], imgur: ['imgur.com'],
    nicovideo: ['nicovideo.jp', 'nico.ms'],
  };

  const PALETTE = {
    tiktok: '#25F4EE', instagram: '#E1306C', youtube: '#FF4E45', facebook: '#4C8DFF', twitter: '#cfd3c5',
    pinterest: '#FF5252', rednote: '#FF2442', snapchat: '#FCE100', threads: '#b9beb2', linkedin: '#4A9EFF',
    vimeo: '#4CC8F0', dailymotion: '#5C9DFF', twitch: '#B084FF', soundcloud: '#FF8533', spotify: '#1DB954',
    reddit: '#FF7945', bluesky: '#449AFF', tumblr: '#9AACC5', bilibili: '#48C4EA',
  };

  const QUICK = ['tiktok', 'instagram', 'youtube', 'facebook', 'twitter', 'reddit', 'spotify', 'pinterest'];

  const parsePublicUrl = (value) => {
    const text = String(value || '').trim();
    if (!text || /\s/.test(text)) return null;
    try {
      const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
      const host = u.hostname.toLowerCase();
      if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal')) return null;
      return u;
    } catch { return null; }
  };

  const detectLocal = (value) => {
    const u = parsePublicUrl(value);
    if (!u) return null;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    for (const [id, hosts] of Object.entries(HOSTS)) {
      if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return id;
    }
    return null;
  };

  const colorOf = (id) => PALETTE[id] || '#8d9386';
  const nameOf = (id) => (N.getPlatforms().find((p) => p.id === id)?.name) || (id === 'generic' ? 'Website' : (id || 'Media'));

  // ── elements ──────────────────────────────────────────────────────────
  const form = $('#dlForm');
  const input = $('#urlInput');
  const shell = $('#inputShell');
  const goBtn = $('#goBtn');
  const hint = $('#hintText');
  const formHint = $('#formHint');
  const zone = $('#resultZone');
  const iconEl = $('#platformIcon');

  const HINT_DEFAULT = 'Link publik saja. Platform dikenali otomatis.';
  let activeRequest = null;
  let activeResult = null;
  let activeCaption = { description: '', hashtags: [] };

  const setHint = (text, kind = '') => {
    hint.textContent = text;
    formHint.dataset.kind = kind;
  };

  // ── platform preview while typing ─────────────────────────────────────
  function syncIcon() {
    const value = input.value.trim();
    const id = detectLocal(value);
    $('#clearInput').hidden = !value;
    shell.classList.toggle('is-detected', !!id);
    if (!value) {
      iconEl.innerHTML = '';
      setHint(HINT_DEFAULT);
      input.removeAttribute('aria-invalid');
      return;
    }
    if (id) {
      iconEl.innerHTML = `<span class="qdot" style="background:${esc(colorOf(id))};display:block;width:8px;height:8px;border-radius:50%"></span>`;
      setHint(`${nameOf(id)} terdeteksi · siap diproses`, 'ok');
      input.removeAttribute('aria-invalid');
    } else if (parsePublicUrl(value)) {
      iconEl.innerHTML = '<span class="qdot" style="background:var(--muted);display:block;width:8px;height:8px;border-radius:50%"></span>';
      setHint('Platform belum dikenal di daftar — engine tetap akan mencoba.', '');
    } else {
      iconEl.innerHTML = '';
      setHint('Itu belum terlihat seperti link lengkap.', 'error');
    }
  }

  // ── states ────────────────────────────────────────────────────────────
  function setLoading(on) {
    goBtn.classList.toggle('is-busy', on);
    goBtn.disabled = on;
    $('#cancelBtn').hidden = !on;
    input.toggleAttribute('readonly', on);
  }

  function showSkeleton() {
    zone.hidden = false;
    zone.innerHTML = `<div class="skel"><div class="skel-thumb"></div>
      <div class="skel-lines"><div class="skel-line"></div><div class="skel-line"></div><div class="skel-line"></div><div class="skel-line"></div></div></div>`;
  }

  // ── history (device only) ─────────────────────────────────────────────
  const HKEY = 'velox.history.v3';
  const MAX_HISTORY = 40;

  const readHistory = () => {
    try {
      const data = JSON.parse(localStorage.getItem(HKEY) || '[]');
      return Array.isArray(data) ? data.filter((h) => h && typeof h.url === 'string' && parsePublicUrl(h.url)).slice(0, MAX_HISTORY) : [];
    } catch { return []; }
  };
  const writeHistory = (list) => {
    try { localStorage.setItem(HKEY, JSON.stringify(list.slice(0, MAX_HISTORY))); } catch { /* quota / private mode */ }
  };

  function pushHistory(entry) {
    const list = readHistory().filter((h) => h.url !== entry.url);
    list.unshift({ ...entry, ts: Date.now() });
    writeHistory(list);
  }

  function renderHistory() {
    const list = readHistory();
    const body = document.createElement('div');
    if (!list.length) {
      body.innerHTML = `<div class="empty-state"><span class="empty-mark"><svg class="ico"><use href="#i-history"/></svg></span>
        <h2>Belum ada riwayat</h2><p>Link yang berhasil kamu proses akan muncul di sini. Disimpan di perangkat ini saja.</p></div>`;
    } else {
      body.innerHTML = list.map((h) => `
        <div class="hist-item">
          ${N.safeUrl(h.thumb) ? `<img class="hist-thumb" src="${esc(N.safeUrl(h.thumb))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="hist-thumb"></div>'}
          <div class="hist-body">
            <p class="hist-title">${esc(h.title || h.url)}</p>
            <p class="hist-meta"><span class="plat">${esc(nameOf(h.platform))}</span>${new Date(h.ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}</p>
          </div>
          <div class="hist-actions">
            <button class="mini-btn" type="button" data-reopen="${esc(h.url)}" title="Buka lagi"><svg class="ico"><use href="#i-refresh"/></svg></button>
            <button class="mini-btn" type="button" data-copy="${esc(h.url)}" title="Salin link"><svg class="ico"><use href="#i-copy"/></svg></button>
          </div>
        </div>`).join('');
    }
    const foot = document.createElement('div');
    foot.innerHTML = `<span style="font-size:10px;color:var(--faint)">${list.length} dari ${MAX_HISTORY} tersimpan</span>`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'mini-btn';
    clear.disabled = !list.length;
    clear.innerHTML = '<svg class="ico"><use href="#i-trash"/></svg> Hapus semua';
    clear.addEventListener('click', () => {
      const previous = list;
      writeHistory([]);
      N.closeDrawer();
      toast('ok', 'Riwayat dihapus', 'Semua entri di perangkat ini sudah bersih.', 5000, {
        label: 'Urungkan',
        onClick: () => { writeHistory(previous); toast('info', 'Riwayat dipulihkan'); },
      });
    });
    foot.appendChild(clear);
    N.openDrawer({ eyebrow: 'RIWAYAT LOKAL', title: 'Tersimpan di perangkat ini', body, footer: foot });

    body.addEventListener('click', (e) => {
      const re = e.target.closest('[data-reopen]');
      if (re) { N.closeDrawer(); input.value = re.dataset.reopen; syncIcon(); submit(); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) copy(cp.dataset.copy, 'Link tersalin');
    });
  }

  // ── resolve ───────────────────────────────────────────────────────────
  async function submit(forcedUrl) {
    if (activeRequest) { toast('info', 'Satu per satu', 'Tunggu proses selesai atau tekan Batalkan.'); return; }
    let url = String(forcedUrl || input.value).trim();
    if (!url) {
      setHint('Tempel dulu link yang ingin kamu simpan.', 'error');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const parsed = parsePublicUrl(url);
    if (!parsed) {
      setHint('Link belum valid. Gunakan alamat publik http:// atau https://.', 'error');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    url = parsed.href;
    input.value = url;
    syncIcon();

    const controller = new AbortController();
    activeRequest = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 120_000);
    setLoading(true);
    showSkeleton();

    try {
      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      const data = await res.json();

      if (!res.ok || !Array.isArray(data.items) || !data.items.length) {
        renderError(data.error || { title: 'Gagal memproses', message: 'Server membalas tanpa data.' }, url);
        return;
      }
      renderResult(data);
      pushHistory({ url, title: data.title, platform: data.platform, thumb: data.thumbnail });
      if (data.cached) toast('info', 'Dari cache', 'Link ini baru diproses, jadi hasilnya instan.');
    } catch (err) {
      const aborted = err.name === 'AbortError';
      renderError({
        code: timedOut ? 'TIMEOUT' : aborted ? 'CANCELLED' : 'NETWORK',
        title: timedOut ? 'Sumbernya belum merespons' : aborted ? 'Proses dibatalkan' : 'Koneksi terputus',
        message: timedOut
          ? 'Proses melewati dua menit tanpa jawaban.'
          : aborted
            ? 'Permintaan dihentikan dari browser. Proses di server mungkin masih menyelesaikan pekerjaannya.'
            : 'Kami belum bisa terhubung ke server VELOX.',
        hint: 'Periksa link dan koneksimu, lalu coba lagi.',
      }, url);
    } finally {
      clearTimeout(timer);
      activeRequest = null;
      setLoading(false);
    }
  }

  // ── render: caption ───────────────────────────────────────────────────
  function captionMarkup(d) {
    const description = typeof d.description === 'string' && d.description.trim() ? d.description : '';
    const tags = Array.isArray(d.hashtags)
      ? [...new Set(d.hashtags.filter((t) => typeof t === 'string' && t.length <= 200 && /^#[\p{L}\p{M}\p{N}_]+$/u.test(t)))]
      : [];
    activeCaption = { description, hashtags: tags };
    if (!description && !tags.length) return '';

    const chars = [...description].length;
    const source = d.descriptionTruncated
      ? 'Teks sumber dipotong pada 50.000 karakter.'
      : d.descriptionSource === 'title'
        ? 'Sumber hanya memberi judul pendek, bukan deskripsi lengkap.'
        : 'Teks asli dari sumber — baris dan emoji dipertahankan.';

    return `<section class="caption-panel" aria-labelledby="captionHeading">
      <header class="caption-heading">
        <h3 id="captionHeading">Simpan videonya. Salin ceritanya.</h3>
        <span class="caption-count">${chars.toLocaleString('id-ID')} karakter</span>
      </header>
      ${description ? `<label class="sr-only" for="captionText">Deskripsi dari sumber</label>
        <textarea id="captionText" class="caption-text" readonly rows="4" spellcheck="false">${esc(description)}</textarea>` : ''}
      <p class="caption-count" style="margin-top:7px">${esc(source)}</p>
      <div class="caption-actions">
        <button class="mini-btn" type="button" data-copy-caption="description" ${description ? '' : 'disabled'}>
          <svg class="ico"><use href="#i-copy"/></svg> Salin deskripsi</button>
        <button class="mini-btn" type="button" data-copy-caption="hashtags" ${tags.length ? '' : 'disabled'}>
          <svg class="ico"><use href="#i-copy"/></svg> Salin hashtag ${tags.length ? `(${tags.length})` : ''}</button>
        ${description ? '<button class="mini-btn" type="button" data-save-caption><svg class="ico"><use href="#i-down"/></svg> Simpan .txt</button>' : ''}
      </div>
      ${tags.length ? `<div class="tag-row">${tags.map((t) => `<button class="tag-btn" type="button" data-copy-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    </section>`;
  }

  // ── render: formats ───────────────────────────────────────────────────
  const KIND_ICON = { video: 'i-video', audio: 'i-music', image: 'i-photo' };

  const formatButton = (f) => `
    <button class="fmt-btn" type="button" data-url="${esc(f.url)}" data-kind="${esc(f.kind || 'file')}">
      <svg class="ico fmt-ico" aria-hidden="true"><use href="#${KIND_ICON[f.kind] || 'i-down'}"/></svg>
      <span class="fmt-label">${esc(f.label || 'Download')}${f.note ? `<em style="display:block;font-size:9.5px;color:var(--faint)">${esc(f.note)}</em>` : ''}</span>
      <span class="fmt-size">${esc(f.size || '')}</span>
      <span class="fmt-tag" data-kind="${esc(f.kind || '')}">${esc(f.tag || (f.ext || 'FILE').toUpperCase())}</span>
    </button>`;

  function renderResult(d) {
    activeResult = d;
    zone.hidden = false;
    const platform = d.platform || 'generic';
    const color = colorOf(platform);
    const vertical = /tiktok|instagram|snapchat|threads|rednote|likee|douyin/i.test(platform);
    const thumb = N.safeUrl(d.thumbnail);

    const groups = [
      { key: 'video', title: 'Video' },
      { key: 'audio', title: 'Audio' },
      { key: 'image', title: d.kind === 'gallery' ? 'Foto (slide)' : 'Foto' },
    ];
    const allFormats = (d.items || []).flatMap((it) => it.formats || []);

    const groupsMarkup = d.isPlaylist
      ? playlistMarkup(d)
      : groups.map((g) => {
        const list = allFormats.filter((f) => f.kind === g.key);
        if (!list.length) return '';
        return `<div data-group="${g.key}">
          <div class="caption-heading"><h3>${g.title}</h3><span class="caption-count">${list.length} opsi</span></div>
          <div class="fmt-grid">${list.map(formatButton).join('')}</div>
        </div>`;
      }).join('');

    const present = groups.filter((g) => allFormats.some((f) => f.kind === g.key));
    const chips = [
      `<span class="chip chip-accent">${esc(nameOf(platform))}</span>`,
      d.via ? `<span class="chip">via ${esc(d.via)}</span>` : '',
      d.duration ? `<span class="chip">${esc(d.duration)}</span>` : '',
      d.isPlaylist ? `<span class="chip">${esc(String(d.count || d.items.length))} item</span>` : '',
      typeof d.ms === 'number' ? `<span class="chip">${d.ms} ms</span>` : '',
    ].filter(Boolean).join('');

    zone.innerHTML = `
      <article class="result-card">
        <div class="result-top">
          <div class="thumb-wrap ${vertical ? 'vertical' : ''}">
            ${thumb ? `<img src="${esc(thumb)}" alt="" referrerpolicy="no-referrer">` : ''}
            <span class="thumb-plat" style="color:${esc(color)}">${esc(d.platformName || nameOf(platform))}</span>
          </div>
          <div class="result-info">
            <div class="chip-row">${chips}</div>
            <h2 class="result-title">${esc(d.title || 'Media')}</h2>
            ${d.author ? `<p class="result-by">${esc(d.author)}</p>` : ''}
            <div class="result-stats">
              ${d.views ? `<span>dilihat <b>${Number(d.views).toLocaleString('id-ID')}</b></span>` : ''}
              ${d.likes ? `<span>suka <b>${Number(d.likes).toLocaleString('id-ID')}</b></span>` : ''}
              <span><b>${allFormats.length}</b> format</span>
            </div>
          </div>
        </div>
        ${(d.warnings || []).map((w) => `<div class="warn-note"><svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg><span>${esc(w.text || w)}</span></div>`).join('')}
        ${present.length > 1 ? `<div class="filter-row" role="group" aria-label="Filter format">
            <button class="filter-btn" type="button" data-filter="all" aria-pressed="true">Semua</button>
            ${present.map((g) => `<button class="filter-btn" type="button" data-filter="${g.key}" aria-pressed="false">${g.title}</button>`).join('')}
          </div>` : '<div class="filter-row" style="border:0;padding:0;margin-bottom:0"></div>'}
        ${groupsMarkup || '<p class="section-note">Tidak ada format yang bisa diunduh dari link ini. Coba konten lain.</p>'}
        ${captionMarkup(d)}
      </article>`;

    zone.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
    zone.scrollIntoView({ behavior: N.prefersReduced() ? 'auto' : 'smooth', block: 'nearest' });
  }

  function playlistMarkup(d) {
    return `<div data-group="playlist">
      <div class="caption-heading"><h3>Isi playlist</h3><span class="caption-count">${d.items.length} video</span></div>
      <div class="file-list" style="max-height:340px">
        ${d.items.map((it, i) => `
          <div class="file-row">
            <span class="file-size" style="min-width:18px">${i + 1}</span>
            <span class="file-name">${esc(it.title)}</span>
            <span class="file-size">${esc(it.duration || '')}</span>
            <span style="display:flex;gap:4px">
              ${(it.formats || []).slice(0, 2).map((f) => `<button class="mini-btn" type="button" data-url="${esc(f.url)}" data-kind="${esc(f.kind)}">${esc((f.ext || 'file').toUpperCase())}</button>`).join('')}
            </span>
          </div>`).join('')}
      </div>
    </div>`;
  }

  function renderError(err, url) {
    zone.hidden = false;
    const attempts = Array.isArray(err.attempts) ? err.attempts : [];
    zone.innerHTML = `
      <article class="err-card">
        <div class="err-head"><svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg><span>${esc(err.title || 'Gagal memproses')}</span></div>
        <p class="err-msg">${esc(err.message || 'Terjadi kesalahan yang tidak diketahui.')}</p>
        ${err.hint ? `<p class="err-hint">${esc(err.hint)}</p>` : ''}
        <div class="err-actions">
          <button class="mini-btn" type="button" data-retry><svg class="ico"><use href="#i-refresh"/></svg> Coba lagi</button>
          <button class="mini-btn" type="button" data-copy-url><svg class="ico"><use href="#i-copy"/></svg> Salin link</button>
          ${err.code ? `<span class="attempt" data-ok="false">kode: ${esc(err.code)}</span>` : ''}
        </div>
        ${attempts.length ? `<div class="attempt-list">${attempts.map((a) => `<span class="attempt" data-ok="${a.ok}">${esc(a.method)}${a.ms ? ` · ${a.ms}ms` : ''}${a.error ? ` · ${esc(a.error)}` : ''}</span>`).join('')}</div>` : ''}
      </article>`;
    zone.querySelector('[data-retry]')?.addEventListener('click', () => submit(url));
    zone.querySelector('[data-copy-url]')?.addEventListener('click', () => copy(url, 'Link tersalin'));
    zone.scrollIntoView({ behavior: N.prefersReduced() ? 'auto' : 'smooth', block: 'nearest' });
  }

  // ── download (streamed, so an error never leaves a broken file) ───────
  function filenameFrom(disposition, fallback) {
    if (!disposition) return fallback;
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
    const plain = disposition.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1] : fallback;
  }

  async function download(btn) {
    const raw = btn.dataset.url;
    if (!raw || btn.classList.contains('is-busy')) return;

    // Only this origin's /api/dl is a legal download target.
    let target;
    try {
      const u = new URL(raw, location.origin);
      if (u.origin !== location.origin || u.pathname !== '/api/dl') throw new Error('foreign');
      target = u.href;
    } catch {
      toast('error', 'Link unduhan tidak valid', 'Proses ulang link sumber untuk URL baru.');
      return;
    }

    const label = btn.querySelector('.fmt-size');
    const original = label ? label.textContent : '';
    btn.classList.add('is-busy');
    btn.disabled = true;
    if (label) label.textContent = '…';

    try {
      const res = await fetch(target);
      const ct = (res.headers.get('content-type') || '').toLowerCase();

      if (ct.includes('application/json')) {
        const body = await res.json().catch(() => ({}));
        const e = body.error || {};
        throw Object.assign(new Error(e.message || 'Gagal mengambil file'), { title: e.title });
      }
      if (!res.ok || !res.body) throw Object.assign(new Error(`Server membalas HTTP ${res.status}`), { title: 'Download gagal' });

      const total = Number(res.headers.get('content-length')) || 0;
      const name = filenameFrom(res.headers.get('content-disposition'), 'velox-media');
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (label) label.textContent = total ? `${Math.round((got / total) * 100)}%` : `${(got / 1048576).toFixed(1)}M`;
      }

      const blob = new Blob(chunks, { type: ct || 'application/octet-stream' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 5000);

      if (label) label.textContent = `✓ ${fmtBytes(blob.size)}`;
      toast('ok', 'Download selesai', `${name} · ${fmtBytes(blob.size)}`, 3600);
      setTimeout(() => { if (label) label.textContent = original; }, 3500);
    } catch (err) {
      if (label) label.textContent = original;
      toast('error', err.title || 'Download gagal', err.message || String(err), 5200);
    } finally {
      btn.classList.remove('is-busy');
      btn.disabled = false;
    }
  }

  // ── result interactions ───────────────────────────────────────────────
  zone?.addEventListener('click', (e) => {
    const fmt = e.target.closest('[data-url]');
    if (fmt) { download(fmt); return; }

    const filter = e.target.closest('[data-filter]');
    if (filter) {
      $$('[data-filter]', zone).forEach((b) => b.setAttribute('aria-pressed', String(b === filter)));
      $$('[data-group]', zone).forEach((el) => {
        el.hidden = filter.dataset.filter !== 'all' && el.dataset.group !== filter.dataset.filter;
      });
      return;
    }

    const copyCaption = e.target.closest('[data-copy-caption]');
    if (copyCaption) {
      const isTags = copyCaption.dataset.copyCaption === 'hashtags';
      copy(isTags ? activeCaption.hashtags.join(' ') : activeCaption.description, isTags ? 'Hashtag tersalin' : 'Deskripsi tersalin');
      return;
    }

    const tag = e.target.closest('[data-copy-tag]');
    if (tag) { copy(tag.dataset.copyTag, 'Hashtag tersalin'); return; }

    if (e.target.closest('[data-save-caption]')) {
      if (!activeCaption.description) return;
      const href = URL.createObjectURL(new Blob([activeCaption.description], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = href;
      a.download = 'velox-deskripsi.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
      toast('ok', 'File teks disiapkan');
    }
  });

  // ── platform grid ─────────────────────────────────────────────────────
  let filterMode = 'all';
  let searchTerm = '';

  function platformCard(p) {
    const initial = String(p.name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '·';
    return `<button class="plat-card" type="button" data-platform="${esc(p.id)}" title="${esc(p.engine || '')}">
      ${p.isNew ? '<span class="plat-new">BARU</span>' : ''}
      <span class="plat-ico" style="color:${esc(colorOf(p.id))}">${esc(initial)}</span>
      <span class="plat-name">${esc(p.name)}</span>
      <span class="plat-kinds">${esc((p.kinds || []).join(' · ') || 'Media')}</span>
    </button>`;
  }

  function renderPlatformGrid() {
    const host = $('#platformGrid');
    if (!host) return;
    const list = N.getPlatforms();
    const visible = list.filter((p) => {
      if (filterMode === 'tier1' && p.tier !== 1) return false;
      if (filterMode === 'new' && !p.isNew) return false;
      if (searchTerm) {
        const hay = `${p.name} ${p.id} ${(p.kinds || []).join(' ')}`.toLowerCase();
        if (!hay.includes(searchTerm)) return false;
      }
      return true;
    });
    host.innerHTML = visible.length
      ? visible.map(platformCard).join('')
      : '<p class="section-note">Tidak ada platform yang cocok.</p>';
    const counter = $('#platformVisible');
    if (counter) counter.textContent = `${visible.length}/${list.length} tampil`;
  }

  function pickPlatform(id) {
    const p = N.getPlatforms().find((x) => x.id === id);
    if (!p) return;
    input.value = p.sample || '';
    syncIcon();
    input.focus();
    setHint(`Contoh link ${p.name} terisi — tekan Ambil media untuk mencoba.`, 'ok');
  }

  // ── boot ──────────────────────────────────────────────────────────────
  function boot() {
    if (!form) return;

    input.addEventListener('input', syncIcon);
    $('#clearInput')?.addEventListener('click', () => {
      input.value = '';
      syncIcon();
      input.focus();
    });

    $('#pasteBtn')?.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) { toast('warn', 'Clipboard kosong'); return; }
        input.value = text.trim();
        syncIcon();
        submit();
      } catch {
        toast('warn', 'Clipboard diblokir', 'Tempel manual dengan Ctrl/⌘ + V.');
        input.focus();
      }
    });

    $('#cancelBtn')?.addEventListener('click', () => activeRequest?.abort());
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

    $('#historyBtn')?.addEventListener('click', renderHistory);
    document.addEventListener('nexus:view', (e) => { if (e.detail.view === 'downloader') renderPlatformGrid(); });

    // quick chips
    const quick = $('#quickPlatforms');
    if (quick) {
      quick.innerHTML = QUICK.map((id) => {
        const p = N.getPlatforms().find((x) => x.id === id);
        return `<button class="quick-chip" type="button" data-platform="${esc(id)}">
          <span class="qdot" style="background:${esc(colorOf(id))}"></span>${esc(p?.name || id)}
        </button>`;
      }).join('');
      quick.addEventListener('click', (e) => {
        const b = e.target.closest('[data-platform]');
        if (b) pickPlatform(b.dataset.platform);
      });
    }

    // grid interactions
    $('#platformGrid')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-platform]');
      if (b) pickPlatform(b.dataset.platform);
    });
    $('#platformSearch')?.addEventListener('input', (e) => {
      searchTerm = e.target.value.trim().toLowerCase();
      renderPlatformGrid();
    });
    $('#platformFilters')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      filterMode = b.dataset.filter;
      $$('#platformFilters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderPlatformGrid();
    });

    // "riwayat" button in the rail is the repo count element in this build;
    // attach the drawer to a keyboard shortcut as well.
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'h') { e.preventDefault(); renderHistory(); }
    });

    // platform data arrives asynchronously → repaint when it lands
    N.loadPlatforms().then(() => { renderPlatformGrid(); syncIcon(); });
    renderPlatformGrid();
    syncIcon();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
