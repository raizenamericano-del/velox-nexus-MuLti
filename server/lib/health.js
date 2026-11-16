'use strict';

/**
 * Adaptive provider routing.
 *
 * A static try-list is wrong twice a day: providers move, get rate limited, or
 * start answering in 8 seconds. Instead of guessing, every resolver method gets
 * a live score and the chain is re-sorted before each resolve.
 *
 * score = successRate (0..1, EMA) − latency penalty − recent-failure penalty
 *
 * State is per-process and intentionally not persisted: a restart should retry
 * everything from a neutral position rather than inherit a stale grudge.
 */

const config = require('../config');

const store = new Map(); // `${platform}:${method}` → stat
const MAX_ENTRIES = 400;

function key(platform, method) { return `${platform}:${method}`; }

function fresh() {
  return { ok: 0, fail: 0, streak: 0, lastMs: 0, lastAt: 0, total: 0 };
}

function get(platform, method) {
  const k = key(platform, method);
  let s = store.get(k);
  if (!s) { s = fresh(); store.set(k, s); }
  return s;
}

/** Exponential decay so an outage from an hour ago stops dominating. */
function decay(s, now) {
  const ageMin = (now - (s.lastAt || now)) / 60000;
  const half = Math.max(1, config.healthDecayMinutes) / 2;
  if (ageMin <= half) return s;
  const factor = Math.pow(0.5, ageMin / half);
  s.ok *= factor;
  s.fail *= factor;
  return s;
}

/**
 * Score in the range ≈ [-3, 1].
 * Higher is better; unknown methods start at 0 so they are tried before a
 * method with a bad track record but after a proven one.
 */
function score(platform, method, now = Date.now()) {
  const s = decay(get(platform, method), now);
  if (!s.total) return 0;
  const n = s.ok + s.fail;
  const rate = n ? s.ok / n : 0.5;
  const latencyPenalty = Math.min(0.6, (s.lastMs || 0) / 30_000); // 30s → −0.6
  const streakPenalty = Math.min(1.6, s.streak * 0.4);
  // Confidence: a method used twice should not beat an unknown one outright.
  const confidence = Math.min(1, n / 6);
  return (rate * 2 - 1) * confidence - latencyPenalty - streakPenalty;
}

function record(platform, method, { ok, ms = 0, code = null }) {
  if (!config.adaptiveRouting) return;
  const now = Date.now();
  const s = decay(get(platform, method), now);
  s.total += 1;
  s.lastAt = now;
  s.lastMs = ms || s.lastMs;
  s.lastCode = code;
  if (ok) {
    s.ok += 1;
    s.streak = 0;
  } else {
    s.fail += 1;
    s.streak = Math.min(6, s.streak + 1);
  }
  if (store.size > MAX_ENTRIES) {
    // Drop the least recently used entry; the map is tiny so this is cheap.
    let oldestKey = null; let oldestAt = Infinity;
    for (const [k, v] of store) if ((v.lastAt || 0) < oldestAt) { oldestAt = v.lastAt || 0; oldestKey = k; }
    if (oldestKey) store.delete(oldestKey);
  }
}

/**
 * Stable sort of resolver methods by score. `engine` methods are left alone:
 * they have their own circuit breaker in resolvers/index.js and reordering them
 * would fight it.
 */
function order(platform, methods) {
  if (!config.adaptiveRouting || methods.length < 3) return methods;
  const now = Date.now();
  return methods
    .map((m, i) => ({ m, i, s: m.name === 'engine' ? null : score(platform, m.name, now) }))
    .sort((a, b) => {
      if (a.s === null || b.s === null) return a.i - b.i;
      if (Math.abs(b.s - a.s) < 0.05) return a.i - b.i; // keep declared order on ties
      return b.s - a.s;
    })
    .map((x) => x.m);
}

/** Read-only snapshot for /api/health (no secrets, just method names). */
function snapshot() {
  const out = {};
  for (const [k, v] of store) {
    const [platform, ...rest] = k.split(':');
    out[platform] = out[platform] || {};
    out[platform][rest.join(':')] = {
      ok: Math.round(v.ok * 10) / 10,
      fail: Math.round(v.fail * 10) / 10,
      streak: v.streak,
      lastMs: v.lastMs,
      score: Math.round(score(platform, rest.join(':')) * 100) / 100,
    };
  }
  return out;
}

function reset() { store.clear(); }

module.exports = { record, order, score, snapshot, reset, _store: store };
