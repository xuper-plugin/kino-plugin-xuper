// Xuper's Categorías tiles (apiVersion 6): the Home's featured and genre rows, in the classifier's
// order, as the native tiles were (CategoriesViewModel: magis_g_* plus the featured rows, the
// picture being the first shown item's backdrop, else its poster). `ref` is the row id `browse` pages.
import { ADULT_REF } from "./catalog.js";
import { localizedRowTitle } from "./homeClassifier.js";
import { isEnglish } from "./i18n.js";

const MAX_CATEGORIES = 24; // contract caps
const MAX_TITLE = 40;

/** Classified rows as category tiles; rows with nothing to show are left out. */
export function tilesOf(rows, english = false) {
  const out = [];
  for (const r of rows) {
    if (out.length >= MAX_CATEGORIES) break;
    if (r.shown.length === 0) continue;
    const first = r.shown[0];
    const art = (first.backdrop && first.backdrop.trim()) || (first.poster && first.poster.trim()) || null;
    const tile = { id: r.id, title: localizedRowTitle(r, english).slice(0, MAX_TITLE), ref: r.id };
    if (art) tile.art = art;
    out.push(tile);
  }
  return out;
}

// The 18+ tile (D3): last, as native put the 18+ root last; no picture, so listing it asks nothing of the
// portal. Kino shows it only while the device's 18+ code is unlocked.
const ADULT_TILE = Object.freeze({ id: ADULT_REF, title: "18+", ref: ADULT_REF, adult: true });

// `kino` (optional): its language picks the tiles' titles. `liveTiles` (optional, liveTiles.js): the live
// channel tiles, asked beside the VOD rows; they go after the VOD tiles and before the 18+ one, and the VOD
// tiles give up their tail to make room (at most MAX_LIVE_TILES of the 24).
export function makeCategories({ catalog, kino = null, liveTiles = null }) {
  return {
    // An empty catalog stays empty: an 18+ tile alone would be the only thing Xuper offers. Live tiles alone
    // are shown (the VOD catalog failing must not hide them, nor they it: tiles() never throws).
    categories: async () => {
      const [rows, live] = await Promise.all([
        catalog.rows("categories").then((r) => ({ r }), (e) => ({ e })),
        liveTiles ? liveTiles.tiles() : Promise.resolve([]),
      ]);
      if (rows.e && live.length === 0) throw rows.e;
      const tiles = rows.e ? [] : tilesOf(rows.r, isEnglish(kino));
      if (tiles.length === 0) return live;
      return [...tiles.slice(0, MAX_CATEGORIES - 1 - live.length), ...live, { ...ADULT_TILE }];
    },
  };
}
