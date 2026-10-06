// Xuper's own section (apiVersion 6): one tab per VOD root, each tab the Home's classified rows of
// that root. Replaces the native TV "Xuper" entry (TvCatalogSections), whose roots were tabs in
// this order. The adult root is never a tab: the portal is never asked for it.
import { rootOfRow } from "./homeClassifier.js";
import { projectRows } from "./catalog.js";
import { isEnglish } from "./i18n.js";

export const TABS = [
  { id: "peliculas", label: "Películas" },
  { id: "series", label: "Series" },
  { id: "infantil", label: "Infantil" },
  { id: "anime", label: "Anime" },
];
const TAB_LABELS_EN = Object.freeze({ peliculas: "Movies", series: "Series", infantil: "Kids", anime: "Anime" });

const MAX_HERO_TEXT = 300; // contract: section.maxHeroTextChars

/** The classified rows of one root, projected as section rows (ref = row id, which `browse` pages). */
export const rowsOfTab = (rows, tab, nowMs, idsOf = undefined, english = false) =>
  projectRows(rows.filter((r) => rootOfRow(r.id) === tab), nowMs, idsOf, english);

/**
 * The tab's featured title, from the rows it already shows (no portal call): the first item, in row order,
 * with both a backdrop and a synopsis; never an 18+ one. `{ title, text, image }`, or null when none has both.
 */
export function heroOf(rows) {
  for (const row of rows) {
    for (const item of row.items) {
      if (item.adult === true || !item.backdrop || typeof item.overview !== "string" || item.overview.trim() === "") continue;
      const text = item.overview.trim();
      return {
        title: item.title,
        text: text.length <= MAX_HERO_TEXT ? text : `${text.slice(0, MAX_HERO_TEXT - 1).trimEnd()}…`,
        image: item.backdrop,
      };
    }
  }
  return null;
}

export function makeSection({ kino, catalog, clock }) {
  async function section(arg) {
    const asked = arg !== null && typeof arg === "object" ? arg.tab : null;
    const tab = asked === null || asked === undefined || asked === "" ? TABS[0].id : asked;
    if (!TABS.some((t) => t.id === tab)) throw kino.error("not_found", "No se encontró esa pestaña");
    const rows = await catalog.rows("section", tab);
    const idsOf = typeof catalog.idsLookup === "function" ? catalog.idsLookup() : undefined;
    const english = isEnglish(kino);
    const tabRows = rowsOfTab(rows, tab, clock.now(), idsOf, english);
    const hero = heroOf(tabRows);
    const tabs = TABS.map((t) => ({ id: t.id, label: english ? TAB_LABELS_EN[t.id] : t.label }));
    return { tabs, tab, ...(hero ? { hero } : {}), rows: tabRows };
  }
  return { section };
}
