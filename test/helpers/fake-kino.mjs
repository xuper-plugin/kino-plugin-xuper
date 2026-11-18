// A fake `kino` for node --test: string-only storage like Kino's (set stores String(value)), a scripted fetch that
// records every request, native-like crypto.hash / crypto.convert, and kino.error. Installed as globalThis.kino.
import { createHash } from "node:crypto";

/** A Kino-like response. `body` is text; `binary: true` makes it cross as base64 (an octet-stream asset). */
export function res(status, body = "", headers = {}, { binary = false } = {}) {
  const h = {};
  for (const k of Object.keys(headers)) h[k.toLowerCase()] = headers[k];
  if (binary && !h["content-type"]) h["content-type"] = "application/octet-stream";
  const text = String(body);
  return {
    ok: status >= 200 && status <= 299, status, url: "", headers: h,
    text: () => text,
    json: () => JSON.parse(text),
    base64: () => Buffer.from(text, "utf8").toString("base64"),
    _binaryTextCalls: 0,
  };
}

/**
 * opts.routes: [(url, init) => response | undefined | Error]; the first that answers wins; no answer → 404.
 * opts.storage: initial { key: string }.
 * opts.convert: false removes kino.crypto.convert (an older Kino).
 * opts.noFetch: true makes any fetch throw (assert "0 requests").
 */
export function installKino(opts = {}) {
  const store = new Map(Object.entries(opts.storage || {}));
  const writes = [];
  const requests = [];
  const logs = [];
  const routes = opts.routes || [];
  const crypto = {
    hash: (alg, data) => createHash(String(alg).replace("-", "").toLowerCase()).update(String(data), "utf8").digest("hex"),
  };
  if (opts.convert !== false) {
    crypto.convert = (data, from, to) => {
      crypto.convertCalls = (crypto.convertCalls || 0) + 1;
      return Buffer.from(String(data), from).toString(to);
    };
  }
  const kino = {
    lang: opts.lang || "es",
    config: {},
    log: (...a) => logs.push(a.join(" ")),
    error: (code, msg, opts) => Object.assign(new Error(msg), { code }, opts && opts.userMessage ? { userMessage: opts.userMessage } : {}),
    crypto,
    storage: {
      get: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      set: (k, v) => { store.set(String(k), String(v)); writes.push(String(k)); },
      remove: (k) => { store.delete(String(k)); },
      keys: () => Array.from(store.keys()),
    },
    fetch: async (url, init = {}) => {
      requests.push({ url, headers: { ...(init.headers || {}) }, timeoutMs: init.timeoutMs });
      if (opts.noFetch) throw new Error("unexpected kino.fetch " + url);
      for (const r of routes) {
        const out = await r(url, init);
        if (out instanceof Error) throw out;
        if (out) return out;
      }
      return res(404, "not found");
    },
  };
  globalThis.kino = kino;
  return { kino, store, writes, requests, logs };
}
