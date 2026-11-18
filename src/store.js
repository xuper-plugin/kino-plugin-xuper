// store.js — the only module that writes `kino.storage`.
//
// Kino's storage keeps strings: `set` stores `String(value)`, so an object becomes "[object Object]". Here every value
// is either the exact text it came as or `JSON.stringify(obj)`: `setText` refuses anything that is not a string, and
// `getJson` treats a value that does not parse as a miss and removes it. Reads and writes are synchronous
// (KR/prelude.js storage section).
//
// Every key of this plugin starts with KEY_PREFIX ("o2:"; test/wiring.test.mjs checks the sources). Xuper 2.x kept its
// own keys in the same storage (it is the same plugin id): `session` (its portal session as JSON, never a Bearer),
// `rows:*`, `chapters:v1`, `seeds` and the rest, none with that prefix. `sweepOld` removes them.

export const KEY_PREFIX = "o2:";

function storage() {
  return typeof kino !== "undefined" && kino && kino.storage ? kino.storage : null;
}

function log(m) { try { kino.log("store: " + m); } catch (_) { /* no log */ } }

/** The stored text, or null (missing, expired, or storage unavailable). */
export function getText(key) {
  const s = storage();
  if (!s) return null;
  try {
    const v = s.get(key);
    return typeof v === "string" ? v : null;
  } catch (_) { return null; }
}

/** The stored JSON value, or null. A value that does not parse is a miss and is removed. */
export function getJson(key) {
  const t = getText(key);
  if (t === null) return null;
  try { return JSON.parse(t); } catch (_) {
    remove(key);
    return null;
  }
}

/**
 * Stores `text` (a string, or this throws: never let an object become "[object Object]").
 * Returns false when Kino refused the write (storage full, value too large): callers keep the data in memory.
 */
export function setText(key, text, opts) {
  if (typeof text !== "string") throw new TypeError("store.setText(" + key + "): the value must be a string");
  const s = storage();
  if (!s) return false;
  try {
    if (opts && opts.ttlMs) s.set(key, text, { ttlMs: opts.ttlMs });
    else s.set(key, text);
    return true;
  } catch (e) {
    log("set " + key + " failed: " + ((e && (e.code || e.message)) || e));
    return false;
  }
}

/** Stores `JSON.stringify(obj)`. */
export function setJson(key, obj, opts) {
  return setText(key, JSON.stringify(obj), opts);
}

export function remove(key) {
  const s = storage();
  if (!s) return;
  try { s.remove(key); } catch (_) { /* best-effort */ }
}

/** Every stored key (expired ones are already gone). */
function keys() {
  const s = storage();
  if (!s || typeof s.keys !== "function") return [];
  try {
    const k = s.keys();
    return Array.isArray(k) ? k : [];
  } catch (_) { return []; }
}

/**
 * Removes every stored key outside KEY_PREFIX: what Xuper 2.x left after the update (its whole storage, up to 256 KB of
 * it, of no use to this code) and what a restored 2.x backup brings back. 2.x's `session` held its portal session
 * as JSON ({userId, userToken, jwtToken, sn, acct}); it is removed like the rest and never read. → how many keys it
 * removed (0 on a storage this version wrote, or one without `keys`).
 */
export function sweepOld() {
  let n = 0;
  for (const k of keys()) {
    if (typeof k !== "string" || k.startsWith(KEY_PREFIX)) continue;
    remove(k);
    n++;
  }
  if (n) log("removed " + n + " keys an older version left");
  return n;
}
