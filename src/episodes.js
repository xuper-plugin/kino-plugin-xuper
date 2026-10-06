// Episodes of a series (native-magis.md §4.3; MagisPluginBridge.episodes/portalChapters/enrich and
// gateway/SeasonList.kt): the portal's chapter list, the season it belongs to, the optional TMDB
// enrichment and the sibling-season chips. Composed into the catalog by makeCatalog.
// `makePortalChapters` is shared with resolve (a chapter is looked up by its seriesNumber), which is
// why the chapter list is cached here, once, for both.
import {
  PortalError, mapPortalError, viewOpts, callDeadline, CALL_BUDGET_MS, isEpisodeGone, SERIES_GONE, slowPortal,
} from "./portal.js";
import { trace, errCode } from "./trace.js";
import { FIXED_MAC } from "./config.js";
import { decode, encode, encodeChapter } from "./refs.js";
import { makeByteCache } from "./byteCache.js";
import { isObject, isKinoError, optStringStrict } from "./util.js";
import { say } from "./i18n.js";

// One kino.storage key for every cached series (the whole storage is 256 KB and shared with the home
// trees and the search results): never over 32,000 bytes, oldest series evicted first. A full
// 154-episode list is ~15 KB, so only a couple fit; a list that alone does not fit is not cached.
const CACHE_KEY = "chapters:v1";
const CACHE_BUDGET_BYTES = 32_000;
const CACHE_FRESH_MS = 6 * 3600_000;
// Past its 6 h a list stays stored for a week, served when the portal cannot answer a fresh one in time.
const CACHE_KEEP_MS = 7 * 24 * 3600_000;
// Deadlines (2.2.14; see catalog.js WARM_REFRESH_MS): the chapter list asked with a kept one to fall back
// on gets CHAPTERS_REFRESH_MS, with none CHAPTERS_COLD_MS; the whole export (TMDB's enrichment included)
// ends by EPISODES_DEADLINE_MS, 5 s before Kino's 20 s.
export const CHAPTERS_REFRESH_MS = 8_000;
export const CHAPTERS_COLD_MS = 12_000;
export const EPISODES_DEADLINE_MS = 15_000;

const IMDB = /^tt\d{7,}$/;
const MAX_EPISODES = 5000; // SDK caps
const MAX_SEASONS = 50;

const INT = /^[+-]?\d+$/;
// A chapter name that only numbers the chapter, which TMDB's own name replaces when one matched (accents
// and case ignored): blank, digits, "Capítulo 3", "Episodio 3", "Cap. 3", "Ep 3", "Chapter 3", "E03"; and the
// portal's usual "<series>_<that>" ("Nada Miniserie_1", "One Piece T1_8") or "<series>_<series>-01".
const GENERIC_TITLE = /^(?:(?:capitulo|episodio|chapter|episode|cap|ep|e)\.?\s*#?\s*)?\d*$/;
const TRAILING_NUMBER = /[\s._-]*\d+$/;
const plainTitle = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/\s+/g, " ").trim();
export function isGenericTitle(s) {
  if (typeof s !== "string") return true;
  const t = plainTitle(s);
  if (GENERIC_TITLE.test(t)) return true;
  const cut = t.lastIndexOf("_");
  if (cut < 0) return false;
  const series = t.slice(0, cut).trim();
  const rest = t.slice(cut + 1).trim();
  return GENERIC_TITLE.test(rest) || (TRAILING_NUMBER.test(rest) && rest.replace(TRAILING_NUMBER, "").trim() === series);
}

// Kotlin's String.toIntOrNull over `value.toString()`: strings as they are, numbers by their text.
function toIntOrNull(v) {
  const text = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  if (text === null || !INT.test(text)) return null;
  const n = Number(text);
  return n >= -2147483648 && n <= 2147483647 ? n || 0 : null;
}


