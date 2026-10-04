// Xuper's own section (apiVersion 6): one tab per VOD root, each tab the Home's classified rows of
// that root. Replaces the native TV "Xuper" entry (TvCatalogSections), whose roots were tabs in
// this order. The adult root is never a tab: the portal is never asked for it.
import { rootOfRow } from "./homeClassifier.js";
import { projectRows } from "./catalog.js";

export const TABS = [
  { id: "peliculas", label: "Películas" },
  { id: "series", label: "Series" },
  { id: "infantil", label: "Infantil" },
  { id: "anime", label: "Anime" },
];

/** The classified rows of one root, projected as section rows (ref = row id, which `browse` pages). */
export const rowsOfTab = (rows, tab, nowMs) => projectRows(rows.filter((r) => rootOfRow(r.id) === tab), nowMs);

export function makeSection({ kino, catalog, clock }) {
  async function section(arg) {
    const asked = arg !== null && typeof arg === "object" ? arg.tab : null;
    const tab = asked === null || asked === undefined || asked === "" ? TABS[0].id : asked;
    if (!TABS.some((t) => t.id === tab)) throw kino.error("not_found", "No se encontró esa pestaña");
    const rows = await catalog.rows("section");
    return { tabs: TABS.map((t) => ({ ...t })), tab, rows: rowsOfTab(rows, tab, clock.now()) };
  }
  return { section };
}
