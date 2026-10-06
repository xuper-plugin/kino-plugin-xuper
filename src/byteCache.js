// A one-key, byte-budgeted cache over kino.storage, shared by the search results and the chapter
// lists. kino.storage is 256 KB for the whole plugin and a set over the cap throws, so each cache
// owns ONE key that never grows past its budget: entries are kept oldest first and the oldest are
// evicted until the encoded text fits, measured as the app stores it (escaped, `storedLength`).
// Stored form: { v: 1, e: [{ k, s: stored-at ms, i: payload }] }.
// Nothing here ever fails the caller: a read that cannot be had or decoded is a miss and a write that
// cannot be done is dropped (the caller just serves uncached).
import { storedLength } from "./homeTree.js";
import { isObject } from "./util.js";
import { trace, errCode } from "./trace.js";


/**
 * `valid(payload)` lets the owner reject a payload of an older or foreign shape (a miss).
 * Only the caller knows what is worth caching: it simply never writes an empty result.
 */
/**
 * `keepMs` (default `ttlMs`): how long an entry stays stored once it is no longer fresh, for `getStale`
 * (a stale answer served while the source is too slow to answer a fresh one).
 */
export function makeByteCache({ kino, key, budgetBytes, clock, ttlMs, valid = () => true, keepMs = ttlMs }) {
  const what = String(key).split(":")[0]; // "search", "chapters": the cache, for a breadcrumb
  const decode = (raw) => {
    try {
      const o = JSON.parse(raw);
      if (!isObject(o) || o.v !== 1 || !Array.isArray(o.e)) return [];
      return o.e.filter((x) => isObject(x) && typeof x.k === "string" && Number.isFinite(x.s) && x.i !== undefined && valid(x.i));
    } catch (_) { return []; }
  };
  const encode = (entries) => JSON.stringify({ v: 1, e: entries });

  /** Every well-formed stored entry, oldest first (stale ones included: see `fresh`). */
  function read() {
    try {
      const raw = kino.storage.get(key);
      return raw === null || raw === undefined ? [] : decode(raw);
    } catch (_) { return []; }
  }

  /** The entry's age is below the freshness window as of `nowMs` (a hit does not renew it). */
  const fresh = (entry, nowMs) => nowMs - entry.s < ttlMs;

  /** The payload stored under `k` that is still fresh, or undefined. */
  function get(k, entries = read(), nowMs = clock.now()) {
    const hit = entries.find((e) => e.k === k && fresh(e, nowMs));
    return hit === undefined ? undefined : hit.i;
  }

  const kept = (entry, nowMs) => nowMs - entry.s < Math.max(ttlMs, keepMs);

  /** The payload stored under `k`, fresh or not, while it is kept (`keepMs`); else undefined. */
  function getStale(k, entries = read(), nowMs = clock.now()) {
    const hit = entries.find((e) => e.k === k && kept(e, nowMs));
    return hit === undefined ? undefined : hit.i;
  }

  /**
   * Merge `added` ([{ k, i }]) into what is stored NOW (another call may have written since this one
   * read), move the keys the caller `touched` to the newest end, drop entries past `keepMs` and evict the
   * oldest until the key fits. An added entry that alone does not fit is skipped without evicting
   * anyone. A storage failure is swallowed.
   */
  function write(added, touched = []) {
    try {
      const now = clock.now();
      let entries = read().filter((e) => kept(e, now));
      for (const k of touched) {
        const at = entries.findIndex((e) => e.k === k);
        if (at >= 0) entries.push(...entries.splice(at, 1));
      }
      for (const a of added) {
        const entry = { k: a.k, s: now, i: a.i };
        if (storedLength(encode([entry])) > budgetBytes) { trace(kino, "store", "skip", { what }); continue; }
        entries = entries.filter((e) => e.k !== a.k);
        entries.push(entry);
      }
      let text = encode(entries);
      let evicted = 0;
      while (storedLength(text) > budgetBytes && entries.length > 0) {
        entries.shift();
        evicted++;
        text = encode(entries);
      }
      if (evicted > 0) trace(kino, "store", "evict", { what, n: evicted });
      if (entries.length === 0) return;
      kino.storage.set(key, text);
    } catch (e) { trace(kino, "store", "full", { what, code: errCode(e) }); /* serve uncached */ }
  }

  return { read, get, getStale, fresh, write };
}
