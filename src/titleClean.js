// The name a series goes by on TMDB, from the portal's title (2.2.21). The portal keeps every season as its own
// title and tags it with the dub and the season: "Dragón Ball Kai español T2". TMDB knows the series as
// "Dragon Ball Kai", so a lookup by the portal's title finds nothing; this takes the tags off.
import { SEASON_SOURCE } from "./search.js";

const B = "(?<![\\p{L}\\p{N}_])";
const E = "(?![\\p{L}\\p{N}_])";
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
