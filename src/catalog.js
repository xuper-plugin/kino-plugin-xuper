// Home and browse over the Magis catalog (native-magis.md §4.1, §4.2); `search` lives in search.js
// (§4.4) and `episodes` in episodes.js (§4.3); both are composed in. Each public function is self-contained.
import { classify, KINDS } from "./homeClassifier.js";
import { parseTree, refOf, parseShelveTime } from "./homeTree.js";
import { fitRows, makeRowsStore, decodeLegacyTree } from "./rowsStore.js";
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
const SLICE_MARGIN_MS = 2_000; // as callDeadline's: what a slice leaves of the calling export's cap
const SLICE_FETCH_MS = 14_000;

const BROWSE_PAGE = 50;
// Every root of a cold pass failed: the pass is asked once more after this pause (native
// EMPTY_PASS_RETRY_DELAYS_MS starts at 1.5 s).
const HOME_RETRY_PAUSE_MS = 1_500;
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

  // ---- the work, in slices -----------------------------------------------------------------------
  // Kino's call returns only once the sandbox's job queue is empty and every kino.fetch has settled
  // (quickjs-kt's evaluate drains them): nothing runs "after" a call, and work left running holds the
  // answer of the call that started it (2.2.5 on the KALLEY: section ok in 32 ms, delivered after 20 s).
  // And a whole build takes longer than a call's 20 s on that TV (26 s with 2.2.4). So every build is a
  // pass of slices the catalog's calls await: one root fetched and parsed per slice, then the
  // classification, then the snapshot write. A call starts a slice only while it has run for less than
  // SLICE_START_MS, so it pays about one slice (about 2 s on the TV) on top of its answer, made of what
  // is kept so far; the pass goes on in the next calls. The pass lives in memory: a sandbox thrown away
  // starts again from what is stored.
  //
  // `why`: "cold" = nothing complete is kept (first start, or 2.2.3's storage): every root not in memory
  // is asked, a pass where every root failed is asked once more after a pause, and if that fails too the
  // call that ends it throws the error (Home says Xuper failed and offers "Reintentar"); a cold pass that
  // ends incomplete is simply started again by the next call. "stale" = rows older than 2 h are served
  // while every root is asked again. "partial" = the stored snapshot lacks rows section, browse or the
  // scoped search need: the roots are asked, the full rows kept in memory, nothing stored. A stale or
  // partial pass that fails keeps what is served and is tried again REFRESH_GAP_MS later.
  let work = null; // { why, asked: [root], todo: [root], results: { root: { sections, error } }, pass, rows, save }
  let workEndedAt = -Infinity;
  let treesVersion = 0;

  function want(why) {
    if (work) return;
    if (why !== "cold" && clock.now() - workEndedAt < REFRESH_GAP_MS) return;
    const asked = KINDS.map((k) => k.root).filter((root) => why === "stale" || !trees.has(root) || stale(trees.get(root).at));
    trace(kino, "home", "refresh", { why });
    work = { why, asked, todo: [...asked], results: {}, pass: 1, rows: null, save: why !== "partial" };
  }

  function endWork(ok) {
    if (!ok && work && work.why !== "cold") workEndedAt = clock.now();
    work = null;
  }

  function keepTree(root, r, at) {
    if (hasItems(r.sections)) trees.set(root, { sections: r.sections, at });
    else if (r.error === null) trees.delete(root);
    else return; // a failed root keeps, and shows, the tree it had
    treesVersion++;
  }

  async function slice(callEnd) {
    const w = work;
    if (w.todo.length > 0) {
      const root = w.todo[0];
      // A root's own budget, and never past the calling export's (search has 15 s, the rest 20 s).
      const deadline = Math.min(callDeadline(clock, SLICE_FETCH_MS), callEnd);
      // The session is not created by withValidSession: ensured once per pass; a failure is the slice's.
      if (!w.ensured) { await session.ensure({ deadline }); w.ensured = true; }
      const r = await sharedFetchRoot(root, deadline);
      w.results[root] = r;
      keepTree(root, r, clock.now());
      w.todo.shift();
      return;
    }
    if (w.rows === null) {
      const fetched = w.asked.map((root) => w.results[root]);
      // Every root asked failed (none kept, none answered, not even empty).
      if (fetched.length === KINDS.length && fetched.every((r) => r.error !== null)) {
        if (w.why !== "cold") { trace(kino, "home", "refresh_fail", { code: errCode(fetched[0].error) }); return endWork(false); }
        if (w.pass === 1) {
          // One more pass after a short pause (native EMPTY_PASS_RETRY_DELAYS_MS starts at 1.5 s).
          w.pass = 2;
          w.todo = [...w.asked];
          try { await kino.sleep(HOME_RETRY_PAUSE_MS); } catch (_) { /* no pause: retry at once */ }
          return;
        }
        summarizeFailure(fetched, 2);
        endWork(false);
        throw worstOf(fetched);
      }
      // Incomplete: what answered is kept in memory and shown, nothing is stored. A stale or partial pass
      // is tried again later; a cold one by the next call.
      if (fetched.some((r) => r.error !== null)) return endWork(false);
      const rows = classify(rootsKept());
      if (rows.length === 0) return endWork(false);
      full = { rows, at: clock.now() };
      w.rows = rows;
      if (!w.save) endWork(true);
      return;
    }
    saveSnapshot(w.rows, full.at);
    endWork(true);
  }

  const rootsKept = () => Object.fromEntries(KINDS.map(({ root }) => [root, trees.has(root) ? trees.get(root).sections : []]));

  // Runs slices while the call is young. A slice that throws ends its pass; a cold pass's error is the
  // call's (nothing is kept to answer with), any other is only logged.
  // One slice at a time even when calls overlap (Kino runs them one by one; a test may not).
  let running = null;
  function runSlice(callEnd) {
    if (!running) running = slice(callEnd).finally(() => { running = null; });
    return running;
  }

  async function advance(startedAt, budgetMs) {
    const callEnd = startedAt + budgetMs - SLICE_MARGIN_MS;
    while (work && clock.now() - startedAt < SLICE_START_MS) {
      const cold = work.why === "cold";
      try {
        await runSlice(callEnd);
      } catch (e) {
        trace(kino, "home", "refresh_fail", { code: errCode(e) });
        endWork(false);
        if (cold) throw e;
      }
    }
  }

  // The rows of the roots kept so far, while nothing complete is (classified once per change).
  let soFar = null;
  function rowsSoFar() {
    if (!soFar || soFar.version !== treesVersion) soFar = { version: treesVersion, rows: classify(rootsKept()) };
    return soFar.rows;
  }

  // 2.2.3 and older kept a root's tree under `tree:<root>` (2 h) when it fit: such a tree is a seed, shown
  // at once and asked again by the cold pass. Read once per sandbox; the snapshot write removes the keys.
  let seeded = false;
  function seedFromLegacyTrees() {
    if (seeded) return;
    seeded = true;
    for (const { root } of KINDS) {
      try {
        const raw = kino.storage.get(`tree:${root}`);
        if (typeof raw !== "string") continue;
        const sections = decodeLegacyTree(raw);
        if (!hasItems(sections)) continue;
        trees.set(root, { sections, at: clock.now() - ROWS_FRESH_MS }); // stale: asked again by the pass
        treesVersion++;
      } catch (_) { /* not a tree: ignored */ }
    }
    if (treesVersion > 0) trace(kino, "store", "seed", { what: "tree", roots: treesVersion });
  }

  /**
   * The classified rows. `need`: "home" and "categories" read only `shown` of their rows, "section"
   * every row's `shown`, "full" also `all` (browse, scoped search). What is kept is served: the full rows
   * in memory, else the stored snapshot, even stale or partial (a partial row has only its first items
   * and a snapshot row no `all`), else the rows of the roots fetched so far (none at first). What is
   * missing is built in slices across calls (see `slice`); no call ever waits for a whole build.
   */
  async function buildRows(need = "full", budgetMs = CALL_BUDGET_MS.home) {
    const startedAt = clock.now();
    let snap = null;
    if (full) {
      if (stale(full.at)) want("stale");
    } else if ((snap = readSnapshot())) {
      if (stale(snap.at)) want("stale");
      else if (!snap.complete ? need !== "home" && need !== "categories" : need === "full") want("partial");
    } else {
      seedFromLegacyTrees();
      want("cold");
    }
    await advance(startedAt, budgetMs);
    if (full) return full.rows;
    if (snap) return snap.rows;
    const rows = rowsSoFar();
    // Nothing to show and every root asked so far failed: that error is this call's (Home says Xuper
    // failed and offers "Reintentar"); the pass goes on with the next call.
    if (rows.length === 0 && work && work.why === "cold") {
      const done = Object.values(work.results);
      if (done.length > 0 && done.every((r) => r.error !== null)) { summarizeFailure(done, work.pass); throw worstOf(done); }
    }
    return rows;
  }

  // A row not (yet) found while the first pass is still running: "try again", never "no such list".
  function rowMissing() {
    if (!full && work && work.why === "cold") throw kino.error("unavailable", "Xuper todavía está cargando su catálogo, intenta de nuevo en un momento");
    throw kino.error("not_found", "No se encontró esa lista");
  }

  async function home() {
    // Asked alongside the VOD rows, inside home's own deadline; its failure is no row (never a throw).
    const live = countryRow ? countryRow(callDeadline(clock, CALL_BUDGET_MS.home)).catch(() => null) : Promise.resolve(null);
    const rows = projectRows(await buildRows("home", CALL_BUDGET_MS.home), clock.now());
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
    const row = typeof ref === "string" ? (await buildRows("full", CALL_BUDGET_MS.browse)).find((r) => r.id === ref) : undefined;
    if (!row) rowMissing();
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
      const row = typeof within === "string" ? (await buildRows("full", CALL_BUDGET_MS.search)).find((r) => r.id === within) : undefined;
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
  const rows = (need = "full") => buildRows(need, CALL_BUDGET_MS[need] ?? CALL_BUDGET_MS.home);

  return { home, browse, rows, search, episodes, portalChapters };
}
