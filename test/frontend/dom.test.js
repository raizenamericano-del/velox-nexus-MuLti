'use strict';

/**
 * Boots the real NEXUS frontend (index.html + markdown.js + shell.js + app.js +
 * push.js) inside jsdom and asserts the behaviour that matters:
 *   · clean boot with no console errors
 *   · every platform card renders from /api/platforms
 *   · view routing (downloader / push / repos / docs)
 *   · resolve → result card with formats, filters and caption
 *   · a failed resolve renders the friendly error card, not a raw code
 *   · download targets are pinned to this origin's /api/dl
 *   · the push gate rejects obviously malformed tokens and never persists a
 *     token to localStorage
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PLATFORM_IDS = [
  'tiktok', 'instagram', 'youtube', 'facebook', 'twitter', 'pinterest', 'rednote', 'snapchat', 'threads',
  'linkedin', 'vimeo', 'dailymotion', 'twitch', 'soundcloud', 'spotify', 'reddit', 'bluesky', 'tumblr',
  'bilibili', 'douyin', 'capcut', 'likee', 'kwai', 'streamable', 'rumble', 'vk', 'okru', 'weibo',
  'bandcamp', 'mixcloud', 'audiomack', 'coub', 'imgur', 'nicovideo',
];

const PLATFORMS = {
  ok: true,
  count: PLATFORM_IDS.length,
  platforms: PLATFORM_IDS.map((id, i) => ({
    id, name: id === 'twitter' ? 'X / Twitter' : id[0].toUpperCase() + id.slice(1),
    tier: i < 5 ? 1 : 3,
    kinds: ['Video', 'Audio'],
    engine: 'engine',
    sample: `https://example.com/${id}`,
    mode: id === 'spotify' ? 'provider-audio' : 'media',
    isNew: i >= 19,
    limitation: null,
  })),
};

const CAPABILITIES = {
  ok: true,
  app: { name: 'VELOX', fullName: 'VELOX NEXUS', tagline: 'x', version: '3.0.0' },
  engine: { available: true, version: '2026.10.26', ffmpeg: true, source: 'path' },
  features: { push: true, directProxy: true, adaptiveRouting: true, playlists: true, captions: true, audioConvert: true, youtubeFallback: true },
  providers: { disabled: [], fxtwitter: true, vxtwitter: true, piped: true, invidious: true },
  github: { apiBase: 'https://api.github.com', maxFileBytes: 47185920, maxFiles: 1500, maxTotalBytes: 230686720, maxNameLength: 100 },
  limits: { rateResolve: 20, rateDownload: 40, rateGlobal: 120, rateWindowSeconds: 60, maxUrlLength: 2048 },
};

const HEALTH = {
  status: 'ok', app: 'VELOX', uptimeSeconds: 12, timestamp: new Date().toISOString(),
  engine: { engine: 'yt-dlp', available: true, version: '2026.10.26', ffmpeg: true, cache: 10 },
  cache: { entries: 0, hits: 0, misses: 0, hitRate: 0, ttlMinutes: 10 },
  queue: { active: 0, pending: 0 }, platforms: PLATFORM_IDS.length, routing: {},
};

const RESOLVE_OK = {
  platform: 'tiktok', platformName: 'TikTok', url: 'https://www.tiktok.com/@tiktok/video/1',
  title: 'Video uji coba', author: '@tiktok', thumbnail: null, duration: '0:15',
  kind: 'video', isPlaylist: false, via: 'tikwm', ms: 812, warnings: [],
  description: 'Halo dunia #coba',
  hashtags: ['#coba'],
  descriptionSource: 'description',
  items: [{
    id: '1', title: 'Video uji coba', thumbnail: null, duration: '0:15', kind: 'video',
    formats: [
      { id: 'hd', label: 'HD · Tanpa Watermark', tag: 'HD', ext: 'mp4', kind: 'video', size: '4.1 MB', url: '/api/dl?t=direct&u=x' },
      { id: 'music', label: 'Sound · MP3', tag: 'MP3', ext: 'mp3', kind: 'audio', url: '/api/dl?t=direct&u=y' },
      { id: 'photo', label: 'Foto 1', tag: 'IMG', ext: 'jpg', kind: 'image', url: '/api/dl?t=direct&u=z' },
    ],
  }],
};

const RESOLVE_ERR = {
  ok: false,
  error: {
    code: 'NOT_FOUND', title: 'Kontennya sudah tidak ada', message: 'Post ini sudah dihapus.',
    hint: 'Cek lagi linknya.',
    attempts: [{ resolver: 'tiktok', method: 'tikwm', ok: false, ms: 120, error: 'NOT_FOUND' }],
  },
};

function makeDom({ resolve = RESOLVE_OK, resolveStatus = 200, extraFetch } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
  vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

  const dom = new JSDOM(read('public/index.html'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost:3000/',
    virtualConsole: vc,
  });
  const { window } = dom;
  const calls = [];

  window.fetch = async (url, opts = {}) => {
    const href = String(url);
    calls.push({ url: href, method: opts.method || 'GET', body: opts.body });
    if (extraFetch) {
      const hit = await extraFetch(href, opts);
      if (hit) return hit;
    }
    if (href.includes('/api/platforms')) return json(PLATFORMS);
    if (href.includes('/api/capabilities')) return json(CAPABILITIES);
    if (href.includes('/api/health')) return json(HEALTH);
    if (href.includes('/api/resolve')) return json(resolve, resolveStatus);
    return json({ ok: true });
  };
  const json = (data, status = 200) => ({
    ok: status < 400, status,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { readText: async () => '', writeText: async () => {} }, configurable: true,
  });

  for (const file of ['markdown.js', 'shell.js', 'app.js', 'push.js']) {
    window.eval(read(`public/js/${file}`));
  }

  const close = () => { try { window.close(); } catch { /* already closed */ } };
  return { dom, window, errors, calls, close };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('boots clean, renders all 34 platform cards and fills the engine panel', async (t) => {
  const ctx = makeDom();
  t.after(() => ctx.close());
  const { window, errors } = ctx;
  await tick(60);

  assert.deepStrictEqual(errors, [], `console errors on boot: ${errors.join(' | ')}`);
  const doc = window.document;

  const cards = doc.querySelectorAll('.plat-card');
  assert.strictEqual(cards.length, 34, `expected 34 platform cards, got ${cards.length}`);
  assert.ok(doc.querySelector('.plat-new'), 'the BARU badge should mark new platforms');
  assert.match(doc.querySelector('#enginePlatforms').textContent, /34/);
  assert.match(doc.querySelector('#statusText').textContent, /engine siap/);
  assert.strictEqual(doc.querySelector('#statusPill').dataset.state, 'ok');
  assert.match(doc.querySelector('#panelBadge').textContent, /routing adaptif/);
  // quick chips + filters come from the same registry
  assert.strictEqual(doc.querySelectorAll('.quick-chip').length, 8);
  // no raw inline handlers anywhere (CSP would block them anyway)
  assert.ok(!/on(click|error|load)=/i.test(read('public/index.html')));
});

