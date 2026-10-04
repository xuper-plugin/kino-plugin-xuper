// Home and browse over the Magis catalog (native-magis.md §4.1, §4.2); `search` lives in search.js
// (§4.4) and `episodes` in episodes.js (§4.3); both are composed in. Each public function is self-contained.
import { classify, KINDS } from "./homeClassifier.js";
import { parseTree, refOf, parseShelveTime } from "./homeTree.js";
import { fitRows, makeRowsStore } from "./rowsStore.js";
import { isSeries } from "./refs.js";
import { makeSearch } from "./search.js";
import { makePortalChapters, makeEpisodes } from "./episodes.js";
import { viewOpts, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { isKinoError } from "./util.js";
import { trace, errCode } from "./trace.js";

export { parseShelveTime };

// The portal's codes for the four VOD roots Home, section and categories share (adultos is not one).
const ROOT_CODES = { peliculas: "masnew_movies", series: "masnew_series", anime: "masnew_anime", infantil: "masnew_kids" };
// The 18+ root (native "adultos", TvCatalogSections "18+"): asked ON DEMAND only, by browse of its one
// Categorías tile, never stored, never part of the shared roots. Movies only, every item adult (D3).
export const ADULT_ROOT_CODE = "masnew_adult";
export const ADULT_REF = "magis_adultos";
// The classified rows are fresh for 2 h. After that they are still served at once while a refresh
// runs in the background (stale-while-revalidate); the stored snapshot is kept 14 days, so a cold
// start answers from storage instead of fetching, parsing and classifying four roots (more than the
// call's 20 s on a 32-bit TV).
const ROWS_FRESH_MS = 2 * 3600_000;
const SNAPSHOT_TTL_MS = 14 * 24 * 3600_000;
const TREE_PAGE_SIZE = 60;
const REFRESH_GAP_MS = 5 * 60_000;
// Background work is done in slices inside calls (see makeCatalog): a call starts a slice only while it
// has run for less than this, and a slice's portal fetch gets this budget (the call's margin taken off).
const SLICE_START_MS = 1_500;
const SLICE_FETCH_MS = 8_000;

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

// Lowercase, no accents, words only: "¡Pequeña Miss!" -> "pequena miss".
const plainWords = (text) => String(text).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * A row's items matching [q], ranked like the global search: a title holding every word of the query (part of a word
 * counts, as a typed query is often unfinished) or one kino.rank.filterRelevant keeps, then kino.rank.sortBySimilarity.
 */