/**
 * What a series detail's `sameSeasonSeriesList` says about the season `ownId` (native parseSeasonList):
 * `own` is this season's number (null when the list carries seasons but not this one) and `all` every
 * season with a usable id and number, ordered by number. A missing or EMPTY list means a single-season
 * series: `own` is then 1, not unknown. A non-empty list without this season stays unknown.
 */
export function parseSeasonList(list, ownId) {
  let own = null;
  const all = [];
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const id = optStringStrict(entry.contentId);
    const number = toIntOrNull(entry.seasonNumber);
    if (id === ownId) own = number;
    if (id.trim() !== "" && number !== null) all.push({ id, number });
  }
  if (own === null && entries.length === 0) own = 1;
  all.sort((a, b) => a.number - b.number); // stable, as sortedBy
  return { own, all };
}

/** The chapter whose seriesNumber is `episode` (trimmed, as native); episode <= 0 is the first. */
export function findChapter(items, episode) {
  if (episode <= 0) return items[0];
  return items.find((it) => typeof it.seriesNumber === "string" && it.seriesNumber.trim() === String(episode));
}

// ---- the stored form -------------------------------------------------------------------------
// One entry per series, compact: { i: imdb, s: season | null, d: declared | null,
//   a: [[season id, number]], e: [[seriesNumber | null, contentId, name, duration?]] }.
const validPayload = (p) => isObject(p) && typeof p.i === "string" && Array.isArray(p.a) && Array.isArray(p.e)
  && p.e.every((x) => Array.isArray(x) && typeof x[1] === "string" && typeof x[2] === "string")
  && p.a.every((x) => Array.isArray(x) && typeof x[0] === "string" && Number.isInteger(x[1]))
  && (p.s === null || Number.isInteger(p.s)) && (p.d === null || Number.isInteger(p.d));

function pack(raw) {
  return {
    i: raw.imdb, s: raw.season, d: raw.declared,
    a: raw.seasons.map((x) => [x.id, x.number]),
    e: raw.items.map((it) => (it.duration === undefined ? [it.seriesNumber, it.contentId, it.name] : [it.seriesNumber, it.contentId, it.name, it.duration])),
  };
}

const unpack = (p) => ({
  items: p.e.map((x) => ({ seriesNumber: x[0], contentId: x[1], name: x[2], duration: x[3] })),
  imdb: p.i, season: p.s, declared: p.d, seasons: p.a.map((x) => ({ id: x[0], number: x[1] })),
});

/**
 * `portalChapters(seriesId)` = `{ items: [{ seriesNumber (raw text or null), contentId, name, duration? }],
 * imdb, season (null = unknown), declared (null = not given), seasons: [{ id, number }] }`. Cached
 * 6 h, never when empty. Failures arrive as kino errors (portal codes mapped, the rest `unavailable`).
 */
