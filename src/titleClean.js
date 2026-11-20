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