export function rankWithin(kino, pool, q) {
  const words = plainWords(q).split(" ").filter((w) => w !== "");
  const forms = [q];
  const titlesOf = (item) => [item.title];
  const relevant = new Set(kino.rank.filterRelevant(pool, forms, titlesOf));
  const hits = pool.filter((item) => {
    if (relevant.has(item)) return true;
    const title = plainWords(item.title);
    return words.length > 0 && words.every((w) => title.includes(w));
  });
  return kino.rank.sortBySimilarity(hits, forms, titlesOf);
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

/**
 * `countryRow`: optional `async (deadline) => row | null` (countryRow.js), the Home "Canales en vivo"
 * row appended after the VOD rows; it never throws.
 */
export function makeCatalog({ kino, portal, session, clock, tmdb = null, countryRow = null }) {
  const store = makeRowsStore({ kino, ttlMs: SNAPSHOT_TTL_MS });
  const stale = (at) => { const age = clock.now() - at; return age < 0 || age >= ROWS_FRESH_MS; };

  // In memory for the runtime's life (Kino keeps it 5 idle minutes): the trees of the roots that
  // answered with items (`root -> { sections, at }`), and the full classified rows once every root answered.
  const trees = new Map();
  let full = null; // { rows, at }
  // The stored snapshot, read at most once per runtime: undefined = not read yet, null = none.
  let snapshot;

  // The rows that keep every shown item in a snapshot too small for all of them: enough for Home's
  // 20 rows (counting only rows with an item whose id can be shown, as projectRows does), plus one.
  function homeRowsCount(rows) {
    let shown = 0;
    for (let n = 0; n < rows.length; n++) {
      if (rows[n].shown.some((i) => ITEM_ID.test(i.id)) && ++shown >= MAX_HOME_ROWS) return n + 2;
    }
    return rows.length;
  }

  function saveSnapshot(rows, at) {
    const fit = fitRows(rows, { keepFull: homeRowsCount(rows) });
    if (fit === null) { trace(kino, "store", "skip", { what: "rows" }); return; }
    if (fit.step > 0) trace(kino, "store", "trim", { what: "rows", step: fit.step });
    try {
      store.write(fit.text, at);
      snapshot = undefined; // the next cold read decodes what was just written
    } catch (e) { trace(kino, "store", "full", { what: "rows", code: errCode(e) }); /* served from memory */ }
  }

  function readSnapshot() {
    if (snapshot === undefined) snapshot = store.read();
    return snapshot;
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
      return { sections: hasItems(sections) ? sections : [], error: null };
    } catch (e) {
      trace(kino, "home", "root_fail", { root, code: errCode(e) });
      return { sections: [], error: isKinoError(e) ? e : kino.error("unavailable", "Xuper no está disponible ahora") };
    }
  }

  // A root being fetched right now: concurrent cold callers (home, section, categories, browse) share
  // that fetch instead of asking the portal again. Dropped once it settles, so nothing is pinned.
  // A joiner inherits the first caller's deadline, which can only be earlier than its own.
  const inflight = new Map();
  function sharedFetchRoot(root, deadline) {
    let pending = inflight.get(root);
    if (!pending) {
      pending = fetchRoot(root, deadline).finally(() => inflight.delete(root));
      inflight.set(root, pending);
    }
    return pending;
  }

  // Every root asked failed (none cached, none answered, not even empty).
  const allFailed = (fetched) => fetched.length === KINDS.length && fetched.every((f) => f.error !== null);
  // What to tell the person: a root's specific error (geo, account...) before a plain unavailable.
  const worstOf = (fetched) => (fetched.find((f) => f.error.name !== "KinoError_unavailable") || fetched[0]).error;

  // A Home where every root failed writes many lines (geo, seeds, failover per root and pass); the app
  // sends only the newest 30 / 2 KB. One compact line last, so the causes survive the cut: how many
  // roots, how many passes, and up to three distinct error codes, most specific first.
  function summarizeFailure(fetched, passes) {
    const codes = [];
    for (const f of [...fetched].sort((a, b) => (a.error.name === "KinoError_unavailable") - (b.error.name === "KinoError_unavailable"))) {
      const c = errCode(f.error);
      if (!codes.includes(c)) codes.push(c);
    }
    const fields = { roots: fetched.length, rounds: passes };
    codes.slice(0, 3).forEach((c, i) => { fields["c" + (i + 1)] = c; });
    trace(kino, "home", "all_fail", fields);
  }

  // The classified rows over the four roots from the portal: the trees kept in memory first (all of
  // them ignored when `refresh`), the rest asked in parallel. When every root answered, the rows are
  // kept in memory and stored as the snapshot. `budgetMs`: the calling export's cap.
  async function fetchRows(budgetMs, refresh = false) {
    const deadline = callDeadline(clock, budgetMs);
    const roots = {};
    const missing = [];
    for (const { root } of KINDS) {
      const kept = trees.get(root);
      if (!refresh && kept && !stale(kept.at)) roots[root] = kept.sections; else missing.push(root);
    }
    let complete = true;
    if (missing.length > 0) {
      // The session is not created by withValidSession: ensure it first; a failure here is the error.
      await session.ensure({ deadline });
      const pass = () => Promise.all(missing.map((root) => sharedFetchRoot(root, deadline)));
      let fetched = await pass();
      let passes = 1;
      if (allFailed(fetched)) {
        // Every root failed: one more pass after a short pause (native), if the call's time allows;
        // still all failed, the error is thrown so Home says Xuper failed and offers "Reintentar".
        if (deadline - clock.now() >= HOME_RETRY_PAUSE_MS + HOME_RETRY_MIN_MS) {
          try { await kino.sleep(HOME_RETRY_PAUSE_MS); } catch (_) { /* no pause: retry at once */ }
          fetched = await pass();
          passes = 2;
        }
        if (allFailed(fetched)) {
          summarizeFailure(fetched, passes);
          throw worstOf(fetched);
        }
      }
      const at = clock.now();
      missing.forEach((root, i) => {
        const { sections, error } = fetched[i];
        if (error !== null) complete = false;
        // A tree with no item is as empty as no tree: never kept, asked again by the next call. A root
        // that failed keeps, and shows, the tree it had (a refresh never loses one).
        const kept = trees.get(root);
        if (hasItems(sections)) trees.set(root, { sections, at });
        else if (error === null) trees.delete(root);
        roots[root] = error !== null && kept ? kept.sections : sections;
      });
    }
    const rows = classify(roots);
    // Only a whole answer is kept (a failed root is asked again by the next call) and never an empty one.
    if (complete && rows.length > 0) {
      const at = clock.now();
      full = { rows, at };
      saveSnapshot(rows, at);
    }
    return rows;
  }

  // ---- background work, in slices --------------------------------------------------------------
  // Kino's call returns only once the sandbox's job queue is empty and every kino.fetch has settled
  // (quickjs-kt's evaluate drains them): nothing runs "after" a call, and a build left running would
  // hold the answer of the call that started it (2.2.5 on the KALLEY: section ok in 32 ms, delivered
  // after 20 s). So the work that refreshes stale rows, or completes a partial snapshot, is done in
  // slices that the catalog's calls await: one root fetched and parsed, then the classification, then
  // the snapshot write. A call starts a new slice only while it has run for less than SLICE_START_MS,
  // so it pays about one slice (about 2 s on a 32-bit TV) on top of its answer, served from what is
  // kept. The work lives in memory: a sandbox thrown away starts it again from the snapshot.
  let work = null; // { why, todo: [root], results: { root: { sections, error } }, rows, save }
  let workEndedAt = -Infinity; // a failed or incomplete pass is tried again only REFRESH_GAP_MS later

  function want(why) {
    if (work || clock.now() - workEndedAt < REFRESH_GAP_MS) return;
    trace(kino, "home", "refresh", { why });
    // "stale" asks every root again and stores the result; "partial" only needs the full rows in memory
    // (the stored snapshot is current) and reuses the trees already kept.
    const todo = KINDS.map((k) => k.root).filter((root) => why === "stale" || !trees.has(root) || stale(trees.get(root).at));
    work = { why, todo, results: {}, rows: null, save: why === "stale" };
  }

  function endWork(ok) {
    if (!ok) workEndedAt = clock.now();
    work = null;
  }

  async function slice() {
    const w = work;
    if (w.todo.length > 0) {
      const root = w.todo[0];
      const deadline = callDeadline(clock, SLICE_FETCH_MS);
      await session.ensure({ deadline });
      w.results[root] = await sharedFetchRoot(root, deadline);
      w.todo.shift();
      return;
    }
    if (w.rows === null) {
      const results = Object.entries(w.results);
      if (results.length > 0 && results.every(([, r]) => r.error !== null)) {
        trace(kino, "home", "refresh_fail", { code: errCode(results[0][1].error) });
        return endWork(false);
      }
      const at = clock.now();
      const roots = {};
      let complete = true;
      for (const { root } of KINDS) {
        const r = w.results[root];
        const kept = trees.get(root);
        if (!r) { roots[root] = kept ? kept.sections : []; continue; }
        if (r.error !== null) complete = false;
        if (hasItems(r.sections)) trees.set(root, { sections: r.sections, at });
        else if (r.error === null) trees.delete(root);
        roots[root] = r.error !== null && kept ? kept.sections : r.sections;
      }
      // An incomplete pass keeps what is served; it is tried again later.
      if (!complete) return endWork(false);
      const rows = classify(roots);
      if (rows.length === 0) return endWork(false);
      full = { rows, at };
      w.rows = rows;
      if (!w.save) endWork(true);
      return;
    }
    saveSnapshot(w.rows, full.at);
    endWork(true);
  }

  // Runs slices while the call is young; a slice that throws ends the pass (never the call).
  async function advance(startedAt) {
    while (work && clock.now() - startedAt < SLICE_START_MS) {
      try { await slice(); } catch (e) { trace(kino, "home", "refresh_fail", { code: errCode(e) }); endWork(false); }
    }
  }

  // Concurrent cold callers (home and categories at start-up) share one build: one classification,
  // one snapshot write. A joiner inherits the first caller's deadline.
  let building = null;
  function sharedFetchRows(budgetMs) {
    if (!building) building = fetchRows(budgetMs).finally(() => { building = null; });
    return building;
  }

  /**
   * The classified rows. `need`: "home" and "categories" read only `shown` of their rows, "section"
   * every row's `shown`, "full" also `all` (browse, scoped search). Whatever is kept is served: the
   * full rows in memory, else the stored snapshot, even stale or partial (a partial row has only its
   * first items and a snapshot row no `all`). What is missing is built in slices across calls (see
   * `slice`). The portal is waited for in full only when nothing is kept at all.
   */
  async function buildRows(budgetMs = CALL_BUDGET_MS.home, need = "full") {
    const startedAt = clock.now();
    if (full) {
      if (stale(full.at)) want("stale");
    } else {
      const snap = readSnapshot();
      if (!snap) return sharedFetchRows(budgetMs);
      if (stale(snap.at)) want("stale");
      else if (!snap.complete ? need !== "home" && need !== "categories" : need === "full") want("partial");
    }
    await advance(startedAt);
    return full ? full.rows : readSnapshot().rows;
  }

  async function home() {
    // Asked alongside the VOD rows, inside home's own deadline; its failure is no row (never a throw).
    const live = countryRow ? countryRow(callDeadline(clock, CALL_BUDGET_MS.home)).catch(() => null) : Promise.resolve(null);
    const rows = projectRows(await buildRows(CALL_BUDGET_MS.home, "home"), clock.now());
    const row = await live;
    return row ? [...rows.slice(0, MAX_HOME_ROWS - 1), row] : rows;
  }

  // The 18+ root's movies, deduplicated in the portal's order. Concurrent pages share one fetch.
  let adultInflight = null;
  async function fetchAdult(deadline) {
    await session.ensure({ deadline });
    const response = await session.withValidSession((v) => portal.call(
      "getNextColumns",
      { columnCode: ADULT_ROOT_CODE, pageNum: 1, pageSize: TREE_PAGE_SIZE, version: "" },
      viewOpts(v),
    ), { seedFallback: true, deadline });
    const seen = new Set();
    const out = [];
    for (const s of parseTree(response)) {
      for (const item of s.items) {
        if (isSeries(item.type) || seen.has(item.id)) continue; // native plays the 18+ movies only
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }
  function adultMovies(deadline) {
    if (!adultInflight) adultInflight = fetchAdult(deadline).finally(() => { adultInflight = null; });
    return adultInflight;
  }

  async function browseAdult(cursor) {
    const all = await adultMovies(callDeadline(clock, CALL_BUDGET_MS.browse));
    const offset = offsetOf(cursor);
    const nowMs = clock.now();
    const items = all.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs)).filter((i) => i !== null)
      .map((i) => ({ ...i, adult: true }));
    const next = offset + BROWSE_PAGE;
    return next < all.length ? { items, next: String(next) } : { items };
  }

  async function browse(ref, cursor) {
    if (ref === ADULT_REF) return browseAdult(cursor);
    const row = typeof ref === "string" ? (await buildRows()).find((r) => r.id === ref) : undefined;
    if (!row) throw kino.error("not_found", "No se encontró esa lista");
    const offset = offsetOf(cursor);
    const nowMs = clock.now();
    // A row from the snapshot has no `all`: its shown items are the page, with no next (the full rows
    // are being built in the background for the next visit).
    const list = row.all ?? (offset === 0 ? row.shown : []);
    const items = list.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs)).filter((i) => i !== null);
    const next = offset + BROWSE_PAGE;
    return row.all && next < list.length ? { items, next: String(next) } : { items };
  }

  const { search: globalSearch } = makeSearch({ kino, portal, session, clock, tmdb });

  // Kino's scopedSearch (apiVersion 6): `within` is the browse ref of a "Ver más" page. Those rows are Xuper's own
  // classification across the portal's sections (type x genre, featured), so no portal column matches one and its
  // searchByName cannot be restricted to it: the row's tree (Home's cache, no new storage key) is filtered here and
  // ranked like the global search, inside the search's own budget. The 18+ tile is searched only when asked (its
  // movies stay marked adult); an unknown row answers null.
  async function searchWithin(query) {
    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (q === "") return { items: [] };
    const within = query.within;
    const adult = within === ADULT_REF;
    let pool;
    if (adult) {
      pool = await adultMovies(callDeadline(clock, CALL_BUDGET_MS.search));
    } else {
      const row = typeof within === "string" ? (await buildRows(CALL_BUDGET_MS.search)).find((r) => r.id === within) : undefined;
      // Not one of our refs: null is scopedSearch's "can't search there" (Kino filters the page itself), not a failure.
      if (!row) return null;
      pool = row.all ?? row.shown; // a snapshot row: its shown items until the full rows are built
    }
    const ranked = rankWithin(kino, pool, q);
    const offset = offsetOf(query.cursor);
    const nowMs = clock.now();
    const items = ranked.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs)).filter((i) => i !== null)
      .map((i) => (adult ? { ...i, adult: true } : i));
    const next = offset + BROWSE_PAGE;
    return next < ranked.length ? { items, next: String(next) } : { items };
  }

  async function search(query) {
    if (query !== null && typeof query === "object" && query.within !== undefined && query.within !== null) return searchWithin(query);
    return globalSearch(query);
  }

  // The chapter list is shared with resolve, which looks a chapter up by its number.
  const portalChapters = makePortalChapters({ kino, portal, session, clock });
  const episodes = makeEpisodes({ kino, tmdb, portalChapters, clock });

  // The classified rows of the four roots (the same kept rows Home reads), for section and categories:
  // `need` is "section" or "categories" (see buildRows).
  const rows = (budgetMs, need = "full") => buildRows(budgetMs, need);

  return { home, browse, rows, search, episodes, portalChapters };
}
