// The TMDB read the search needs: the other titles a work is known by (native TmdbApi.detail, only
// the title forms). TMDB is an enrichment, never a requirement: with no key declared, a failing
// request or an unreadable body the answer is simply `null` and the search goes on without it.
// Episodes' enrichment (4c) extends this module.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_LANGUAGE = "es-MX";
const TIMEOUT_MS = 8000;

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

  return { titleForms };
}
