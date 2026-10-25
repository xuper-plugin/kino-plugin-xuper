// The titles of the movies the person has been shown (cards of Home, a "Ver más" page and search), by contentId (2.2.30).
// A movie's `details(ref)` gets only its ref, and the ref names no title; the portal's detail call is not answered for
// movies (xuper:details portal ok=0). The card was drawn with the title, so it is remembered here, in ONE byte-budgeted
// kino.storage key like the ids' (idsStore.js): details() then asks TMDB which film it is. Only titles of movies; the oldest
// go first. Never throws: with nothing remembered details() just has no title to search by.
import { makeByteCache } from "./byteCache.js";

const KEY = "titles:v1";
const BUDGET_BYTES = 12_000; // ~170 titles
const KEEP_MS = 30 * 24 * 3600_000; // a title does not change; a month bounds what a removed title leaves
const MAX_TITLE = 100;

const valid = (p) => Array.isArray(p) && typeof p[0] === "string" && p[0] !== "" && (p[1] === undefined || typeof p[1] === "string");

export function makeTitlesStore({ kino, clock }) {
  const cache = makeByteCache({ kino, key: KEY, budgetBytes: BUDGET_BYTES, clock, ttlMs: KEEP_MS, valid });

  /** Remembers the movie cards of `items` (SDK items: id, kind, title, year?): one write for the whole list. Never throws. */
  function rememberMovies(items) {
    try {
      const added = [];
      for (const it of Array.isArray(items) ? items : []) {
        if (it === null || typeof it !== "object" || it.kind !== "movie") continue;
        if (typeof it.id !== "string" || it.id === "" || typeof it.title !== "string" || it.title.trim() === "") continue;
        added.push({ k: it.id, i: [it.title.trim().slice(0, MAX_TITLE), it.year === undefined || it.year === null ? "" : String(it.year)] });
      }
      if (added.length > 0) cache.write(added);
    } catch (_) { /* details() just has no title */ }
  }

  /** `{ title, year }` remembered for `contentId`, or null. Never throws. */
  function titleOf(contentId) {
    try {
      const hit = cache.get(contentId);
      return Array.isArray(hit) ? { title: hit[0], year: typeof hit[1] === "string" ? hit[1] : "" } : null;
    } catch (_) { return null; }
  }

  return { rememberMovies, titleOf };
}
