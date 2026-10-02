// Home and browse over the Magis catalog (native-magis.md §4.1, §4.2). `search` and `episodes` join
// the returned object in later steps; each public function is self-contained and shares only the
// private helpers below.
import { classify, KINDS } from "./homeClassifier.js";
import { parseTree, encodeTree, decodeTree, utf8Length, refOf, parseShelveTime } from "./homeTree.js";
import { isSeries } from "./refs.js";

export { parseShelveTime };

// The portal's codes for the four VOD roots (adultos is never asked for).
const ROOT_CODES = { peliculas: "masnew_movies", series: "masnew_series", anime: "masnew_anime", infantil: "masnew_kids" };
const TREE_TTL_MS = 2 * 3600_000;
const TREE_PAGE_SIZE = 60;
// Per-root budget for the stored tree (the plugin's whole storage is 256 KB, shared with the session
// and the seed pool): descriptions are cut in steps before giving up on caching that root.
const TREE_BUDGET_BYTES = 40_000;
const DESCRIPTION_STEPS = [Infinity, 300, 120, 0];

const BROWSE_PAGE = 50;
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

export function makeCatalog({ kino, portal, session, clock }) {
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
    for (const max of DESCRIPTION_STEPS) {
      const text = encodeTree(sections, max);
      if (utf8Length(text) > TREE_BUDGET_BYTES) continue;
      try { kino.storage.set(key(root), text, { ttlMs: TREE_TTL_MS }); } catch (_) { /* storage full: serve uncached */ }
      return;
    }
  }

  // A failing root is an empty root (native: failure is indistinguishable from empty).
  async function fetchRoot(root) {
    try {
      const response = await session.withValidSession(({ userId, userToken }) => portal.call(
        "getNextColumns",
        { columnCode: ROOT_CODES[root], pageNum: 1, pageSize: TREE_PAGE_SIZE, version: "" },
        { baseFields: true, userId, userToken },
      ));
      const sections = parseTree(response);
      if (!hasItems(sections)) return [];
      writeTree(root, sections);
      return sections;
    } catch (e) {
      try { kino.log(`xuper home ${root}: ${(e && (e.code || e.name)) || "error"}`); } catch (_) {}
      return [];
    }
  }

  // The classified rows over the four roots: stored trees first, the rest from the portal in parallel.
  async function buildRows() {
    const roots = {};
    const missing = [];
    for (const { root } of KINDS) {
      const cached = readTree(root);
      if (cached) roots[root] = cached; else missing.push(root);
    }
    if (missing.length > 0) {
      // The session is not created by withValidSession: ensure it first; a failure here is the error.
      await session.ensure();
      const fetched = await Promise.all(missing.map(fetchRoot));
      missing.forEach((root, i) => { roots[root] = fetched[i]; });
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

  return { home, browse };
}
