// Home and browse over the Magis catalog (native-magis.md §4.1, §4.2); `search` lives in search.js
// (§4.4) and `episodes` in episodes.js (§4.3); both are composed in. Each public function is self-contained.
import { classify, KINDS } from "./homeClassifier.js";
import { parseTree, encodeTree, decodeTree, storedLength, refOf, parseShelveTime } from "./homeTree.js";
import { isSeries } from "./refs.js";
import { makeSearch } from "./search.js";
import { makePortalChapters, makeEpisodes } from "./episodes.js";
import { viewOpts, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { isKinoError } from "./util.js";

export { parseShelveTime };

// The portal's codes for the four VOD roots (adultos is never asked for).
const ROOT_CODES = { peliculas: "masnew_movies", series: "masnew_series", anime: "masnew_anime", infantil: "masnew_kids" };
const TREE_TTL_MS = 2 * 3600_000;
const TREE_PAGE_SIZE = 60;
// Per-root budget for the stored tree: kino.storage is 256 KB for the whole plugin and a set over
// the cap throws, so the four home trees together get 80 KB. A tree that does not fit is shed in
// this order until it does: description to 120 chars, to 0, genres, backdrop, then fewer items per
// section (never below 50, one browse page); if it still does not fit it is not cached.
const TREE_BUDGET_BYTES = 20_000;
const SHED_STEPS = [
  {},
  { descMax: 120 },
  { descMax: 0 },
  { descMax: 0, genres: false },
  { descMax: 0, genres: false, backdrop: false },
  { descMax: 0, genres: false, backdrop: false, perSection: 100 },
  { descMax: 0, genres: false, backdrop: false, perSection: 50 },
];

const BROWSE_PAGE = 50;
// Every root failed: the pass is asked once more after this pause (native EMPTY_PASS_RETRY_DELAYS_MS
// starts at 1.5 s), only when at least the pause plus this much of the call's time is left.
const HOME_RETRY_PAUSE_MS = 1_500;
const HOME_RETRY_MIN_MS = 3_000;
const MAX_HOME_ROWS = 20; // SDK output caps
const MAX_ROW_ITEMS = 60;
const MAX_GENRES = 5;
const NEW_WINDOW_MS = 48 * 3600_000;
const ITEM_ID = /^[A-Za-z0-9._~-]{1,128}$/;

/** One classified item as the SDK's item shape; null when its id cannot be used. */
function projectItem(item, nowMs) {
  if (!ITEM_ID.test(item.id)) return null;
  const out = {
    id: item.id,
    ref: refOf(item),
    title: item.title.trim() === "" ? item.id : item.title,
    kind: isSeries(item.type) ? "series" : "movie",
  };
  if (item.poster) out.poster = item.poster;
  if (item.backdrop) out.backdrop = item.backdrop;
  if (item.description.trim() !== "") out.overview = item.description;
  if (item.genres.length > 0) out.genres = item.genres.slice(0, MAX_GENRES);
  if (item.score !== null && Number.isFinite(item.score) && item.score >= 0 && item.score <= 10) out.rating = item.score;
  const minutes = Math.trunc(item.durationS / 60);
  if (minutes >= 1 && minutes <= 1000) out.runtimeMinutes = minutes;
  // Uploaded in the last 48 h: the mark rides in `badges`, so the cards need no new field.
  if (item.shelvedAtMs > 0 && nowMs - item.shelvedAtMs <= NEW_WINDOW_MS) out.badges = ["NUEVO"];
  return out;
}

/** Classified rows as home rows: `ref` is the row id, empty rows dropped, SDK caps applied. */
export function projectRows(rows, nowMs) {
  const out = [];
  for (const r of rows) {
    const items = r.shown.map((i) => projectItem(i, nowMs)).filter((i) => i !== null).slice(0, MAX_ROW_ITEMS);
    if (items.length > 0) out.push({ id: r.id, title: r.title, ref: r.id, items });
  }
  return out.slice(0, MAX_HOME_ROWS);
}

// A tree with columns but no item is as empty as no tree: never cached, its root counts as missing.
const hasItems = (sections) => sections.some((s) => s.items.length > 0);

const INT = /^[+-]?\d+$/;
// null/garbage/negative cursors mean 0.
function offsetOf(cursor) {
  if (typeof cursor !== "string" || !INT.test(cursor)) return 0;
  const n = Number(cursor);
  return n > 0 && n <= 2147483647 ? n : 0;
}

export function makeCatalog({ kino, portal, session, clock, tmdb = null }) {
  const key = (root) => `tree:${root}`;

  function readTree(root) {
    try {
      const raw = kino.storage.get(key(root));
      if (raw === null || raw === undefined) return null;
      const sections = decodeTree(raw);
      return hasItems(sections) ? sections : null;
    } catch (_) { return null; }
  }

  // Never called with an empty tree. A tree that does not fit even without descriptions is simply
  // not cached (the next call refetches it).
  function writeTree(root, sections) {
    for (const shed of SHED_STEPS) {
      const text = encodeTree(sections, shed);
      if (storedLength(text) > TREE_BUDGET_BYTES) continue; // as the app stores it: escaped
      try { kino.storage.set(key(root), text, { ttlMs: TREE_TTL_MS }); } catch (_) { /* storage full: serve uncached */ }
      return;
    }
  }

  // `{ sections, error }`: a failing root shows as empty, but its error is kept so that a Home where
  // EVERY root failed can say so instead of being a silent blank (main 2d285106 + 465773f1).
  async function fetchRoot(root, deadline) {
    try {
      const response = await session.withValidSession((v) => portal.call(
        "getNextColumns",
        { columnCode: ROOT_CODES[root], pageNum: 1, pageSize: TREE_PAGE_SIZE, version: "" },
        viewOpts(v),
      ), { seedFallback: true, deadline });
      const sections = parseTree(response);
      if (!hasItems(sections)) return { sections: [], error: null };
      writeTree(root, sections);
      return { sections, error: null };
    } catch (e) {
      try { kino.log(`xuper home ${root}: ${(e && (e.code || e.name)) || "error"}`); } catch (_) {}
      return { sections: [], error: isKinoError(e) ? e : kino.error("unavailable", "Xuper no está disponible ahora") };
    }
  }

  // Every root asked failed (none cached, none answered, not even empty).
  const allFailed = (fetched) => fetched.length === KINDS.length && fetched.every((f) => f.error !== null);
  // What to tell the person: a root's specific error (geo, account...) before a plain unavailable.
  const worstOf = (fetched) => (fetched.find((f) => f.error.name !== "KinoError_unavailable") || fetched[0]).error;

  // The classified rows over the four roots: stored trees first, the rest from the portal in parallel.
  async function buildRows() {
    const deadline = callDeadline(clock, CALL_BUDGET_MS.home); // home and browse share the 20 s cap
    const roots = {};
    const missing = [];
    for (const { root } of KINDS) {
      const cached = readTree(root);
      if (cached) roots[root] = cached; else missing.push(root);
    }
    if (missing.length > 0) {
      // The session is not created by withValidSession: ensure it first; a failure here is the error.
      await session.ensure({ deadline });
      const pass = () => Promise.all(missing.map((root) => fetchRoot(root, deadline)));
      let fetched = await pass();
      if (allFailed(fetched)) {
        // Every root failed: one more pass after a short pause (native), if the call's time allows;
        // still all failed, the error is thrown so Home says Xuper failed and offers "Reintentar".
        if (deadline - clock.now() >= HOME_RETRY_PAUSE_MS + HOME_RETRY_MIN_MS) {
          try { await kino.sleep(HOME_RETRY_PAUSE_MS); } catch (_) { /* no pause: retry at once */ }
          fetched = await pass();
        }
        if (allFailed(fetched)) throw worstOf(fetched);
      }
      missing.forEach((root, i) => { roots[root] = fetched[i].sections; });
    }
    return classify(roots);
  }

  async function home() {
    return projectRows(await buildRows(), clock.now());
  }

  async function browse(ref, cursor) {
    const row = typeof ref === "string" ? (await buildRows()).find((r) => r.id === ref) : undefined;
    if (!row) throw kino.error("not_found", "No se encontró esa lista");
    const offset = offsetOf(cursor);
    const nowMs = clock.now();
    const items = row.all.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs)).filter((i) => i !== null);
    const next = offset + BROWSE_PAGE;
    return next < row.all.length ? { items, next: String(next) } : { items };
  }

  const { search } = makeSearch({ kino, portal, session, clock, tmdb });

  // The chapter list is shared with resolve, which looks a chapter up by its number.
  const portalChapters = makePortalChapters({ kino, portal, session, clock });
  const episodes = makeEpisodes({ kino, tmdb, portalChapters, clock });

  return { home, browse, search, episodes, portalChapters };
}
