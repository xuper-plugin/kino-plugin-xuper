// Search over the Magis portal (native-magis.md §4.4; MagisSearch.kt + MagisPluginBridge.search).
// Composed into the catalog by makeCatalog. The rank/filter rule is the SDK's `kino.rank` (proved
// equivalent to the native one by test/search.test.mjs); the portal call, merge, fallback, season
// filter, season order, item output and the compact result cache live here.
import { PortalError, mapPortalError, viewOpts, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { encode, isSeries } from "./refs.js";
import { makeByteCache } from "./byteCache.js";
import { isObject, isKinoError } from "./util.js";

const ITEM_ID = /^[A-Za-z0-9._~-]{1,128}$/;
const MAX_OUTPUT_ITEMS = 100; // SDK cap
const MAX_ALT_TITLES = 5;
const MAX_SPANISH_FORMS = 3;
const MAX_FULL_TITLE_RETRIES = 4;
const PAGE_SIZE = 20;

// One kino.storage key for every cached query: the whole storage is 256 KB and shared with the home
// trees (up to 80 KB), so this key never goes over 24,000 bytes (oldest entries are evicted).
const CACHE_KEY = "search:v1";
const CACHE_BUDGET_BYTES = 24_000;
const CACHE_FRESH_MS = 6 * 3600_000;

// ---- season helpers (MagisSearch.kt) ---------------------------------------------------------
// Boundaries are Unicode-aware like the native regex engine's: a letter, digit or underscore on
// either side is not a boundary.
const B = "(?<![\\p{L}\\p{N}_])";
const E = "(?![\\p{L}\\p{N}_])";
const SEASON_SOURCE = `(?:${B}T\\s?([0-9]{1,2})${E}|${B}Temp\\.?\\s?([0-9]{1,2})${E}|${B}Temporada\\s?([0-9]{1,2})${E}|${B}S([0-9]{1,2})${E})`;

/** Season number read from the name; 1 when it carries no suffix (a single-season series). */
export function seasonFromName(name) {
  const m = new RegExp(SEASON_SOURCE, "iu").exec(typeof name === "string" ? name : "");
  if (!m) return 1;
  const digits = m.slice(1).find((g) => g !== undefined && g.trim() !== "");
  return digits === undefined ? 1 : Number(digits);
}

const withoutSeason = (name) => (typeof name === "string" ? name : "").replace(new RegExp(SEASON_SOURCE, "giu"), "").trim().toLowerCase();

/**
 * The same series' seasons in 1, 2, 3 order. Only series items move, and only among the slots
 * series already occupy; between different series, whichever appeared first wins.
 */
export function sortSeasons(items) {
  const slots = [];
  items.forEach((it, i) => { if (isSeries(it.p)) slots.push(i); });
  if (slots.length < 2) return items;
  const order = new Map();
  for (const i of slots) {
    const key = withoutSeason(items[i].t);
    if (!order.has(key)) order.set(key, order.size);
  }
  const sorted = slots.map((i) => items[i]).sort((a, b) =>
    order.get(withoutSeason(a.t)) - order.get(withoutSeason(b.t)) || seasonFromName(a.t) - seasonFromName(b.t));
  const out = items.slice();
  slots.forEach((i, pos) => { out[i] = sorted[pos]; });
  return out;
}

// ---- portal answers -> compact items ---------------------------------------------------------
// The internal (and stored) form of a portal item, keeping only what ranking and output read:
//   c contentId, t title (name | viewPoint | alias), a alias when it differs, p programType when
//   not "movie", y release year, n episode count, m poster (icon), b backdrop (poster).
const str = (v) => (typeof v === "string" ? v : "");
const INT = /^[+-]?\d+$/;

function wholeNumberOrNull(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && INT.test(v)) {
    const n = Number(v);
    return n >= -2147483648 && n <= 2147483647 ? n : null;
  }
  return null;
}