test('view routing shows one workspace at a time and syncs the rail + crumb', async (t) => {
  const ctx = makeDom();
  t.after(() => ctx.close());
  const { window } = ctx;
  await tick(40);
  const doc = window.document;

  const pushBtn = doc.querySelector('.nav-item[data-view="push"]');
  pushBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(30);

  assert.strictEqual(doc.querySelector('#view-push').hidden, false);
  assert.strictEqual(doc.querySelector('#view-downloader').hidden, true);
  assert.strictEqual(doc.querySelector('#view-docs').hidden, true);
  assert.strictEqual(doc.querySelector('#crumb').textContent, 'Push ke GitHub');
  assert.ok(pushBtn.classList.contains('is-active'));
  assert.ok(doc.querySelector('.mob-item[data-view="push"]').classList.contains('is-active'));

  // data-goto links (hero CTA, privacy line, …) route too
  doc.querySelector('.privacy-line [data-goto="docs"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(30);
  assert.strictEqual(doc.querySelector('#view-docs').hidden, false);
  assert.match(doc.querySelector('#chainList').textContent, /fxtwitter/);
});

test('submitting a link renders formats, filters, caption and pins downloads to /api/dl', async (t) => {
  const ctx = makeDom();
  t.after(() => ctx.close());
  const { window, errors, calls } = ctx;
  await tick(40);
  const doc = window.document;

  const input = doc.querySelector('#urlInput');
  input.value = 'https://www.tiktok.com/@tiktok/video/1';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.match(doc.querySelector('#hintText').textContent, /tik ?tok terdeteksi/i);

  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(60);

  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  const posted = calls.find((c) => c.url.includes('/api/resolve'));
  assert.ok(posted, 'resolve was never called');
  assert.strictEqual(JSON.parse(posted.body).url, 'https://www.tiktok.com/@tiktok/video/1');

  const card = doc.querySelector('.result-card');
  assert.ok(card, 'result card not rendered');
  assert.match(card.querySelector('.result-title').textContent, /Video uji coba/);

  const labels = [...card.querySelectorAll('.fmt-label')].map((n) => n.textContent);
  assert.ok(labels.some((l) => l.includes('HD · Tanpa Watermark')));
  assert.ok(labels.some((l) => l.includes('Sound · MP3')));

  // every download button must point at this origin's /api/dl
  for (const btn of card.querySelectorAll('[data-url]')) {
    const u = new URL(btn.dataset.url, 'http://localhost:3000/');
    assert.strictEqual(u.origin, 'http://localhost:3000');
    assert.strictEqual(u.pathname, '/api/dl');
  }

  // filters hide the other groups instead of removing them
  const audioFilter = [...card.querySelectorAll('[data-filter]')].find((b) => b.dataset.filter === 'audio');
  audioFilter.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const hidden = [...card.querySelectorAll('[data-group]')].filter((el) => el.hidden).map((el) => el.dataset.group);
  assert.deepStrictEqual(hidden.sort(), ['image', 'video']);

  // caption block keeps the source text and hashtags
  assert.match(card.querySelector('#captionText').value, /Halo dunia/);
  assert.ok(card.querySelector('[data-copy-tag]'), 'hashtag chip missing');

  // history is written locally, without any network call
  const hist = JSON.parse(window.localStorage.getItem('velox.history.v3') || '[]');
  assert.strictEqual(hist.length, 1);
  assert.strictEqual(hist[0].platform, 'tiktok');
});

test('a failed resolve renders the friendly card with attempt telemetry', async (t) => {
  const ctx = makeDom({ resolve: RESOLVE_ERR, resolveStatus: 404 });
  t.after(() => ctx.close());
  const { window, errors } = ctx;
  await tick(40);
  const doc = window.document;

  doc.querySelector('#urlInput').value = 'https://www.instagram.com/reel/gone/';
  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(50);

  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  const card = doc.querySelector('.err-card');
  assert.ok(card, 'error card missing');
  assert.match(card.textContent, /Kontennya sudah tidak ada/);
  assert.match(card.textContent, /Cek lagi linknya/);
  assert.match(card.textContent, /tikwm/, 'attempt list should be visible');
  assert.ok(!card.textContent.includes('[object Object]'));
});

test('malformed URLs are rejected before any request leaves the browser', async (t) => {
  const ctx = makeDom();
  t.after(() => ctx.close());
  const { window, calls } = ctx;
  await tick(40);
  const doc = window.document;
  const before = calls.filter((c) => c.url.includes('/api/resolve')).length;

  for (const bad of ['not a url', 'ftp://example.com/a', 'javascript:alert(1)']) {
    doc.querySelector('#urlInput').value = bad;
    doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  }
  await tick(30);

  const after = calls.filter((c) => c.url.includes('/api/resolve')).length;
  assert.strictEqual(after, before, 'invalid URLs must never reach /api/resolve');
});

test('the push gate rejects malformed tokens and never persists a token to localStorage', async (t) => {
  const ctx = makeDom({
    extraFetch: async (href) => {
      if (href.startsWith('https://api.github.com/user')) {
        return {
          ok: true, status: 200,
          headers: { get: (k) => (String(k).toLowerCase() === 'x-oauth-scopes' ? 'repo' : 'application/json') },
          json: async () => ({ login: 'raizen', name: 'Raizen', avatar_url: 'https://avatars.githubusercontent.com/u/1', public_repos: 7, total_private_repos: 2 }),
          text: async () => JSON.stringify({ login: 'raizen', name: 'Raizen', public_repos: 7 }),
        };
      }
      return null;
    },
  });
  t.after(() => ctx.close());
  const { window } = ctx;
  await tick(40);
  const doc = window.document;

  const form = doc.querySelector('#tokenForm');
  const input = doc.querySelector('#tokenInput');

  input.value = 'bukan-token';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(30);
  assert.strictEqual(doc.querySelector('#tokenGate').hidden, false, 'gate should stay open for a bad token');

  input.value = 'ghp_' + 'a'.repeat(36);
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(60);

  // gate closed, workspace visible, account rendered
  assert.strictEqual(doc.querySelector('#tokenGate').hidden, true);
  assert.strictEqual(doc.querySelector('#pushWorkspace').hidden, false);
  assert.match(doc.querySelector('#accountName').textContent, /raizen/);
  assert.match(doc.querySelector('#scopeBadge').textContent, /repo/);

  // the token must not be in localStorage (session storage only, and only when asked)
  const dump = JSON.stringify({ ...window.localStorage });
  assert.ok(!dump.includes('ghp_'), 'token leaked into localStorage');
  assert.strictEqual(window.sessionStorage.getItem('velox.gh.token'), null, 'token stored without opt-in');

  // hiding the token is the default state
  assert.strictEqual(input.type, 'password');
});