// `ids` (idsStore.js, optional): a fresh detail's IMDb id is remembered for the cards.
export function makePortalChapters({ kino, portal, session, clock, onServed = () => {}, ids = null }) {
  const cache = makeByteCache({
    kino, key: CACHE_KEY, budgetBytes: CACHE_BUDGET_BYTES, clock, ttlMs: CACHE_FRESH_MS, keepMs: CACHE_KEEP_MS, valid: validPayload,
  });

  async function fetchDetail(seriesId, deadline) {
    let response;
    try {
      await session.ensure({ deadline });
      response = await session.withValidSession((v) => portal.call(
        "v4/getItemData",
        { contentId: seriesId, type: "0", sortType: "0", language: "en", macAddr: FIXED_MAC },
        viewOpts(v),
      ), { seedFallback: true, deadline });
    } catch (e) {
      if (e instanceof PortalError) throw mapPortalError(e.code, e.message, kino);
      if (isKinoError(e)) throw e;
      throw kino.error("unavailable", "Xuper no está disponible ahora");
    }
    const data = isObject(response) ? response.assetData : undefined;
    if (!isObject(data)) throw kino.error("unavailable", "Xuper devolvió una capítulos sin datos");
    return data;
  }

  // `deadline`: the calling export's (resolve passes its own); by default the episodes budget from now.
  // A list older than 6 h is asked again, but a portal that cannot answer in time (any `unavailable`: no
  // answer, a deadline, an unreadable one) serves the kept list; a series gone, a geo-block or an account
  // problem is the portal's verdict and is thrown as ever.
  return async function portalChapters(seriesId, deadline = callDeadline(clock, CALL_BUDGET_MS.episodes)) {
    const entries = cache.read();
    const cached = cache.get(seriesId, entries);
    if (cached !== undefined) { onServed("cache"); return unpack(cached); }
    const kept = cache.getStale(seriesId, entries);
    const portalEnd = Math.min(deadline, clock.now() + (kept !== undefined ? CHAPTERS_REFRESH_MS : CHAPTERS_COLD_MS));
    let data;
    try {
      data = await fetchDetail(seriesId, portalEnd);
    } catch (e) {
      if (kept !== undefined && isKinoError(e) && e.name === "KinoError_unavailable") {
        trace(kino, "episodes", "kept", { code: errCode(e) });
        onServed("cache");
        return unpack(kept);
      }
      throw slowPortal(kino, e);
    }
    const items = (Array.isArray(data.simpleProgramList) ? data.simpleProgramList : []).filter(isObject).map((it) => {
      const seriesNumber = typeof it.seriesNumber === "string" ? it.seriesNumber : typeof it.seriesNumber === "number" ? String(it.seriesNumber) : null;
      const item = { seriesNumber, contentId: optStringStrict(it.contentId), name: optStringStrict(it.name), duration: undefined };
      if (typeof it.duration === "string" || (typeof it.duration === "number" && Number.isFinite(it.duration))) item.duration = it.duration;
      return item;
    });
    const seasonList = parseSeasonList(data.sameSeasonSeriesList, seriesId);
    const raw = { items, imdb: optStringStrict(data.keyWords), season: seasonList.own, declared: toIntOrNull(data.volumnCount), seasons: seasonList.all };
    // Only cached with chapters: an empty list over a transient failure would stick for hours.
    if (items.length > 0) cache.write([{ k: seriesId, i: pack(raw) }]);
    if (ids) ids.remember(seriesId, raw.imdb);
    onServed("fresh");
    return raw;
  };
}

