/* ==========================================================================
   VELOX NEXUS — shell
   View routing, engine telemetry, toasts, drawer, clipboard. No dependencies.
   ========================================================================== */
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const safeUrl = (raw) => {
    try {
      const u = new URL(raw);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch { return ''; }
  };

  const fmtBytes = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const prefersReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── toasts ────────────────────────────────────────────────────────────
  const ICON = { ok: 'i-check', error: 'i-alert', warn: 'i-alert', info: 'i-sparkle' };

  function toast(kind, title, msg, ms = 4200, action) {
    const host = $('#toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.kind = kind === 'ok' ? 'ok' : kind;
    el.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${ICON[kind] || ICON.info}"/></svg>
      <div><strong>${esc(title)}</strong>${msg ? `<p>${esc(msg)}</p>` : ''}</div>`;
    if (action?.label && typeof action.onClick === 'function') {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', () => { action.onClick(); el.remove(); });
      el.appendChild(b);
    }
    host.appendChild(el);
    const close = () => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 240);
    };
    setTimeout(close, ms);
    return close;
  }

  // ── clipboard (async API + legacy fallback) ───────────────────────────
  async function copy(text, okTitle = 'Tersalin') {
    const value = String(text ?? '');
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.className = 'clipboard-fallback';
        ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('ok', okTitle);
      return true;
    } catch {
      toast('warn', 'Clipboard diblokir browser', 'Salin manual dari kolom teks.');
      return false;
    }
  }

  // ── views ─────────────────────────────────────────────────────────────
  const VIEW_TITLE = { downloader: 'Downloader', push: 'Push ke GitHub', repos: 'Repo saya', docs: 'Docs & API' };
  const VIEWS = Object.keys(VIEW_TITLE);

  function setView(name, { hash = true } = {}) {
    const view = VIEWS.includes(name) ? name : 'downloader';
    VIEWS.forEach((v) => {
      const section = $(`#view-${v}`);
      if (section) {
        const active = v === view;
        section.classList.toggle('is-active', active);
        section.hidden = !active;
      }
    });
    $$('[data-view]').forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('is-active', active);
      if (btn.hasAttribute('aria-selected')) btn.setAttribute('aria-selected', String(active));
    });
    const crumb = $('#crumb');
    if (crumb) crumb.textContent = VIEW_TITLE[view];
    if (hash && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
    $('#rail')?.classList.remove('is-open');
    $('#railToggle')?.setAttribute('aria-expanded', 'false');
    window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' });
    document.dispatchEvent(new CustomEvent('nexus:view', { detail: { view } }));
  }

  // ── drawer ────────────────────────────────────────────────────────────
  let lastFocus = null;

  function openDrawer({ eyebrow, title, body, footer }) {
    const drawer = $('#drawer');
    const scrim = $('#scrim');
    lastFocus = document.activeElement;
    $('#drawerEyebrow').textContent = eyebrow || '';
    $('#drawerTitle').textContent = title || '';
    const bodyEl = $('#drawerBody');
    bodyEl.innerHTML = typeof body === 'string' ? body : '';
    if (body instanceof Node) bodyEl.replaceChildren(body);
    const foot = $('#drawerFoot');
    if (footer) { foot.replaceChildren(footer); foot.hidden = false; } else { foot.hidden = true; }
    drawer.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('is-open'));
    drawer.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('#closeDrawer')?.focus(), 60);
    document.documentElement.style.overflow = 'hidden';
  }

  function closeDrawer() {
    const drawer = $('#drawer');
    const scrim = $('#scrim');
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    setTimeout(() => { drawer.hidden = true; scrim.hidden = true; }, 300);
    if (lastFocus?.focus) lastFocus.focus();
  }

  // ── theme ─────────────────────────────────────────────────────────────
  const THEME_KEY = 'velox.theme.v2';

  function syncThemeBtn() {
    const light = document.documentElement.dataset.theme === 'light';
    const btn = $('#themeBtn');
    if (!btn) return;
    btn.setAttribute('aria-label', `Ganti ke tema ${light ? 'gelap' : 'terang'}`);
    btn.title = btn.getAttribute('aria-label');
    btn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${light ? 'i-moon' : 'i-sun'}"/></svg>`;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? '#f4f5ec' : '#0b0c0a';
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage may be blocked */ }
    syncThemeBtn();
  }

  // ── platform metadata (kept in sync with /api/platforms) ──────────────
  let platforms = [];

  async function loadPlatforms() {
    try {
      const res = await fetch('/api/platforms');
      const data = await res.json();
      platforms = Array.isArray(data.platforms) ? data.platforms : [];
      return platforms;
    } catch {
      platforms = [];
      return platforms;
    }
  }

  // ── telemetry ─────────────────────────────────────────────────────────
  let capabilities = null;

  async function refreshTelemetry() {
    const pill = $('#statusPill');
    const statusText = $('#statusText');
    try {
      const [capsRes, healthRes] = await Promise.all([
        fetch('/api/capabilities').catch(() => null),
        fetch('/api/health').catch(() => null),
      ]);
      capabilities = capsRes && capsRes.ok ? await capsRes.json() : capabilities;
      const health = healthRes && healthRes.ok ? await healthRes.json() : null;

      const engineOk = health ? health.status === 'ok' : false;
      if (pill) pill.dataset.state = engineOk ? 'ok' : 'bad';
      if (statusText) statusText.textContent = engineOk ? 'engine siap' : 'mode terbatas';

      const card = $('#engineCard');
      if (card) card.dataset.state = engineOk ? 'ok' : 'warn';
      const label = $('#engineLabel');
      if (label) label.textContent = engineOk ? 'Engine aktif' : 'Sebagian fitur mati';
      if (capabilities) {
        const f = capabilities.features || {};
        const e = capabilities.engine || {};
        $('#engineVersion').textContent = e.version ? `yt-dlp ${String(e.version).slice(0, 10)}` : (e.available ? 'yt-dlp' : 'n/a');
        $('#engineFfmpeg').textContent = f.audioConvert ? 'aktif' : 'tidak ada';
        const count = health?.platforms ?? platforms.length ?? '—';
        $('#enginePlatforms').textContent = String(count);
        $('#engineBar').style.width = engineOk ? '100%' : '38%';
        const badge = $('#panelBadge');
        if (badge) badge.textContent = `${count} platform · ${f.adaptiveRouting ? 'routing adaptif' : 'routing statis'}`;
        const dropLimit = $('#dropLimit');
        if (dropLimit) dropLimit.textContent = fmtBytes(capabilities.github?.maxFileBytes || 0);
        const tipSize = $('#tipSize');
        if (tipSize) tipSize.textContent = fmtBytes(capabilities.github?.maxFileBytes || 0);
        const setLimits = () => {
          const g = capabilities.github || {};
          const a = $('#pushLimitFiles'); if (a) a.textContent = String(g.maxFiles || '—');
          const b = $('#pushLimitSize'); if (b) b.textContent = fmtBytes(g.maxFileBytes || 0);
          const c = $('#pushLimitTotal'); if (c) c.textContent = fmtBytes(g.maxTotalBytes || 0);
        };
        setLimits();
        buildChainList();
      }
      return { health, capabilities, engineOk };
    } catch {
      if (pill) pill.dataset.state = 'bad';
      if (statusText) statusText.textContent = 'offline';
      return { health: null, capabilities, engineOk: false };
    }
  }

  /** Static-but-honest view of the resolver chains: mirrors resolvers/index.js. */
  function buildChainList() {
    const host = $('#chainList');
    if (!host) return;
    const chains = [
      { name: 'TikTok', steps: ['tikwm', 'engine', 'izuka', 'savefbs'] },
      { name: 'X / Twitter', steps: ['fxtwitter', 'syndication', 'vxtwitter', 'izuka', 'engine'] },
      { name: 'YouTube', steps: ['engine', 'izuka', 'piped', 'invidious'] },
      { name: 'Instagram', steps: ['embed', 'izuka', 'engine', 'savefbs'] },
      { name: 'Facebook', steps: ['engine', 'azbry', 'izuka', 'savefbs'] },
      { name: 'Reddit', steps: ['reddit-public', 'rapidsave', 'engine'] },
      { name: 'Spotify', steps: ['spotisaver', 'spotidown', 'spotmate', 'official'] },
      { name: 'Lainnya', steps: ['engine', 'izuka', 'savefbs'] },
    ];
    host.innerHTML = chains.map((c) => `
      <li>
        <span class="chain-name">${esc(c.name)}</span>
        ${c.steps.map((s, i) => `${i ? '<span class="chain-arrow">→</span>' : ''}<span class="chain-step${s === 'engine' ? ' engine' : ''}">${esc(s)}</span>`).join('')}
      </li>`).join('');
  }

  // ── boot ──────────────────────────────────────────────────────────────
  function boot() {
    syncThemeBtn();
    $('#themeBtn')?.addEventListener('click', toggleTheme);

    $$('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    $$('[data-goto]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        setView(el.dataset.goto);
      });
    });

    $('#closeDrawer')?.addEventListener('click', closeDrawer);
    $('#scrim')?.addEventListener('click', closeDrawer);

    $('#railToggle')?.addEventListener('click', () => {
      const rail = $('#rail');
      const open = rail.classList.toggle('is-open');
      $('#railToggle').setAttribute('aria-expanded', String(open));
    });

    $('#helpBtn')?.addEventListener('click', () => setView('docs'));
    $('#cmdHint')?.addEventListener('click', () => {
      setView('downloader');
      setTimeout(() => $('#platformSearch')?.focus(), 260);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setView('downloader');
        setTimeout(() => $('#platformSearch')?.focus(), 260);
      }
    });

    const initial = (location.hash || '').replace('#', '');
    setView(VIEWS.includes(initial) ? initial : 'downloader', { hash: false });
    window.addEventListener('hashchange', () => {
      const name = (location.hash || '').replace('#', '');
      if (VIEWS.includes(name)) setView(name, { hash: false });
    });

    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    loadPlatforms();
    refreshTelemetry();
    setInterval(refreshTelemetry, 60_000);

    // entrance animation, skipped entirely under prefers-reduced-motion
    if (!prefersReduced()) {
      $$('.reveal').forEach((el, i) => {
        el.style.animationDelay = `${Math.min(i * 60, 240)}ms`;
        el.classList.add('in');
      });
    }
  }

  window.NEXUS = {
    $, $$, esc, safeUrl, fmtBytes, toast, copy, setView, openDrawer, closeDrawer,
    loadPlatforms, getPlatforms: () => platforms, refreshTelemetry, getCapabilities: () => capabilities,
    prefersReduced, sleep,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
