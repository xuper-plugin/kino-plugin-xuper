// A one-key, byte-budgeted cache over kino.storage, shared by the search results and the chapter
// lists. kino.storage is 256 KB for the whole plugin and a set over the cap throws, so each cache
// owns ONE key that never grows past its budget: entries are kept oldest first and the oldest are
// evicted until the encoded text fits. Stored form: { v: 1, e: [{ k, s: stored-at ms, i: payload }] }.
// Nothing here ever fails the caller: a read that cannot be had or decoded is a miss and a write that
// cannot be done is dropped (the caller just serves uncached).
import { utf8Length } from "./homeTree.js";
import { isObject } from "./util.js";


/**
 * `valid(payload)` lets the owner reject a payload of an older or foreign shape (a miss).
 * Only the caller knows what is worth caching: it simply never writes an empty result.
 */
export function makeByteCache({ kino, key, budgetBytes, clock, ttlMs, valid = () => true }) {
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

  /**
   * Merge `added` ([{ k, i }]) into what is stored NOW (another call may have written since this one
   * read), move the keys the caller `touched` to the newest end, drop stale entries and evict the
   * oldest until the key fits. An added entry that alone does not fit is skipped without evicting
   * anyone. A storage failure is swallowed.
   */
  function write(added, touched = []) {
    try {
      const now = clock.now();
      let entries = read().filter((e) => fresh(e, now));
      for (const k of touched) {
        const at = entries.findIndex((e) => e.k === k);
        if (at >= 0) entries.push(...entries.splice(at, 1));
      }
      for (const a of added) {
        const entry = { k: a.k, s: now, i: a.i };
        if (utf8Length(encode([entry])) > budgetBytes) continue;
        entries = entries.filter((e) => e.k !== a.k);
        entries.push(entry);
      }
      let text = encode(entries);
      while (utf8Length(text) > budgetBytes && entries.length > 0) {
        entries.shift();
        text = encode(entries);
      }
      if (entries.length === 0) return;
      kino.storage.set(key, text);
    } catch (_) { /* storage full or unavailable: serve uncached */ }
  }

  return { read, get, fresh, write };
}
