// A movie's own `details(ref)` (apiVersion 8): only its ids. The portal's search and list cards name no id and a movie has
// no `episodes()` call, so Kino could not tell TMDB which film a page was (no logo, synopsis or cast). The ids come from,
// in order: TMDB's own search by the title the card was drawn with (titlesStore.js) when it CLEARLY means one film
// (pickMovieByTitle), else the IMDb id the portal's detail names in `keyWords` (its detail call is not answered for every
// movie). Never a guess: with neither, the answer is `null`.
import { decode, isSeries } from "./refs.js";
import { callDeadline } from "./portal.js";
import { trace } from "./trace.js";

const IMDB = /^tt\d{7,10}$/;
const TMDB_MS = 8000;

// `portalChapters(contentId)`: episodes.js's cached detail read (imdb, title). `tmdb`: the TMDB client or null.
// `ids` (idsStore.js, optional): what is learned is remembered so the next card of that movie carries it.
// `titles` (titlesStore.js, optional): the title each movie card was drawn with.
export function makeDetails({ kino, tmdb = null, portalChapters, clock = null, ids = null, titles = null }) {
  const bounds = () => (clock ? { deadline: callDeadline(clock, TMDB_MS) } : undefined);

  async function byTitle(contentId, title, year = "") {
    if (!tmdb || typeof tmdb.movieByTitle !== "function" || typeof title !== "string" || title.trim() === "") return null;
    let found = null;
    try { found = await tmdb.movieByTitle(title, bounds(), year); } catch (_) { found = null; }
    const ok = found && Number.isInteger(found.tmdbId) && found.tmdbId > 0;
    trace(kino, "details", "tmdb", { match: ok ? 1 : 0 });
    if (!ok) return null;
    if (ids) ids.remember(contentId, "", found.tmdbId);
    return { ids: { tmdb: found.tmdbId } };
  }

  return async function details(ref) {
    let r;
    try { r = decode(ref); } catch (_) { return null; }
    if (r === null || r === undefined || r.isSeries || isSeries(r.programType)) { trace(kino, "details", "skip", { why: "not_a_movie" }); return null; }
    // The title the card was drawn with: only whether there is one is logged, never the title.
    const remembered = titles ? titles.titleOf(r.contentId) : null;
    trace(kino, "details", "title", { remembered: remembered ? 1 : 0 });
    if (remembered) {
      const hit = await byTitle(r.contentId, remembered.title, remembered.year);
      if (hit) return hit;
    }
    let raw = null;
    try { raw = await portalChapters(r.contentId); } catch (_) { trace(kino, "details", "portal", { ok: 0 }); }
    if (raw) trace(kino, "details", "portal", { ok: 1, imdb: IMDB.test(raw.imdb) ? 1 : 0, titleLen: typeof raw.title === "string" ? raw.title.trim().length : 0 });
    if (raw && IMDB.test(raw.imdb)) {
      if (ids) ids.remember(r.contentId, raw.imdb);
      return { ids: { imdb: raw.imdb } };
    }
    // The portal's own title, only when no card title was remembered (or it matched nothing and this one differs).
    if (raw && typeof raw.title === "string" && raw.title.trim() !== "" && (!remembered || raw.title.trim() !== remembered.title)) {
      return byTitle(r.contentId, raw.title);
    }
    return null;
  };
}
