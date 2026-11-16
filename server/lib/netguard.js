'use strict';

/**
 * SSRF guard.
 *
 * The old check only looked at the *string* hostname. That stops `http://127.0.0.1`
 * but not `http://localtest.me`, a CNAME pointing at 169.254.169.254 (cloud
 * metadata), or any public name that resolves into a private range. This module
 * resolves the name and validates every answer before we connect.
 *
 * Results are cached for a short TTL so a hot download path does not pay a DNS
 * round trip per request.
 */

const dns = require('dns').promises;
const net = require('net');
const ipaddr = require('ipaddr.js');

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // hostname → { at, ok }

/** RFC1918 + loopback + link-local + CGNAT + multicast + reserved. */
function isBlockedIp(raw) {
  if (!net.isIP(raw)) return true;
  let addr;
  try { addr = ipaddr.parse(raw); } catch { return true; }

  if (addr.kind() === 'ipv6') {
    if (addr.isIPv4MappedAddress()) addr = addr.toIPv4Address();
    else {
      const range = addr.range();
      // 'uniqueLocal' = fc00::/7, 'linkLocal' = fe80::/10
      return ['uniqueLocal', 'linkLocal', 'multicast', 'loopback', 'unspecified', 'reserved'].includes(range);
    }
  }
  const range = addr.range();
  return [
    'unspecified', 'broadcast', 'multicast', 'linkLocal', 'loopback', 'private',
    'carrierGradeNat', 'reserved', 'uniqueLocal',
  ].includes(range);
}

const BLOCKED_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.localdomain|metadata\..*)$/i;

/**
 * Throws when `hostname` is not a safe public destination.
 * @param {string} hostname
 * @param {{ allowPrivate?: boolean }} [opts]
 */
async function assertPublicHost(hostname, { allowPrivate = false } = {}) {
  if (allowPrivate) return;
  const host = String(hostname || '').toLowerCase();
  if (!host) throw Object.assign(new Error('empty host'), { code: 'SSRF_EMPTY_HOST' });
  if (BLOCKED_NAMES.test(host)) throw Object.assign(new Error('blocked host'), { code: 'SSRF_BLOCKED_HOST' });

  // Literal IP: no DNS needed.
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw Object.assign(new Error('private address'), { code: 'SSRF_PRIVATE_IP' });
    return;
  }

  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    if (!hit.ok) throw Object.assign(new Error('private address'), { code: 'SSRF_PRIVATE_IP' });
    return;
  }

  let records = [];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    // Unresolvable: let the real request fail with its own error rather than
    // pretending this was an attack.
    cache.set(host, { at: Date.now(), ok: true });
    return;
  }

  const bad = records.some((r) => isBlockedIp(r.address));
  cache.set(host, { at: Date.now(), ok: !bad });
  if (bad) throw Object.assign(new Error('private address'), { code: 'SSRF_PRIVATE_IP' });
}

/** Validate a full URL (scheme + host + resolved address). */
async function assertPublicUrl(rawUrl, opts) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { throw Object.assign(new Error('bad url'), { code: 'SSRF_BAD_URL' }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('bad scheme'), { code: 'SSRF_BAD_SCHEME' });
  await assertPublicHost(u.hostname, opts);
  return u;
}

module.exports = { assertPublicHost, assertPublicUrl, isBlockedIp };
