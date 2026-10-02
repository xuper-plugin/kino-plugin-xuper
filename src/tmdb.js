// The TMDB read the search needs: the other titles a work is known by (native TmdbApi.detail, only
// the title forms). TMDB is an enrichment, never a requirement: with no key declared, a failing
// request or an unreadable body the answer is simply `null` and the search goes on without it.
// The episodes' enrichment reads (native TmdbApi.seriesByImdb / seasonEpisodes) live here too.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_LANGUAGE = "es-MX";
const TIMEOUT_MS = 8000;
const IMG = "https://image.tmdb.org/t/p";
const IMDB_ID = /^tt\d{7,}$/;

const text = (v) => (typeof v === "string" ? v : "");
const blank = (s) => s.trim() === "";

/**
 * The title forms inside a TMDB detail body (native TmdbApi.detail): the localized title, the
 * original one, the English one (translations, iso_639_1 "en", first) and every distinct Spanish
 * variant other than the localized title. `null` when the body is not a JSON object.
 */
export function parseTitleForms(type, body) {
  let o;
  try { o = JSON.parse(body); } catch (_) { return null; }
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

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
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
  let o;
  try { o = JSON.parse(body); } catch (_) { return null; }
  const tv = isObject(o) && Array.isArray(o.tv_results) && isObject(o.tv_results[0]) ? o.tv_results[0] : null;
  if (tv === null) return null;
  const tmdbId = optInt(tv.id);
  if (tmdbId <= 0) return null;
  return { tmdbId, title: text(tv.name), poster: imageUrl(tv.poster_path, "w500"), backdrop: imageUrl(tv.backdrop_path, "w1280") };
}

/**
 * A season's episodes (native parseSeasonEpisodes): `null` = the question could not be answered (not
 * a JSON object), `[]` = TMDB answered and the season has none. A blank name reads "Episodio N".
 */
export function parseSeasonEpisodes(body) {
  let o;
  try { o = JSON.parse(body); } catch (_) { return null; }
  if (!isObject(o)) return null;
  const list = Array.isArray(o.episodes) ? o.episodes : [];
  return list.filter(isObject).map((e) => {
    const episode = optInt(e.episode_number);
    const name = text(e.name);
    return { episode, name: blank(name) ? `Episodio ${episode}` : name, overview: text(e.overview), still: imageUrl(e.still_path, "w300") };
  });
}

export function makeTmdb({ kino }) {
  // The key is a sealed secret the host swaps into the URL; a plugin that does not declare it gets
  // a throw here, which just means "no TMDB".
  function keyMarker() {
    try { return kino.secret("tmdbKey"); } catch (_) { return null; }
  }

  /** Title forms of a TMDB work (`type` "movie" or "tv"), or null whenever they cannot be had. */
  async function titleForms(type, id) {
    try {
      if (!Number.isInteger(id) || id <= 0) return null;
      const key = keyMarker();
      if (!key) return null;
      const kind = type === "movie" ? "movie" : "tv";
      const url = `${TMDB_BASE}/${kind}/${id}?api_key=${key}&language=${TMDB_LANGUAGE}&append_to_response=translations`;
      const res = await kino.fetch(url, { cookies: false, timeoutMs: TIMEOUT_MS });
      if (!res || !res.ok) return null;
      return parseTitleForms(kind, res.text());
    } catch (_) {
      return null;
    }
  }

  async function read(path, language) {
    try {
      const key = keyMarker();
      if (!key) return null;
      const sep = path.includes("?") ? "&" : "?";
      const res = await kino.fetch(`${TMDB_BASE}${path}${sep}api_key=${key}&language=${language}`, { cookies: false, timeoutMs: TIMEOUT_MS });
      if (!res || !res.ok) return null;
      return res.text();
    } catch (_) {
      return null;
    }
  }

  /** `{ tmdbId, title, poster, backdrop }` of the series with that IMDb id, or null. */
  async function seriesByImdb(imdbId) {
    if (typeof imdbId !== "string" || !IMDB_ID.test(imdbId)) return null;
    const body = await read(`/find/${imdbId}?external_source=imdb_id`, TMDB_LANGUAGE);
    return body === null ? null : parseSeriesByImdb(body);
  }

  /** The season's `[{ episode, name, overview, still }]`, or null when it could not be had. `language` overrides es-MX. */
  async function seasonEpisodes(tvId, season, language = TMDB_LANGUAGE) {
    if (!Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season)) return null;
    const body = await read(`/tv/${tvId}/season/${season}`, language);
    return body === null ? null : parseSeasonEpisodes(body);
  }

  return { titleForms, seriesByImdb, seasonEpisodes };
}
