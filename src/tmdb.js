// The TMDB read the search needs: the other titles a work is known by (native TmdbApi.detail, only
// the title forms). TMDB is an enrichment, never a requirement: with no key declared, a failing
// request or an unreadable body the answer is simply `null` and the search goes on without it.
// The episodes' enrichment reads (native TmdbApi.seriesByImdb / seasonEpisodes) live here too.
// Kino 0.9.53+ brings its own TMDB door (`kino.tmdb(path, params)`: Kino's key, its cache, parsed JSON);
// older Kino, or a call to it that throws, falls back to kino.fetch with the sealed `tmdbKey`.
import { isObject } from "./util.js";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_LANGUAGE = "es-MX";
const TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 500; // less time left than this before the caller's deadline: TMDB is skipped
const IMG = "https://image.tmdb.org/t/p";
const IMDB_ID = /^tt\d{7,}$/;

const text = (v) => (typeof v === "string" ? v : "");
const blank = (s) => s.trim() === "";
const AIR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_RUNTIME = 1; // contract: runtimeMinutes 1..1000
const MAX_RUNTIME = 1000;

/** A TMDB answer as an object: kino.tmdb's parsed JSON as is, kino.fetch's text parsed; null when it is neither. */
function bodyOf(body) {
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch (_) { return null; }
  }
  return body !== null && typeof body === "object" ? body : null;
}

/**
 * The title forms inside a TMDB detail body (native TmdbApi.detail): the localized title, the
 * original one, the English one (translations, iso_639_1 "en", first) and every distinct Spanish
 * variant other than the localized title. `null` when the body is not a JSON object.
 */
export function parseTitleForms(type, body) {
  const o = bodyOf(body);
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  const isTv = type === "tv";
  const localized = text(isTv ? o.name : o.title);
  const original = text(isTv ? o.original_name : o.original_title);
  const list = o.translations && Array.isArray(o.translations.translations) ? o.translations.translations : [];
  const entries = list.filter((t) => t !== null && typeof t === "object");
  const titleOf = (t) => (t.data !== null && typeof t.data === "object" ? text(isTv ? t.data.name : t.data.title) : "");
  const englishEntry = entries.find((t) => t.iso_639_1 === "en");
  const spanish = [];
  const seen = new Set();
  for (const t of entries) {
    if (t.iso_639_1 !== "es") continue;
    const title = titleOf(t);
    const key = title.trim().toLowerCase();
    if (blank(title) || key === localized.toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    spanish.push(title);
  }
  return {
    title: localized,
    originalTitle: original,
    englishTitle: englishEntry ? titleOf(englishEntry) : "",
    spanishTitles: spanish,
  };
}

const INT = /^[+-]?\d+$/;

// org.json optInt: a number truncated, a numeric string parsed, anything else 0.
function optInt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && INT.test(v.trim())) return Number(v.trim());
  return 0;
}

// A blank path (or the text "null") is no image; otherwise the CDN url at the given size.
const imageUrl = (path, size) => (typeof path !== "string" || blank(path) || path === "null" ? "" : `${IMG}/${size}${path}`);

/**
 * The series a TMDB /find answer names (native TmdbApi.seriesByImdb): the first tv result with a
 * positive id. `null` when the body is not JSON or has no usable tv result.
 */
export function parseSeriesByImdb(body) {
  const o = bodyOf(body);
  const tv = isObject(o) && Array.isArray(o.tv_results) && isObject(o.tv_results[0]) ? o.tv_results[0] : null;
  if (tv === null) return null;
  const tmdbId = optInt(tv.id);
  if (tmdbId <= 0) return null;
  return { tmdbId, title: text(tv.name), poster: imageUrl(tv.poster_path, "w500"), backdrop: imageUrl(tv.backdrop_path, "w1280") };
}

