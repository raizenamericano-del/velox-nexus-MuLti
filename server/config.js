'use strict';

/**
 * VELOX NEXUS — single source of configuration.
 * Every knob is an env var with a safe default, so `git clone && npm start`
 * works with zero configuration while a hardened production deploy can lock
 * everything down from the Railway dashboard.
 */

const os = require('os');

const env = process.env;
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

const BROWSER_UA =
  env.APP_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

module.exports = {
  // ── Identity ──────────────────────────────────────────────────────────
  appName: env.APP_NAME || 'VELOX',
  appFullName: env.APP_FULL_NAME || 'VELOX NEXUS',
  tagline: env.APP_TAGLINE || 'Simpan inspirasimu. Kirim ke repo-mu.',
  version: require('../package.json').version,
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  port: int(env.PORT, 3000),
  host: env.HOST || '0.0.0.0',
  nodeEnv,
  isProd,
  trustProxy: bool(env.TRUST_PROXY, true),

  // ── Engine ────────────────────────────────────────────────────────────
  ytdlpPath: env.YT_DLP_PATH || '',           // explicit binary path; empty = auto-detect
  ytdlpAutoInstall: bool(env.YTDLP_AUTO_INSTALL, true),
  ytdlpAutoUpdate: bool(env.YTDLP_AUTO_UPDATE, true),
  ytdlpUpdateHours: int(env.YTDLP_UPDATE_HOURS, 12),
  cookiesFile: env.YTDLP_COOKIES || '',        // Netscape cookies.txt for IG / gated content
  ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',

  // Optional official Spotify credentials. Never exposed to the frontend.
  spotifyClientId: env.SPOTIFY_CLIENT_ID || '',
  spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET || '',

  // Adapted coflyn/scrapr providers (only Spotify, Reddit and Bilibili).
  scraprEnabled: bool(env.SCRAPR_ENABLED, true),
  scraprDisabled: list(env.SCRAPR_DISABLED).map((s) => s.toLowerCase()),
  scraprTimeoutMs: Math.min(20000, Math.max(3000, int(env.SCRAPR_TIMEOUT_SECONDS, 12) * 1000)),
  scraprMaxDownloadMb: Math.min(512, Math.max(1, int(env.SCRAPR_MAX_DOWNLOAD_MB, 128))),

  // ── Behaviour ─────────────────────────────────────────────────────────
  cacheTtlMs: int(env.CACHE_TTL_MINUTES, 10) * 60_000,
  cacheMaxEntries: int(env.CACHE_MAX_ENTRIES, 500),
  resolveTimeoutMs: int(env.RESOLVE_TIMEOUT_SECONDS, 45) * 1000,
  maxPlaylistItems: int(env.MAX_PLAYLIST_ITEMS, 30),
  maxMergeHeight: int(env.MAX_MERGE_HEIGHT, 1080), // cap for merged "best quality"
  maxUrlLength: int(env.MAX_URL_LENGTH, 2048),

  // ── Protection ────────────────────────────────────────────────────────
  rateWindowMs: int(env.RATE_WINDOW_SECONDS, 60) * 1000,
  rateMaxResolve: int(env.RATE_MAX_RESOLVE, 20),
  rateMaxDownload: int(env.RATE_MAX_DOWNLOAD, 40),
  // Coarse ceiling for every /api call, so one client cannot hammer cheap endpoints.
  rateMaxGlobal: int(env.RATE_MAX_GLOBAL, 120),
  allowDirectProxy: bool(env.ALLOW_DIRECT_PROXY, true),
  corsOrigin: env.CORS_ORIGIN || 'self',
  allowEmbed: bool(env.ALLOW_EMBED_PREVIEW, !isProd),
  hsts: bool(env.ENABLE_HSTS, isProd),
  hstsMaxAge: int(env.HSTS_MAX_AGE, 15552000),
  // Extra JS/CSS/connect origins if you self-host add-ons. Comma separated.
  cspExtra: list(env.CSP_EXTRA),

  // ── Upstreams ─────────────────────────────────────────────────────────
  userAgent: BROWSER_UA,
  tikwmBase: (env.TIKWM_BASE || 'https://www.tikwm.com').replace(/\/$/, ''),
  cobaltBase: (env.COBALT_BASE || '').replace(/\/$/, ''), // optional self-hosted cobalt instance
  cobaltKey: env.COBALT_API_KEY || '',
  igApiEndpoint: env.IG_API_ENDPOINT || '',             // optional 3rd-party IG endpoint

  // ── Third-party provider backends (keyless; see server/lib/providers.js) ─
  providersDisabled: list(env.PROVIDERS_DISABLED).map((s) => s.toLowerCase()),
  providerTimeoutMs: int(env.PROVIDER_TIMEOUT_SECONDS, 15) * 1000,
  izukaBase: (env.IZUKA_BASE || 'https://my.izuka-api.xyz').replace(/\/$/, ''),
  savefbsBase: (env.SAVEFBS_BASE || 'https://savefbs.com').replace(/\/$/, ''),
  azbryBase: (env.AZBRY_BASE || 'https://api.azbry.com').replace(/\/$/, ''),
  threadsWorkerBase: (env.THREADS_WORKER_BASE || 'https://workers-playground-cool-wood-c008.accoutydusra.workers.dev').replace(/\/$/, ''),

  // FxTwitter / VxTwitter — the most reliable keyless source for X media.
  fxBase: (env.FX_BASE || 'https://api.fxtwitter.com').replace(/\/$/, ''),
  vxBase: (env.VX_BASE || 'https://api.vxtwitter.com').replace(/\/$/, ''),

  // Piped / Invidious — alternative YouTube front-ends with a public JSON API.
  // Used only when yt-dlp is blocked from this server's IP. First working wins.
  pipedBases: list(env.PIPED_BASES) .length
    ? list(env.PIPED_BASES).map((s) => s.replace(/\/$/, ''))
    : ['https://pipedapi.kavin.rocks', 'https://api.piped.private.coffee'],
  invidiousBases: list(env.INVIDIOUS_BASES).length
    ? list(env.INVIDIOUS_BASES).map((s) => s.replace(/\/$/, ''))
    : ['https://inv.nadeko.net', 'https://invidious.nerdvpn.de'],
  youtubeFallbackEnabled: bool(env.YOUTUBE_FALLBACK_ENABLED, true),

  // ── Engine circuit breaker ────────────────────────────────────────────
  engineBreakerThreshold: int(env.ENGINE_BREAKER_THRESHOLD, 2),
  engineBreakerMinutes: int(env.ENGINE_BREAKER_MINUTES, 15),

  // ── Adaptive routing ──────────────────────────────────────────────────
  // Remember which resolver method actually worked per platform and prefer it
  // next time (see server/lib/health.js). Purely in-memory, no persistence.
  adaptiveRouting: bool(env.ADAPTIVE_ROUTING, true),
  healthDecayMinutes: int(env.HEALTH_DECAY_MINUTES, 30),

  // ── GitHub push module ────────────────────────────────────────────────
  // The token is handled *in the browser only*; these are guard rails that the
  // frontend reads through /api/capabilities so the limits live in one place.
  github: {
    apiBase: 'https://api.github.com',
    maxFileBytes: int(env.GH_MAX_FILE_MB, 45) * 1048576,   // blob API soft limit is ~50MB
    maxFiles: int(env.GH_MAX_FILES, 1500),
    maxTotalBytes: int(env.GH_MAX_TOTAL_MB, 220) * 1048576,
    maxNameLength: 100,
  },

  tmpDir: env.TMPDIR || os.tmpdir(),
};
