// The name a series goes by on TMDB, from the portal's title (ported from Xuper 2.x titleClean.js / seasonTag.js). The portal
// keeps every season as its own title and tags it with the dub and the season: "Dragón Ball Kai español T2". TMDB knows the
// series as "Dragon Ball Kai", so a lookup by the portal's title finds nothing; this takes the tags off. Used only for the
// TMDB fallback when the portal gives no IMDb id.
const B = "(?<![\\p{L}\\p{N}_])";
const E = "(?![\\p{L}\\p{N}_])";

/** The season tag the portal puts in a title ("T2", "Temp. 2", "Temporada 2", "S2"), with the number captured. */
export const SEASON_SOURCE = `(?:${B}T\\s?([0-9]{1,2})${E}|${B}Temp\\.?\\s?([0-9]{1,2})${E}|${B}Temporada\\s?([0-9]{1,2})${E}|${B}S([0-9]{1,2})${E})`;

// The dub / subtitle / quality tags the portal appends ("español", "audio latino", "castellano", "subtitulado", "HD", "1080p").
const LANGUAGE = new RegExp(
  `${B}(?:audio\\s+)?(?:espa[ñn]ol(?:\\s+latino)?|castellano|latino|latam|subtitulad[oa]|doblad[oa]|dual|sub(?:\\s+esp)?|hd|4k|\\d{3,4}p)${E}`,
  "giu",
);
const SEASON = new RegExp(SEASON_SOURCE, "giu");
const BRACKETS = /[([{][^)\]}]*[)\]}]/g;

/** `"Dragón Ball Kai español T2"` -> `"Dragón Ball Kai"`; "" when nothing readable is left. */
export function cleanSeriesTitle(title) {
  if (typeof title !== "string") return "";
  const t = title
    .replace(BRACKETS, " ")
    .replace(SEASON, " ")
    .replace(LANGUAGE, " ")
    .replace(/[\s_.:;,|/\\-]+/g, " ")
    .trim();
  return t.length >= 2 ? t : "";
}

// ── the title as the person reads it, and the season collapse in search (ported from Xuper 2.x) ──
// The portal keeps every season as its own title and tags it ("Lupin T2"); the season has its own place (the chips in the
// detail), so the displayed name drops the season tag and the dub tags right before it, and search shows ONE entry per
// series. Conservative: only a title that ENDS in a season tag is touched ("Amor Latino", a movie called "HD" keep theirs).
const ENDS_IN_DIGIT = /[0-9]\s*$/;
let tails = null;
function tailRegexes() {
  if (tails === null) {
    const tags = `(?:${B}audio\\s+(?:latino|espa[ñn]ol|castellano)|${B}espa[ñn]ol(?:\\s+latino)?|${B}castellano|${B}subtitulad[oa]|${B}doblad[oa]|${B}hd|${B}4k|${B}\\d{3,4}p)${E}`;
    tails = {
      tags: new RegExp(`(?:[\\s_.:;,|/\\\\-]*${tags})+[\\s_.:;,|/\\\\-]*$`, "iu"),
      season: new RegExp(`(?:[\\s_.:;,|/\\\\-]*)${SEASON_SOURCE}\\s*$`, "iu"),
    };
  }
  return tails;
}

/** `"Lupin T2"` -> `"Lupin"`; a title that does not END in a season tag is returned unchanged. */
export function displaySeriesTitle(title) {
  if (typeof title !== "string") return "";
  if (!ENDS_IN_DIGIT.test(title)) return title;
  const { tags, season } = tailRegexes();
  const m = season.exec(title);
  if (!m) return title;
  const rest = title.slice(0, m.index).replace(tags, "").replace(/[\s_.:;,|/\\-]+$/g, "").trim();
  return rest.length >= 2 ? rest : title;
}

/** The season number a title's tag names ("Lupin T2" -> 2); 1 when it carries no tag (a single-season series). */
export function seasonFromName(name) {
  const m = new RegExp(SEASON_SOURCE, "iu").exec(typeof name === "string" ? name : "");
  if (!m) return 1;
  const digits = m.slice(1).find((g) => g !== undefined && g.trim() !== "");
  return digits === undefined ? 1 : Number(digits);
}

// Lowercase, no accents, words only: "Lupin" and "lupin" are one series.
const seriesKey = (name) => String(name).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * One entry per series: the portal lists every season as its own title ("Lupin T1", "Lupin T2"), which reads as the same
 * series several times. For every SERIES whose title carries a season tag, only the LOWEST season stays (at its own place);
 * the others are one tap away in the detail's season chips. No-season titles (single-season series, movies) are never
 * grouped. `read(item)` → `{ title, series }` (series = it is a series, not a movie).
 */
export function collapseSeasons(items, read) {
  const best = new Map();   // series key -> { index, season }
  items.forEach((it, i) => {
    const { title, series } = read(it);
    if (!series) return;
    const shown = displaySeriesTitle(title);
    if (shown === title) return;   // no season tag: a series of its own
    const key = seriesKey(shown);
    const season = seasonFromName(title);
    const cur = best.get(key);
    if (cur === undefined || season < cur.season) best.set(key, { index: i, season });
  });
  if (best.size === 0) return items;
  return items.filter((it, i) => {
    const { title, series } = read(it);
    if (!series) return true;
    const shown = displaySeriesTitle(title);
    if (shown === title) return true;
    return best.get(seriesKey(shown)).index === i;
  });
}
