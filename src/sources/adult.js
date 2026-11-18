// src/sources/adult.js — the one 18+ title rule shared by every live connector (premiumtv groups, supertv / Xtream
// categories, xuper columns). Kino gates `adult` categories and channels; the own screen leaves adult categories out
// of its dropdowns. Broad on purpose: a false positive only puts a category behind the 18+ lock.
// Matched on the accent-free, lower-case title: "Eróticos" reads "eroticos". "sex" only as a word ("Sexy", "Hot Sex",
// never "Sexto" or "Essex"); "+18" / "18+" never inside a longer number ("+180", "2018").

export const ADULT_RE = /adult|xxx|porn|erotic|erotik|hentai|playboy|hustler|brazzers|\+ ?18(?!\d)|(?:^|\D)18 ?\+|(?:^|[^a-z])sex(?:y|o)?(?![a-z])/;

/** Whether a category / group / column title reads 18+. */
export function isAdultTitle(title) {
  const t = String(title == null ? "" : title).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return ADULT_RE.test(t);
}
