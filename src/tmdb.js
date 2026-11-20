// The TMDB reads the episode enrichment needs (ported from Xuper 2.x tmdb.js, the series subset). TMDB is an enrichment,
// never a requirement: Kino's own TMDB door `kino.tmdb(path, params)` (Kino 0.9.53+, Kino's key, parsed JSON, its cache)
// answers each read; when it is absent or throws (no_tmdb_key, not_allowed, a network slip), the read is simply `null` and
// the episode list goes on without stills. No API key and no host of our own: Kino holds the key.
import { parseSeasonCounts } from "./seasonRuns.js";

const TMDB_LANGUAGE = "es-MX";
const MIN_LEFT_MS = 500;   // less time than this before the caller's deadline: TMDB is skipped
const IMG = "https://image.tmdb.org/t/p";
const IMDB_ID = /^tt\d{7,}$/;
const AIR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INT = /^[+-]?\d+$/;
const MIN_RUNTIME = 1;
const MAX_RUNTIME = 1000;

const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const text = (v) => (typeof v === "string" ? v : "");
const blank = (s) => s.trim() === "";

// org.json optInt: a number truncated, a numeric string parsed, anything else 0.
function optInt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && INT.test(v.trim())) return Number(v.trim());
  return 0;
}

// A blank path (or the text "null") is no image; otherwise the CDN url at the given size.
const imageUrl = (path, size) => (typeof path !== "string" || blank(path) || path === "null" ? "" : `${IMG}/${size}${path}`);

const plainWords = (t) => String(t).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The series a TMDB /find answer names: the first tv result with a positive id, or null. */
export function parseSeriesByImdb(body) {
  const o = isObj(body) ? body : null;
  const tv = o && Array.isArray(o.tv_results) && isObj(o.tv_results[0]) ? o.tv_results[0] : null;
  if (tv === null) return null;
  const tmdbId = optInt(tv.id);
  if (tmdbId <= 0) return null;
  return { tmdbId, title: text(tv.name), poster: imageUrl(tv.poster_path, "w500"), backdrop: imageUrl(tv.backdrop_path, "w1280") };
}

/**
 * The series a TMDB /search/tv answer clearly means by `title` (for a portal title with no IMDb id), or null (a wrong id
 * would paint another series' information). Exactly one result whose name or original name IS the title (accents, case and
 * punctuation ignored); else, among the results holding every word of the title, exactly one, or the clearly most popular.
 */
export function pickSeriesByTitle(body, title) {
  const o = isObj(body) ? body : null;
  const want = plainWords(title);
  if (!o || !Array.isArray(o.results) || want === "") return null;
  const hits = o.results.filter((r) => isObj(r) && optInt(r.id) > 0).slice(0, 10);
  const forms = (r) => [plainWords(text(r.name)), plainWords(text(r.original_name))];
  const exact = hits.filter((r) => forms(r).includes(want));
  let r = null;
  if (exact.length === 1) r = exact[0];
  else if (exact.length === 0) {
    const words = want.split(" ");
    const holding = hits.filter((h) => forms(h).some((f) => { const fw = f.split(" "); return words.every((w) => fw.includes(w)); }));
    if (holding.length === 1) r = holding[0];
    else if (holding.length > 1) {
      const ranked = holding.slice().sort((a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0));
      if ((Number(ranked[0].popularity) || 0) >= 2 * (Number(ranked[1].popularity) || 0) && (Number(ranked[0].popularity) || 0) > 0) r = ranked[0];
    }
  }
  return r === null ? null : { tmdbId: optInt(r.id), title: text(r.name), poster: imageUrl(r.poster_path, "w500"), backdrop: imageUrl(r.backdrop_path, "w1280") };
}

/**
 * A season's episodes: `null` = the question could not be answered (not a JSON object), `[]` = the season has none. A blank
 * name reads "Episodio N". `airDate` is TMDB's `air_date` when `YYYY-MM-DD` (else ""), `runtimeMinutes` its `runtime` 1..1000.
 */
export function parseSeasonEpisodes(body) {
  const o = isObj(body) ? body : null;
  if (!o) return null;
  const list = Array.isArray(o.episodes) ? o.episodes : [];
  return list.filter(isObj).map((e) => {
    const episode = optInt(e.episode_number);
    const name = text(e.name);
    const airDate = text(e.air_date).trim();
    const runtime = optInt(e.runtime);
    return {
      episode,
      name: blank(name) ? `Episodio ${episode}` : name,
      overview: text(e.overview),
      still: imageUrl(e.still_path, "w300"),
      airDate: AIR_DATE.test(airDate) ? airDate : "",
      runtimeMinutes: runtime >= MIN_RUNTIME && runtime <= MAX_RUNTIME ? runtime : 0,
    };
  });
}

/** Whether `s` is a TMDB generic episode name ("Episodio 3", "Episode 3", "Capítulo 3"): no better than the portal's number. */
export function isGenericEpisodeName(s) {
  return typeof s === "string" && /^\s*(episodio|episode|cap[ií]tulo|chapter)\s+\d+\s*$/i.test(s);
}

/**
 * A TMDB client over Kino's door. `now` (injected for tests) is the clock a deadline is measured against.
 * Every method is best-effort and answers `null` (never throws) when TMDB cannot be reached in time.
 */
export function makeTmdb({ now = () => Date.now() } = {}) {
  async function read(path, params, deadline) {
    try {
      if (typeof deadline === "number" && deadline - now() < MIN_LEFT_MS) return null;
      if (typeof kino.tmdb !== "function") return null;
      const body = await kino.tmdb(path, { ...params });
      return isObj(body) ? body : null;
    } catch (_) {
      return null;   // no_tmdb_key / not_allowed / a slip: simply no TMDB
    }
  }

  /** `{ tmdbId, title, poster, backdrop }` of the series with that IMDb id, or null. */
  async function seriesByImdb(imdbId, deadline) {
    if (typeof imdbId !== "string" || !IMDB_ID.test(imdbId)) return null;
    const body = await read(`/find/${imdbId}`, { external_source: "imdb_id", language: TMDB_LANGUAGE }, deadline);
    return body === null ? null : parseSeriesByImdb(body);
  }

  /** `{ tmdbId, title, poster, backdrop }` of the series a portal title clearly means, or null. */
  async function seriesByTitle(title, deadline) {
    if (typeof title !== "string" || title.trim() === "") return null;
    const body = await read("/search/tv", { query: title.trim(), language: TMDB_LANGUAGE }, deadline);
    return body === null ? null : pickSeriesByTitle(body, title);
  }

  /** `[{ season, count }]` of the series' real seasons, or null when it could not be had. */
  async function seriesSeasons(tvId, deadline) {
    if (!Number.isInteger(tvId) || tvId <= 0) return null;
    const body = await read(`/tv/${tvId}`, { language: TMDB_LANGUAGE }, deadline);
    return body === null ? null : parseSeasonCounts(body);
  }

  /** The season's `[{ episode, name, overview, still, airDate, runtimeMinutes }]`, or null. `language` overrides es-MX. */
  async function seasonEpisodes(tvId, season, language = TMDB_LANGUAGE, deadline) {
    if (!Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season)) return null;
    const body = await read(`/tv/${tvId}/season/${season}`, { language }, deadline);
    return body === null ? null : parseSeasonEpisodes(body);
  }

  return { seriesByImdb, seriesByTitle, seriesSeasons, seasonEpisodes };
}
