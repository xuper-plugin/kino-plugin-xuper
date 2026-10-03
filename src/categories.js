// Xuper's Categorías tiles (apiVersion 6): the Home's featured and genre rows, in the classifier's
// order, as the native tiles were (CategoriesViewModel: magis_g_* plus the featured rows, the
// picture being the first shown item's backdrop, else its poster). `ref` is the row id `browse` pages.
import { CALL_BUDGET_MS } from "./portal.js";

const MAX_CATEGORIES = 24; // contract caps
const MAX_TITLE = 40;

/** Classified rows as category tiles; rows with nothing to show are left out. */
export function tilesOf(rows) {
  const out = [];
  for (const r of rows) {
    if (out.length >= MAX_CATEGORIES) break;
    if (r.shown.length === 0) continue;
    const first = r.shown[0];
    const art = (first.backdrop && first.backdrop.trim()) || (first.poster && first.poster.trim()) || null;
    const tile = { id: r.id, title: r.title.slice(0, MAX_TITLE), ref: r.id };
    if (art) tile.art = art;
    out.push(tile);
  }
  return out;
}

export function makeCategories({ catalog }) {
  return { categories: async () => tilesOf(await catalog.rows(CALL_BUDGET_MS.categories)) };
}
