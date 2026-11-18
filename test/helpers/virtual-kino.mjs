// A fake `kino` on a VIRTUAL clock, for tests that measure how long a call holds the runtime (Kino never preempts a
// running screen tick or event, so its duration is what a person's tap waits). `Date.now` is replaced for the whole
// process: use it only in a test file of its own.
//
// Requests are discrete events: a route answers `{ ms, res }` (the response arrives `ms` after the request starts) or
// `{ hang: true, hops }` (never answers). A request whose answer would take longer than its `timeoutMs` fails with a
// "timeout" error at `timeoutMs` × hops: Kino applies a request's timeout to each redirect hop (github.com's 302, then
// the asset), so a hanging two-hop request costs up to twice its timeout. Concurrent requests overlap correctly.
//
// Kino's FetchGate (PluginHttp.kt): at most 6 requests of a runtime run at once, at most 4 to one host (a request takes
// its host's share, then a place); the rest wait their turn, and a request's timeout only starts once it runs. So a
// request's `at` is when it STARTED running (its timeout runs from there), `queuedAt` when the plugin asked for it.
//
// `opts.ttl: true` (or `setTtl(true)`): storage honours `set(k, v, { ttlMs })` as Kino does (the value is gone once its
// TTL passed). `clearStore()` empties the storage and its TTLs.
import { createHash } from "node:crypto";
import { res } from "./fake-kino.mjs";

export const KINO_MAX_FETCHES = 6;
export const KINO_MAX_PER_HOST = 4;

export function installVirtualKino(opts = {}) {
  let now = opts.start || 1_800_000_000_000;
  Date.now = () => now;
  const pending = [];
  let seq = 0;
  const later = (ms, fire) => pending.push({ at: now + ms, seq: seq++, fire });
  const store = new Map(Object.entries(opts.storage || {}));
  const expires = new Map();   // key → epoch ms (opts.ttl)
  let ttlOn = !!opts.ttl;
  const requests = [];
  const logs = [];
  let route = () => ({ ms: 10, res: res(404, "") });

  const live = (k) => {
    const e = expires.get(k);
    if (e != null && now >= e) { store.delete(k); expires.delete(k); }
    return store.has(k);
  };

  // Kino's FetchGate
  let running = 0;
  const perHost = new Map();
  const queue = [];
  const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ""; } };
  const fits = (h) => running < KINO_MAX_FETCHES && (perHost.get(h) || 0) < KINO_MAX_PER_HOST;
  function pump() {
    for (let i = 0; i < queue.length && running < KINO_MAX_FETCHES;) {
      const q = queue[i];
      if (fits(q.host)) { queue.splice(i, 1); start(q); } else i++;
    }
  }
  function done(h) {
    running--;
    const n = (perHost.get(h) || 1) - 1;
    if (n > 0) perHost.set(h, n); else perHost.delete(h);
    pump();
  }
  function start(q) {
    running++;
    perHost.set(q.host, (perHost.get(q.host) || 0) + 1);
    const { url, init, resolve, reject } = q;
    const t = init.timeoutMs || 30000;
    const r = route(url, init) || { ms: 10, res: res(404, "") };
    requests.push({ url, timeoutMs: t, at: now, queuedAt: q.queuedAt, headers: { ...(init.headers || {}) } });
    const limit = t * (r.hops || 1);
    const ms = r.hang ? Infinity : r.ms;
    const end = (fn) => () => { done(q.host); fn(); };
    if (ms >= limit) later(limit, end(() => reject(Object.assign(new Error("timeout"), { code: "timeout" }))));
    else later(ms, end(() => (r.res instanceof Error ? reject(r.res) : resolve(r.res))));
  }

  const kino = {
    lang: opts.lang || "es",
    config: {},
    log: (...a) => logs.push(a.join(" ")),
    error: (code, msg) => Object.assign(new Error(msg), { code }),
    crypto: {
      hash: (alg, data) => createHash(String(alg).replace("-", "").toLowerCase()).update(String(data), "utf8").digest("hex"),
      convert: (data, from, to) => Buffer.from(String(data), from).toString(to),
    },
    storage: {
      get: (k) => (live(String(k)) ? store.get(String(k)) : null),
      set: (k, v, o) => {
        store.set(String(k), String(v));
        if (ttlOn && o && o.ttlMs > 0) expires.set(String(k), now + o.ttlMs); else expires.delete(String(k));
      },
      remove: (k) => { store.delete(String(k)); expires.delete(String(k)); },
      keys: () => Array.from(store.keys()).filter((k) => live(k)),
    },
    fetch: (url, init = {}) => new Promise((resolve, reject) => {
      queue.push({ url, init, host: hostOf(url), resolve, reject, queuedAt: now });
      pump();
    }),
  };
  globalThis.kino = kino;

  /** Runs `fn` to completion, advancing the virtual clock from one pending event to the next. → its result. */
  async function run(fn) {
    let done = false, out, err;
    const p = Promise.resolve().then(fn).then((v) => { done = true; out = v; }, (e) => { done = true; err = e; });
    while (!done) {
      await new Promise((r) => setImmediate(r));
      if (done) break;
      if (!pending.length) {
        await new Promise((r) => setImmediate(r));
        if (!done && !pending.length) throw new Error("virtual-kino: the call is stuck (no pending request)");
        continue;
      }
      pending.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const e = pending.shift();
      now = Math.max(now, e.at);
      e.fire();
    }
    await p;
    if (err) throw err;
    return out;
  }

  return {
    kino, store, requests, logs, run,
    now: () => now,
    advance: (ms) => { now += ms; },
    setRoute: (fn) => { route = fn; },
    /** Whether a stored key is still there (its TTL not passed). */
    has: (k) => live(String(k)),
    setTtl: (on) => { ttlOn = !!on; },
    clearStore: () => { store.clear(); expires.clear(); },
    /** Clears requests and pending events between scenarios (the clock keeps going). */
    reset: () => { requests.length = 0; pending.length = 0; logs.length = 0; queue.length = 0; running = 0; perHost.clear(); },
  };
}