function slim(raw) {
  if (!isObject(raw)) return null;
  const c = str(raw.contentId);
  if (c.trim() === "") return null;
  const alias = str(raw.alias);
  const t = [raw.name, raw.viewPoint, raw.alias].map(str).find((s) => s.trim() !== "") ?? "";
  const out = { c, t };
  if (alias !== t && alias.trim() !== "") out.a = alias;
  const programType = str(raw.programType).trim() === "" ? "movie" : str(raw.programType);
  if (programType !== "movie") out.p = programType;
  const year = str(raw.releaseTime).slice(0, 4);
  if (/^[0-9]{4}$/.test(year)) out.y = year;
  const n = wholeNumberOrNull(raw.volumnCount) ?? wholeNumberOrNull(raw.updateCount) ?? 0;
  if (n !== 0) out.n = n;
  if (Array.isArray(raw.posterList)) {
    for (const p of raw.posterList) {
      if (!isObject(p)) continue;
      const key = p.fileType === "icon" ? "m" : p.fileType === "poster" ? "b" : null;
      const url = str(p.fileUrl);
      if (key !== null && url.trim() !== "" && out[key] === undefined) out[key] = url;
    }
  }
  return out;
}

const eachObject = (list, f) => { if (Array.isArray(list)) for (const x of list) if (isObject(x)) f(x); };

// The portal answers in three shapes depending on the endpoint.
function flatten(response) {
  const out = [];
  if (isObject(response)) {
    eachObject(response.searchItemList, (group) => eachObject(group.itemList, (x) => out.push(x)));
    if (out.length === 0) eachObject(Array.isArray(response.assetList) ? response.assetList : response.list, (x) => out.push(x));
  }
  return out;
}

// ---- the stored cache ------------------------------------------------------------------------
// One entry per lowercased portal query: { k, s: fetched-at ms, i: [compact items] } (byteCache.js).
const validEntryItems = (items) => Array.isArray(items)
  && items.every((it) => isObject(it) && typeof it.c === "string" && typeof it.t === "string");

const intOr0 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
const distinctBy = (list, keyOf) => {
  const seen = new Set();
  return list.filter((x) => { const k = keyOf(x); if (seen.has(k)) return false; seen.add(k); return true; });
};

