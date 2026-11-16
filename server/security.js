'use strict';

/**
 * VELOX NEXUS — HTTP security layer.
 *
 * Design goals, in order:
 *   1. The browser may only run our own code and only talk to our own origin
 *      plus api.github.com (the push module talks to GitHub directly so the
 *      token never transits this server).
 *   2. Nothing user-controlled is ever reflected into a header unsanitised.
 *   3. Secrets that leak into a log or an error body are redacted.
 *   4. Cross-origin state changes are refused even though there are no cookies.
 */

const crypto = require('crypto');
const config = require('./config');

// ── Secret redaction ────────────────────────────────────────────────────
// GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ (classic, app) and github_pat_ (fine-grained).
const TOKEN_PATTERNS = [
  /\b(gh[pousr]_[A-Za-z0-9]{16,})/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})/g,
  /\b(Bearer\s+)[A-Za-z0-9._-]{16,}/gi,
  /\b(x-api-key["':\s]+)[A-Za-z0-9-]{16,}/gi,
];

/** Replace anything that looks like a credential with a fixed placeholder. */
function redact(input) {
  let out = String(input == null ? '' : input);
  for (const re of TOKEN_PATTERNS) out = out.replace(re, (m, p1) => `${p1 || ''}[redacted]`);
  return out;
}

/** Strip query strings from a URL before logging (they often carry signed tokens). */
function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return redact(String(raw)).slice(0, 120);
  }
}

/** Redact known secret values (e.g. cookies) anywhere inside JSON-ish text. */
function redactBody(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactBody(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /token|secret|cookie|authorization|password/i.test(k) ? '[redacted]' : redactBody(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ── Content-Security-Policy ─────────────────────────────────────────────
function buildCsp() {
  const extra = config.cspExtra.join(' ');
  const directives = [
    "default-src 'self'",
    // No inline scripts anywhere in this app; every handler lives in /js/*.js.
    "script-src 'self'",
    // Inline *style attributes* are used by a few templates (progress bars,
    // thumbnails). Allowing them keeps markup cheap to render; scripts stay locked.
    "style-src 'self' 'unsafe-inline'",
    // Thumbnails are hot-linked from platform CDNs, hence https:.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self'",
    // GitHub is the only third party the browser is allowed to call.
    `connect-src 'self' https://api.github.com${extra ? ` ${extra}` : ''}`,
    "form-action 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ];
  if (!config.allowEmbed) directives.push("frame-ancestors 'none'");
  return directives.join('; ');
}

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', buildCsp());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()'
  );
  if (!config.allowEmbed) res.setHeader('X-Frame-Options', 'DENY');
  if (config.hsts && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
    res.setHeader('Strict-Transport-Security', `max-age=${config.hstsMaxAge}; includeSubDomains`);
  }
  // A request id makes a bug report traceable without exposing internals.
  const rid = crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', rid);
  req.requestId = rid;
  next();
}

// ── CORS ────────────────────────────────────────────────────────────────
/**
 * Default is `self`: the API is consumed by our own frontend only.
 * Set CORS_ORIGIN=* (or a comma separated allowlist) if you want to offer the
 * public JSON API to other sites.
 */
function allowedOrigins() {
  const raw = config.corsOrigin;
  if (raw === '*' || raw === '') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function cors(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  const origin = req.headers.origin;
  const allow = allowedOrigins();

  if (origin) {
    const ok = allow === '*' ? true : allow.includes(origin);
    if (!ok) {
      // Fail closed: a disallowed origin gets no CORS headers at all.
      if (req.method === 'OPTIONS') return res.sendStatus(403);
      return next();
    }
    res.setHeader('Access-Control-Allow-Origin', allow === '*' ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

/**
 * CSRF defence for a cookieless API: reject state-changing requests that
 * announce a foreign Origin/Referer. Browsers always send Origin on POST, so a
 * malicious page cannot forge one; curl/scripts (no Origin) still work.
 */
function originGuard(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const origin = req.headers.origin || (req.headers.referer ? safeOrigin(req.headers.referer) : null);
  if (!origin) return next(); // native client / server-to-server

  const allow = allowedOrigins();
  if (allow === '*') return next();
  const self = `${req.protocol}://${req.get('host')}`;
  if (allow.includes(origin) || origin === self) return next();

  return res.status(403).json({
    ok: false,
    error: {
      code: 'BAD_ORIGIN',
      title: 'Asal request ditolak',
      message: 'Permintaan lintas-origin ke API ini tidak diizinkan.',
    },
  });
}

function safeOrigin(referer) {
  try { return new URL(referer).origin; } catch { return null; }
}

/** Small, dependency-free security.txt served from /.well-known/. */
function securityTxt(contact) {
  const expires = new Date(Date.now() + 365 * 864e5).toISOString();
  return [
    '# VELOX NEXUS security policy',
    `Contact: ${contact || 'mailto:security@example.com'}`,
    `Expires: ${expires}`,
    'Preferred-Languages: id, en',
    'Canonical: /.well-known/security.txt',
    '',
    '# We run no analytics, set no cookies and store no uploads.',
    '# GitHub tokens are handled in the browser only and never reach this server.',
    '',
  ].join('\n');
}

module.exports = {
  securityHeaders, cors, originGuard, redact, redactBody, safeUrl, buildCsp, securityTxt,
};
