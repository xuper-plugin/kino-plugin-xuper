// The IMDb and TMDB ids of the titles whose detail was already read (2.2.15): the portal names a series'
// IMDb id only in its v4/getItemData (`keyWords`), and TMDB's id comes from the episodes' enrichment.
// Kept by contentId in ONE byte-budgeted kino.storage key, so home, browse, section and search cards can
// carry `ids` without asking anything new: a title nobody opened has none. Never a guess, never `tmdb: 0`.
import { makeByteCache } from "./byteCache.js";

const KEY = "ids:v1";
const BUDGET_BYTES = 10_000; // ~130 titles; the oldest go first
const KEEP_MS = 60 * 24 * 3600_000; // an id does not change; two months bounds what a removed title leaves
const IMDB = /^tt\d{7,10}$/; // the portal's form (tt + 7 or more digits) within the contract's ^tt\d{5,10}$
const MAX_TMDB = 2_147_483_647;

const validTmdb = (n) => Number.isInteger(n) && n > 0 && n <= MAX_TMDB;
// Stored as [imdb, tmdb]; tmdb 0 = not known (never sent). An empty imdb with a positive tmdb (2.2.21) is a series
// TMDB named from its title when the portal gave no IMDb id.
const valid = (p) => Array.isArray(p) && typeof p[0] === "string" && Number.isInteger(p[1]) && p[1] >= 0
  && (IMDB.test(p[0]) || (p[0] === "" && validTmdb(p[1])));

/** `ids` as the contract reads them: `{ imdb, tmdb? }`, `{ tmdb }`, or null for a payload that names none. */
const idsOfPayload = (p) => {
  if (!valid(p)) return null;
  if (p[0] === "") return { tmdb: p[1] };
  return validTmdb(p[1]) ? { imdb: p[0], tmdb: p[1] } : { imdb: p[0] };
};

export function makeIdsStore({ kino, clock }) {
  const cache = makeByteCache({ kino, key: KEY, budgetBytes: BUDGET_BYTES, clock, ttlMs: KEEP_MS, valid });

  /**
   * Remembers the same ids for every `siblings` season of a series (2.2.21): the IMDb and TMDB ids name the SERIES, and
   * the portal lists each season as a title of its own, so a card of a season nobody opened carries them too. A
   * sibling the person opens later states its own and overwrites. Never throws.
   */
  function rememberSeasons(siblings, imdb, tmdb = 0) {
    try {
      for (const s of Array.isArray(siblings) ? siblings : []) if (s && typeof s.id === "string") remember(s.id, imdb, tmdb);
    } catch (_) { /* cards just go without ids */ }
  }

  /**
   * Remembers what a detail answer said about `contentId`: its IMDb id and, when TMDB matched it, TMDB's.
   * A known TMDB id is never forgotten by a later answer that did not ask TMDB. Writes only on a change.
   * Never throws.
   */
  function remember(contentId, imdb, tmdb = 0) {
    try {
      if (typeof contentId !== "string" || contentId.trim() === "" || typeof imdb !== "string") return;
      if (!IMDB.test(imdb) && !(imdb === "" && validTmdb(tmdb))) return;
      const entries = cache.read();
      const old = cache.get(contentId, entries);
      const keptTmdb = validTmdb(tmdb) ? tmdb : old && old[0] === imdb ? old[1] : 0;
      if (old && old[0] === imdb && old[1] === keptTmdb) return;
      cache.write([{ k: contentId, i: [imdb, keptTmdb] }]);
    } catch (_) { /* cards just go without ids */ }
  }

  /** A lookup over what is stored now (one storage read): `(contentId) => ids | null`. Never throws. */
  function lookup() {
    let byId;
    try {
      byId = new Map(cache.read().map((e) => [e.k, e.i]));
    } catch (_) { byId = new Map(); }
    return (contentId) => (byId.has(contentId) ? idsOfPayload(byId.get(contentId)) : null);
  }

  return { remember, rememberSeasons, lookup };
}
