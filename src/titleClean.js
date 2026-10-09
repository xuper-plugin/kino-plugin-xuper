// The name a series goes by on TMDB, from the portal's title (2.2.21). The portal keeps every season as its own
// title and tags it with the dub and the season: "Dragón Ball Kai español T2". TMDB knows the series as
// "Dragon Ball Kai", so a lookup by the portal's title finds nothing; this takes the tags off.
import { SEASON_SOURCE } from "./seasonTag.js";

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

// The dub / quality tags the portal puts right before the season tag, only ever taken off the END of a title that ends in
// a season tag. Narrower than LANGUAGE: a bare "latino", "sub" or "dual" can be part of a name ("Amor Latino"), so they
// only count with "español" / "audio" in front.
// Built on first use, not at load: compiling a Unicode, case-insensitive regex is slow on a TV's engine, and nearly every
// title is turned back before it by ENDS_IN_DIGIT.
const ENDS_IN_DIGIT = /[0-9]\s*$/;
let tails = null;
function tailRegexes() {
  if (tails === null) {
    const tags =
      `(?:${B}audio\\s+(?:latino|espa[ñn]ol|castellano)|${B}espa[ñn]ol(?:\\s+latino)?|${B}castellano|${B}subtitulad[oa]|${B}doblad[oa]|${B}hd|${B}4k|${B}\\d{3,4}p)${E}`;
    tails = {
      tags: new RegExp(`(?:[\\s_.:;,|/\\\\-]*${tags})+[\\s_.:;,|/\\\\-]*$`, "iu"),
      season: new RegExp(`(?:[\\s_.:;,|/\\\\-]*)${SEASON_SOURCE}\\s*$`, "iu"),
    };
  }
  return tails;
}

/**
 * The title as the person should read it (2.2.23): the portal keeps every season as its own title and tags it
 * ("Dragon Ball Kai Español T2"); the season has its own field, so the name drops the season tag and the dub tags
 * right before it ("Dragon Ball Kai"). Conservative on purpose: only a title that ENDS in a season tag is touched,
 * so "Amor Latino" or a movie called "HD" keep their name. Anything that would leave under 2 letters is unchanged.
 */
export function displaySeriesTitle(title) {
  if (typeof title !== "string") return "";
  // A season tag always ends in a digit: nearly every title is turned back here, so Home and the categories (thousands of
  // items, on a slow TV) pay for no regex at all.
  if (!ENDS_IN_DIGIT.test(title)) return title;
  const { tags, season } = tailRegexes();
  const m = season.exec(title);
  if (!m) return title;
  const rest = title.slice(0, m.index).replace(tags, "").replace(/[\s_.:;,|/\\-]+$/g, "").trim();
  return rest.length >= 2 ? rest : title;
}
