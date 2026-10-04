// Home and browse over the Magis catalog (native-magis.md §4.1, §4.2); `search` lives in search.js
// (§4.4) and `episodes` in episodes.js (§4.3); both are composed in. Each public function is self-contained.
import { classify, mergeRoot, rootOfRow, KINDS } from "./homeClassifier.js";
import { parseTree, refOf, parseShelveTime } from "./homeTree.js";
import { fitRows, makeRowsStore } from "./rowsStore.js";
import { isSeries } from "./refs.js";
import { makeSearch } from "./search.js";
import { makePortalChapters, makeEpisodes } from "./episodes.js";
import { viewOpts, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { isKinoError } from "./util.js";
import { trace, report, errCode, msBucket, kbBucket, PERF_AREAS } from "./trace.js";

export { parseShelveTime };

// The portal's codes for the four VOD roots Home, section and categories share (adultos is not one).
const ROOT_CODES = { peliculas: "masnew_movies", series: "masnew_series", anime: "masnew_anime", infantil: "masnew_kids" };
// The 18+ root (native "adultos", TvCatalogSections "18+"): asked ON DEMAND only, by browse of its one
// Categorías tile, never stored, never part of the shared roots. Movies only, every item adult (D3).
export const ADULT_ROOT_CODE = "masnew_adult";
export const ADULT_REF = "magis_adultos";
// A root's rows are fresh for 2 h; older, they are still served while the root is fetched again
// (see makeCatalog). The stored snapshot is kept 14 days, so a start answers from storage.
const ROWS_FRESH_MS = 2 * 3600_000;
const SNAPSHOT_TTL_MS = 14 * 24 * 3600_000;
const TREE_PAGE_SIZE = 60;
// A root whose fetch failed is not asked again for this long while something is served.
const REFRESH_GAP_MS = 5 * 60_000;
// A call fetches roots only while it has run for less than this; a root's fetch gets this budget (the
// call's margin taken off, never past the calling export's cap).
const SLICE_START_MS = 1_500;
const SLICE_MARGIN_MS = 2_000; // as callDeadline's: what a slice leaves of the calling export's cap
const SLICE_FETCH_MS = 14_000;

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

  // ---- what is served, and how it is kept up to date ----------------------------------------------
  // Kino's call returns only once the sandbox's job queue is empty and every kino.fetch has settled
  // (quickjs-kt's evaluate drains them), so nothing can run after a call: work left running holds the
  // answer of the call that started it. And on a 32-bit TV one root (fetch, decode, parse) takes
  // seconds, while Kino may make a single call per start before the sandbox idles out. So the catalog
  // moves one root at a time, inside the calls, and stores its progress after each call:
  //
  // - `current` is what is served: the classified rows, when each root in them was fetched (`roots`),
  //   the roots whose rows keep every shown item (`whole`: a trimmed snapshot cuts rows past Home's)
  //   and the roots whose rows carry `all` (`withAll`: only rows classified in this sandbox). It starts
  //   as the stored snapshot.
  // - A call, while it has run for less than SLICE_START_MS, first fetches the root it needs whole
  //   (section's tab) or with `all` (the row browse or the scoped search pages), then a root `current`
  //   lacks, then the stalest root (older than 2 h); then it answers from `current`.
  // - A fetched root's rows replace that root's rows in `current` (mergeRoot). Once all four trees are
  //   in memory and fresh, the rows are classified together instead: exact.
  // - What changed is stored at the end of the call, so a sandbox thrown away loses nothing.
  const trees = new Map(); // root -> { sections, at }: fetched in this sandbox
  let current; // undefined: not read yet; null: nothing kept; else { rows, roots: { root: at }, whole: Set, withAll: Set }
  let dirty = false;
  const failedAt = new Map(); // root -> when its last fetch failed in this sandbox

  function getCurrent() {
    if (current === undefined) {
      const snap = store.read();
      current = snap ? { rows: snap.rows, roots: snap.roots, whole: new Set(snap.whole), withAll: new Set() } : null;
    }
    return current;
  }

  // The rows that keep every shown item in a snapshot too small for all of them: enough for Home's
  // 20 rows (counting only rows with an item whose id can be shown, as projectRows does), plus one.
  function homeRowsCount(rows) {
    let shown = 0;
    for (let n = 0; n < rows.length; n++) {
      if (rows[n].shown.some((i) => ITEM_ID.test(i.id)) && ++shown >= MAX_HOME_ROWS) return n + 2;
    }
    return rows.length;
  }

  function save() {
    dirty = false;
    const { rows, roots } = current;
    if (rows.length === 0) return; // nothing worth keeping: asked again next time
    const startedAt = clock.now();
    const keepFull = homeRowsCount(rows);
    const fit = fitRows(rows, { keepFull });
    if (fit === null) { trace(kino, "store", "skip", { what: "rows" }); return; }
    if (fit.step > 0) trace(kino, "store", "trim", { what: "rows", step: fit.step });
    // Past Home's rows a trimmed snapshot keeps one item per row: a root with such a row is not whole.
    const cut = fit.step === 0 ? new Set() : new Set(rows.slice(keepFull).filter((r) => r.shown.length > 1).map((r) => rootOfRow(r.id)));
    const whole = Object.keys(roots).filter((r) => current.whole.has(r) && !cut.has(r));
    try {
      store.write(fit.text, Math.min(...Object.values(roots)), roots, whole);
      report(kino, PERF_AREAS.store, "write", { b: msBucket(clock.now() - startedAt), kb: kbBucket(fit.text.length), step: fit.step });
    } catch (e) { trace(kino, "store", "full", { what: "rows", code: errCode(e) }); /* served from memory */ }
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

  // The next root to fetch, or null. `need` and `root`: see buildRows.
  function nextRoot(need, root, asked) {
    const cur = getCurrent();
    const roots = cur ? cur.roots : {};
    const all = KINDS.map((k) => k.root);
    const required = root !== null && all.includes(root) && (
      need === "section" ? !(cur && cur.whole.has(root)) : need === "full" ? !(cur && cur.withAll.has(root)) : false) ? [root] : [];
    const missing = all.filter((r) => !(r in roots));
    const stalest = all.filter((r) => r in roots && stale(roots[r])).sort((x, y) => roots[x] - roots[y]);
    const order = [...new Set([...required, ...missing, ...stalest])].filter((r) => !asked.has(r));
    // A root that failed waits REFRESH_GAP_MS while something is served; with nothing to show it is only
    // tried after the others.
    const failedRecently = (r) => failedAt.has(r) && clock.now() - failedAt.get(r) < REFRESH_GAP_MS;
    if (cur) return order.find((r) => !failedRecently(r)) ?? null;
    return [...order].sort((x, y) => (failedAt.get(x) ?? -Infinity) - (failedAt.get(y) ?? -Infinity))[0] ?? null;
  }

  // One root: fetched, parsed, and its rows put into `current`. A failure is returned, never thrown.
  async function rootSlice(root, deadline) {
    const r = await sharedFetchRoot(root, deadline);
    if (r.error !== null) { failedAt.set(root, clock.now()); return r; }
    failedAt.delete(root);
    const at = clock.now();
    trees.set(root, { sections: r.sections, at });
    // Stored again only when it brings something: a root the snapshot lacked or held stale. A root
    // fetched only to have its rows whole or with `all` (section, browse) keeps the stored time.
    const news = !current || !(root in current.roots) || stale(current.roots[root]);
    const roots = { ...(current ? current.roots : {}), ...(news ? { [root]: at } : {}) };
    if (KINDS.every(({ root: k }) => trees.has(k) && !stale(trees.get(k).at))) {
      const rows = classify(Object.fromEntries(KINDS.map(({ root: k }) => [k, trees.get(k).sections])));
      const everyRoot = KINDS.map(({ root: k }) => k);
      current = { rows, roots: Object.fromEntries(everyRoot.map((k) => [k, trees.get(k).at])), whole: new Set(everyRoot), withAll: new Set(everyRoot) };
    } else {
      const rows = mergeRoot(current ? current.rows : [], root, classify({ [root]: r.sections }));
      current = { rows, roots, whole: new Set([...(current ? current.whole : []), root]), withAll: new Set([...(current ? current.withAll : []), root]) };
    }
    if (news) dirty = true;
    return r;
  }

  /**
   * The classified rows. `need`: "home" and "categories" read only `shown` of the first rows; "section"
   * every shown item of `root`'s rows (the tab); "full" also `all` of `root`'s rows (the row browse or the
   * scoped search pages). The call fetches roots only while it is young (see above). With nothing to
   * serve and every root it asked failing, it throws that error (Home says Xuper failed, "Reintentar").
   */
  async function buildRows(need = "full", budgetMs = CALL_BUDGET_MS.home, root = null) {
    const startedAt = clock.now();
    const callEnd = startedAt + budgetMs - SLICE_MARGIN_MS;
    getCurrent();
    const storedBefore = current ? Object.keys(current.roots).length : 0;
    const failed = [];
    let ensured = false;
    const asked = new Set(); // a root at most once per call
    let next;
    while (clock.now() - startedAt < SLICE_START_MS && (next = nextRoot(need, root, asked)) !== null) {
      asked.add(next);
      // A root's own budget, and never past the calling export's (search has 15 s, the rest 20 s).
      const deadline = Math.min(callDeadline(clock, SLICE_FETCH_MS), callEnd);
      if (!ensured) {
        try { await session.ensure({ deadline }); ensured = true; } catch (e) { if (!current) throw e; break; }
      }
      if (current === null && failed.length === 0) trace(kino, "home", "refresh", { why: "cold" });
      const r = await rootSlice(next, deadline);
      if (r.error !== null) failed.push(r);
    }
    if (dirty) save();
    // A start that brought a catalog not complete yet closer: how far, and what it cost.
    const storedAfter = current ? Object.keys(current.roots).length : 0;
    if (storedAfter > storedBefore && storedBefore < KINDS.length) {
      report(kino, PERF_AREAS.cold, storedAfter === KINDS.length ? "done" : "progress",
        { stored: storedAfter, of: KINDS.length, b: msBucket(clock.now() - startedAt) });
    }
    if (current) return current.rows;
    if (failed.length > 0) { summarizeFailure(failed, 1); throw worstOf(failed); }
    return [];
  }

  // A row not (yet) found while some root has never been fetched: "try again", never "no such list".
  function rowMissing() {
    const cur = getCurrent();
    if (!cur || KINDS.some(({ root }) => !(root in cur.roots))) {
      throw kino.error("unavailable", "Xuper todavía está cargando su catálogo, intenta de nuevo en un momento");
    }
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
    const row = typeof ref === "string" ? (await buildRows("full", CALL_BUDGET_MS.browse, rootOfRow(ref))).find((r) => r.id === ref) : undefined;
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
      const row = typeof within === "string" ? (await buildRows("full", CALL_BUDGET_MS.search, rootOfRow(within))).find((r) => r.id === within) : undefined;
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
  const rows = (need = "full", root = null) => buildRows(need, CALL_BUDGET_MS[need] ?? CALL_BUDGET_MS.home, root);

  return { home, browse, rows, search, episodes, portalChapters };
}