/** `episodes(ref)` over the chapter list, TMDB and the sibling seasons. */
// `ids` (idsStore.js, optional): the series' IMDb id, and TMDB's once matched, are remembered for the cards.
export function makeEpisodes({ kino, tmdb = null, portalChapters, clock = null, ids = null }) {
  // MagisSource.enrich: each chapter's still, name and synopsis from TMDB, matched exactly through the
  // series' IMDb id. Best-effort: any failure returns "nothing" (and no series).
  // `bounds` ({ deadline }): the export's; TMDB requests never run past it.
  async function enrich(raw, bounds) {
    const none = { extra: new Map(), series: null };
    if (!tmdb || !IMDB.test(raw.imdb) || raw.season === null) return none;
    try {
      const series = await tmdb.seriesByImdb(raw.imdb, bounds);
      if (!series) return none;
      const fromTmdb = await tmdb.seasonEpisodes(series.tmdbId, raw.season, undefined, bounds);
      if (!fromTmdb) return { extra: new Map(), series };
      // Numbering guard: the season's DECLARED total (not the published count) must equal TMDB's, or
      // the portal split the series differently and crossing by number would attach stills that don't belong.
      const expected = raw.declared !== null && raw.declared > 0 ? raw.declared : raw.items.length;
      if (expected !== fromTmdb.length) return { extra: new Map(), series };

      const rows = new Map();
      for (const c of fromTmdb) {
        const row = {
          still: c.still.trim() !== "" ? c.still : null,
          // TMDB's blank name reads "Episodio N" (parseSeasonEpisodes): no better than the portal's.
          title: !isGenericTitle(c.name) ? c.name : null,
          overview: c.overview.trim() !== "" ? c.overview : null,
          airDate: c.airDate || null,
          runtimeMinutes: c.runtimeMinutes > 0 ? c.runtimeMinutes : null,
        };
        if (Object.values(row).some((v) => v !== null)) rows.set(c.episode, row); else rows.delete(c.episode);
      }
      // English fallback ONLY for empty synopses, with its own catch.
      const missing = new Set([...rows].filter(([, r]) => r.overview === null).map(([n]) => n));
      if (missing.size === 0) return { extra: rows, series };
      let inEnglish = [];
      try { inEnglish = (await tmdb.seasonEpisodes(series.tmdbId, raw.season, "en-US", bounds)) ?? []; } catch (_) { inEnglish = []; }
      for (const c of inEnglish) {
        if (missing.has(c.episode) && c.overview.trim() !== "") rows.set(c.episode, { ...rows.get(c.episode), overview: c.overview });
      }
      return { extra: rows, series };
    } catch (_) {
      return none;
    }
  }

  return async function episodes(ref) {
    const magis = decode(ref);
    if (!magis) throw kino.error("unavailable", "ese ref no es de Xuper: no se pueden listar capítulos");
    // One deadline for the whole export (EPISODES_DEADLINE_MS of the app's 20 s): the chapter list, then TMDB's enrichment.
    const deadline = clock ? Math.min(clock.now() + EPISODES_DEADLINE_MS, callDeadline(clock, CALL_BUDGET_MS.episodes)) : undefined;
    let raw;
    try {
      raw = await portalChapters(magis.contentId, deadline);
    } catch (e) {
      // The chapter list of a gone series is the series being gone, not one chapter (native goneMessage).
      if (isKinoError(e) && isEpisodeGone(e.userMessage)) throw mapPortalError("portal100006", "", kino, { goneMessage: SERIES_GONE });
      throw e;
    }
    const { extra, series } = await enrich(raw, { deadline });
    if (ids && IMDB.test(raw.imdb)) ids.remember(magis.contentId, raw.imdb, series?.tmdbId ?? 0);

    const list = raw.items.slice(0, MAX_EPISODES).map((it) => {
      const number = toIntOrNull(it.seriesNumber) ?? 0;
      const ep = {
        number,
        title: it.name.trim() !== "" ? it.name : say(kino, "chapterN", { n: number }),
        // The series plus the number: whoever plays it looks the chapter back up in the list.
        ref: encodeChapter(number, magis.contentId),
      };
      const t = extra.get(number);
      // TMDB's name only where the portal's just numbers the chapter ("Capítulo 3", "3", blank).
      if (t?.title && isGenericTitle(it.name)) ep.title = t.title;
      if (t?.still) ep.still = t.still;
      if (t?.overview) ep.overview = t.overview;
      if (t?.airDate) ep.airDate = t.airDate;
      if (t?.runtimeMinutes) ep.runtimeMinutes = t.runtimeMinutes;
      // The contract reads each episode's own season (absent = 1); left out when the portal doesn't say.
      if (raw.season !== null) ep.season = raw.season;
      return ep;
    });

    const out = { episodes: list };
    // The series block travels WHENEVER the portal gave an imdb, even if enrichment didn't come out;
    // `ids.tmdb` only when TMDB named the series (the contract wants a positive id).
    if (IMDB.test(raw.imdb)) {
      const tmdbId = series?.tmdbId ?? 0;
      out.series = {
        ids: tmdbId > 0 ? { imdb: raw.imdb, tmdb: tmdbId } : { imdb: raw.imdb },
        title: series?.title ?? "",
        poster: series?.poster ?? "",
        backdrop: series?.backdrop ?? "",
      };
    }
    if (raw.seasons.length > 0) {
      out.seasons = raw.seasons.slice(0, MAX_SEASONS).map((s) => ({
        id: s.id,
        // A season IS a portal title of the same kind: its ref is what a search would give it.
        ref: encode({ contentId: s.id, programType: magis.programType, episode: 0 }),
        title: say(kino, "seasonN", { n: s.number }),
        number: s.number,
        current: s.id === magis.contentId,
      }));
    }
    return out;
  };
}
