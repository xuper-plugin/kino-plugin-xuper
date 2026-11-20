// The TMDB enrichment of a masnew series' episodes (ported from Xuper 2.x episodes.js: enrich / acrossTmdbSeasons). The
// portal detail (the backend's /item, already fetched) gives the chapter list, the season number and the IMDb id in
// `keyWords`; TMDB (through `kino.tmdb`, src/tmdb.js) is matched by that id (or, with no id, by the cleaned title) to add
// each chapter's still, real name, synopsis, air date and runtime. Best-effort: any failure leaves the episodes as the
// portal gave them. The season chips (sibling seasons) come straight from the portal and never need TMDB.
import { parseSeasonList } from "./legacy.js";
import { pickSeasonRun } from "./seasonRuns.js";
import { cleanSeriesTitle } from "./titleClean.js";

const IMDB = /^tt\d{7,}$/;
const INT = /^[+-]?\d+$/;
// A chapter name that only numbers the chapter, which TMDB's own name replaces when one matched: blank, digits, "Capítulo 3",
// "Episodio 3", "Ep 3", "E03"; and the portal's "<series>_<that>" ("One Piece T1_8") or "<series>_<series>-01".
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

const str = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
function toIntOrNull(v) {
  const t = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  if (t === null || !INT.test(t.trim())) return null;
  const n = Number(t.trim());
  return n >= -2147483648 && n <= 2147483647 ? n || 0 : null;
}

/**
 * The portal detail reduced to what the enrichment reads: `{ items: [{ seriesNumber, contentId, name }], imdb (keyWords),
 * season (own season number, null = unknown), declared (volumnCount), seasons: [{ id, number }], title }`. Mirrors 2.x's
 * portalChapters, without the portal call (the detail is already in hand) or TMDB.
 */
export function rawDetail(detail, seriesId) {
  const d = detail && typeof detail === "object" ? detail : {};
  const programs = Array.isArray(d.simpleProgramList) ? d.simpleProgramList : Array.isArray(d.programList) ? d.programList : [];
  const items = programs.filter((x) => x && typeof x === "object").map((it) => ({
    seriesNumber: typeof it.seriesNumber === "string" ? it.seriesNumber : typeof it.seriesNumber === "number" ? String(it.seriesNumber) : null,
    contentId: str(it.contentId || it.programContentId),
    name: str(it.name || it.title),
  }));
  const s = parseSeasonList(d.sameSeasonSeriesList, seriesId);
  const title = [d.name, d.viewPoint, d.alias].find((v) => typeof v === "string" && v.trim() !== "") ?? "";
  return { items, imdb: str(d.keyWords), season: s.own, declared: toIntOrNull(d.volumnCount), seasons: s.all, title };
}

/** The chapters of the consecutive TMDB seasons that add up to `expected`, numbered 1..expected in order, or null. */
async function acrossTmdbSeasons(tmdb, tvId, portalSeason, expected, deadline) {
  if (typeof tmdb.seriesSeasons !== "function") return null;
  try {
    const all = await tmdb.seriesSeasons(tvId, deadline);
    const run = pickSeasonRun(all, expected, portalSeason);
    if (run === null) return null;
    const out = [];
    for (const s of run) {
      const eps = await tmdb.seasonEpisodes(tvId, s.season, undefined, deadline);
      if (!eps || eps.length !== s.count) return null;
      for (const e of eps) out.push({ ...e, episode: out.length + 1 });
    }
    return out.length === expected ? out : null;
  } catch (_) {
    return null;
  }
}

/**
 * TMDB enrichment of `raw` (from [rawDetail]) through `tmdb` (src/tmdb.js), by `deadline` (epoch ms, optional). →
 * `{ extra: Map(episodeNumber → { still, title, overview, airDate, runtimeMinutes }), series: { tmdbId, title, poster,
 * backdrop } | null }`. Best-effort: `{ extra: empty, series: null }` whenever TMDB cannot be matched.
 */
export async function enrich(raw, tmdb, deadline) {
  const none = { extra: new Map(), series: null };
  if (!tmdb || !raw || raw.season === null || raw.season === undefined) return none;
  const viaImdb = IMDB.test(raw.imdb || "");
  // No IMDb id: TMDB may still name the series from its cleaned title ("Dragón Ball Kai español T2" -> "Dragón Ball Kai").
  let byTitle = null;
  if (!viaImdb && typeof tmdb.seriesByTitle === "function") {
    const clean = cleanSeriesTitle(raw.title);
    if (clean !== "") { try { byTitle = await tmdb.seriesByTitle(clean, deadline); } catch (_) { byTitle = null; } }
  }
  if (!viaImdb && !byTitle) return none;
  try {
    const series = viaImdb ? await tmdb.seriesByImdb(raw.imdb, deadline) : byTitle;
    if (!series) return none;
    let fromTmdb = await tmdb.seasonEpisodes(series.tmdbId, raw.season, undefined, deadline);
    if (!fromTmdb) return { extra: new Map(), series };
    let acrossSeasons = false;
    // Numbering guard: the season's DECLARED total (not the published count) must equal TMDB's, or the portal split the
    // series differently and crossing by number would attach stills that don't belong.
    const expected = raw.declared !== null && raw.declared > 0 ? raw.declared : raw.items.length;
    if (expected !== fromTmdb.length) {
      const merged = fromTmdb.length < expected ? await acrossTmdbSeasons(tmdb, series.tmdbId, raw.season, expected, deadline) : null;
      if (merged === null) return { extra: new Map(), series };
      fromTmdb = merged;
      acrossSeasons = true;
    }
    const rows = new Map();
    for (const c of fromTmdb) {
      const row = {
        still: c.still.trim() !== "" ? c.still : null,
        title: !isGenericTitle(c.name) ? c.name : null,
        overview: c.overview.trim() !== "" ? c.overview : null,
        airDate: c.airDate || null,
        runtimeMinutes: c.runtimeMinutes > 0 ? c.runtimeMinutes : null,
      };
      if (Object.values(row).some((v) => v !== null)) rows.set(c.episode, row);
    }
    // English fallback ONLY for empty synopses. Not for chapters crossed across several TMDB seasons: it asks one season.
    const missing = new Set([...rows].filter(([, r]) => r.overview === null).map(([n]) => n));
    if (missing.size === 0 || acrossSeasons) return { extra: rows, series };
    let inEnglish = [];
    try { inEnglish = (await tmdb.seasonEpisodes(series.tmdbId, raw.season, "en-US", deadline)) ?? []; } catch (_) { inEnglish = []; }
    for (const c of inEnglish) {
      if (missing.has(c.episode) && c.overview.trim() !== "") rows.set(c.episode, { ...rows.get(c.episode), overview: c.overview });
    }
    return { extra: rows, series };
  } catch (_) {
    return none;
  }
}