export function makeSearch({ kino, portal, session, clock, tmdb = null }) {
  // Any failure reaches the caller as a kino error: portal codes mapped, the rest `unavailable`.
  const surface = (e) => {
    if (e instanceof PortalError) return mapPortalError(e.code, e.message, kino);
    if (isKinoError(e)) return e;
    return kino.error("unavailable", "Xuper no está disponible ahora");
  };
  const log = (msg) => { try { kino.log(msg); } catch (_) {} };

  const cache = makeByteCache({ kino, key: CACHE_KEY, budgetBytes: CACHE_BUDGET_BYTES, clock, ttlMs: CACHE_FRESH_MS, valid: validEntryItems });

  /** The SDK query as the native input: type series->tv, blank->movie, anything else as is. */
  function contextOf(query) {
    const q = isObject(query) ? query : {};
    const rawType = typeof q.type === "string" ? q.type.trim() : "";
    return {
      q: typeof q.q === "string" ? q.q.trim() : "",
      type: rawType === "" ? "movie" : rawType === "series" ? "tv" : rawType,
      season: intOr0(q.season),
      episode: intOr0(q.episode),
      tmdbId: intOr0(q.tmdbId),
      originalTitle: typeof q.originalTitle === "string" ? q.originalTitle : "",
      altTitles: Array.isArray(q.altTitles) ? q.altTitles.filter((s) => typeof s === "string").slice(0, MAX_ALT_TITLES) : [],
    };
  }

  // The native TMDB-derived forms (query, localized, original, English, up to 3 other Spanish)
  // plus what Kino itself knows (originalTitle, altTitles), deduped case-insensitively.
  async function titleForms(ctx) {
    const forms = [ctx.q];
    if (ctx.tmdbId > 0 && tmdb) {
      let detail = null;
      try { detail = await tmdb.titleForms(ctx.type === "movie" ? "movie" : "tv", ctx.tmdbId); } catch (_) { detail = null; }
      if (detail) {
        for (const t of [detail.title, detail.originalTitle, detail.englishTitle]) if (typeof t === "string" && t.trim() !== "") forms.push(t);
        for (const t of (Array.isArray(detail.spanishTitles) ? detail.spanishTitles : []).slice(0, MAX_SPANISH_FORMS)) forms.push(t);
      }
    }
    for (const t of [ctx.originalTitle, ...ctx.altTitles]) if (t.trim() !== "") forms.push(t);
    return distinctBy(forms, (f) => f.trim().toLowerCase());
  }

  async function search(query) {
    // Taken first: the app's 15 s run from the call's start (per-call seed retries stop by it).
    const deadline = callDeadline(clock, CALL_BUDGET_MS.search);
    const ctx = contextOf(query);
    if (ctx.q === "") return [];
    const forms = await titleForms(ctx);
    const queries = distinctBy(forms.map((f) => kino.rank.shortQuery(f)), (f) => f.toLowerCase());

    const entries = cache.read();
    const nowMs = clock.now();
    const touched = [];
    const added = [];
    const seen = new Set();
    const pool = [];
    let lastError = null;
    let ensuring = null;

    async function portalItems(q) {
      ensuring ??= session.ensure(); // once; a failure fails every portal query the same way
      await ensuring;
      const response = await session.withValidSession((v) => portal.call(
        "v3/searchByName",
        { value: q, type: "0", columnId: "", filter: "", pageNum: 1, pageSize: PAGE_SIZE },
        viewOpts(v),
      ), { seedFallback: true, deadline });
      return flatten(response).map(slim).filter((x) => x !== null);
    }

    async function fetchInto(qs) {
      for (const q of qs) {
        const key = q.toLowerCase();
        let part = null;
        const hit = cache.get(key, entries, nowMs);
        if (hit !== undefined) {
          part = hit;
          touched.push(key);
        } else {
          try {
            part = await portalItems(q);
            if (part.length > 0) added.push({ k: key, i: part });
          } catch (e) {
            lastError = e;
            part = null;
          }
        }
        if (part) for (const item of part) if (!seen.has(item.c)) { seen.add(item.c); pool.push(item); }
      }
    }

    const titlesOf = (item) => [item.t, item.a ?? ""];
    const ranked = () => kino.rank.filterRelevant(kino.rank.sortBySimilarity(pool, forms, titlesOf), forms, titlesOf);

    let items;
    try {
      await fetchInto(queries);
      // Only an error if EVERY query failed; a title present under one form is still a good result.
      if (pool.length === 0 && lastError !== null) throw surface(lastError);
      items = ranked();

      // Second chance with the FULL titles, only when nothing relevant came back.
      if (items.length === 0) {
        const asked = new Set(queries.map((s) => s.trim().toLowerCase()));
        const full = distinctBy(
          forms.map((f) => f.trim()).filter((f) => f !== "" && !asked.has(f.toLowerCase())),
          (f) => f.toLowerCase(),
        ).slice(0, MAX_FULL_TITLE_RETRIES);
        if (full.length > 0) {
          await fetchInto(full);
          items = ranked();
        }
      }
    } finally {
      if (added.length > 0 || touched.length > 0) cache.write(added, touched);
    }

    if ((ctx.type === "tv" || ctx.type === "anime") && ctx.season > 0) {
      // The requested season only; if NONE matches, all of them.
      const matching = items.filter((it) => !isSeries(it.p ?? "movie") || seasonFromName(it.t) === ctx.season);
      if (matching.length > 0) items = matching;
    }
    if (items.length === 0 && ctx.tmdbId > 0) log(`xuper search: 0 results tmdb=${ctx.tmdbId} type=${ctx.type} pool=${pool.length}`);

    const out = [];
    for (const it of sortSeasons(items)) {
      if (!ITEM_ID.test(it.c)) continue;
      const programType = it.p ?? "movie";
      const series = isSeries(programType);
      const item = {
        id: it.c,
        ref: encode({ contentId: it.c, programType, episode: ctx.episode }),
        title: it.t.trim() === "" ? it.c : it.t,
        kind: series ? "series" : "movie",
        year: it.y ?? "",
        season: series ? seasonFromName(it.t) : ctx.season,
        episodeCount: it.n ?? 0,
      };
      if (it.m) item.poster = it.m;
      if (it.b) item.backdrop = it.b;
      out.push(item);
      if (out.length >= MAX_OUTPUT_ITEMS) break;
    }
    return out;
  }

  return { search };
}