/**
 * A season's episodes (native parseSeasonEpisodes): `null` = the question could not be answered (not
 * a JSON object), `[]` = TMDB answered and the season has none. A blank name reads "Episodio N".
 * `airDate` is TMDB's `air_date` when it is `YYYY-MM-DD` (else ""), `runtimeMinutes` its `runtime`
 * when 1 to 1000 (else 0).
 */
export function parseSeasonEpisodes(body) {
  const o = bodyOf(body);
  if (!isObject(o)) return null;
  const list = Array.isArray(o.episodes) ? o.episodes : [];
  return list.filter(isObject).map((e) => {
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

// `clock` (injected) lets a caller pass `{ deadline }`: a request never runs past it.
export function makeTmdb({ kino, clock = null }) {
  // The request timeout under the caller's deadline, or null when there is no time for one.
  function timeoutFor(bounds) {
    const deadline = bounds && typeof bounds.deadline === "number" && clock ? bounds.deadline : null;
    if (deadline === null) return TIMEOUT_MS;
    const ms = Math.min(TIMEOUT_MS, Math.floor(deadline - clock.now()));
    return ms >= MIN_TIMEOUT_MS ? ms : null;
  }

  // The key is a sealed secret the host swaps into the URL; a plugin that does not declare it gets
  // a throw here, which just means "no TMDB".
  function keyMarker() {
    try { return kino.secret("tmdbKey"); } catch (_) { return null; }
  }

  /** Title forms of a TMDB work (`type` "movie" or "tv"), or null whenever they cannot be had. */
  async function titleForms(type, id, bounds) {
    try {
      if (!Number.isInteger(id) || id <= 0) return null;
      const kind = type === "movie" ? "movie" : "tv";
      const body = await read(`/${kind}/${id}`, { language: TMDB_LANGUAGE, append_to_response: "translations" }, bounds);
      return body === null ? null : parseTitleForms(kind, body);
    } catch (_) {
      return null;
    }
  }

  /**
   * One TMDB read: `path` without a query string, `params` its query. Kino 0.9.53+'s `kino.tmdb` first (parsed
   * JSON, Kino's key); when it is absent or throws (any code: a 0.9.53 call left behind can be `not_allowed`),
   * kino.fetch with the sealed key, as before. The parsed object, the text, or null; never a throw.
   */
  async function read(path, params, bounds) {
    try {
      // Checked before each door: with less than MIN_TIMEOUT_MS left TMDB is skipped.
      if (timeoutFor(bounds) === null) return null;
      if (typeof kino.tmdb === "function") {
        try {
          const body = await kino.tmdb(path, { ...params });
          if (body !== null && typeof body === "object") return body;
        } catch (_) { /* the sealed key below */ }
      }
      const timeoutMs = timeoutFor(bounds);
      if (timeoutMs === null) return null;
      const key = keyMarker();
      if (!key) return null;
      const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
      const res = await kino.fetch(`${TMDB_BASE}${path}?api_key=${key}&${query}`, { cookies: false, timeoutMs });
      if (!res || !res.ok) return null;
      return res.text();
    } catch (_) {
      return null;
    }
  }

  /** `{ tmdbId, title, poster, backdrop }` of the series with that IMDb id, or null. */
  async function seriesByImdb(imdbId, bounds) {
    if (typeof imdbId !== "string" || !IMDB_ID.test(imdbId)) return null;
    const body = await read(`/find/${imdbId}`, { external_source: "imdb_id", language: TMDB_LANGUAGE }, bounds);
    return body === null ? null : parseSeriesByImdb(body);
  }

  /** The season's `[{ episode, name, overview, still, airDate, runtimeMinutes }]`, or null when it could not be had. `language` overrides es-MX. */
  async function seasonEpisodes(tvId, season, language = TMDB_LANGUAGE, bounds) {
    if (!Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season)) return null;
    const body = await read(`/tv/${tvId}/season/${season}`, { language }, bounds);
    return body === null ? null : parseSeasonEpisodes(body);
  }

  return { titleForms, seriesByImdb, seasonEpisodes };
}
