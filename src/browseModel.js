// What the browse screen shows, from the classified rows (no network): the featured slides, the rails of one tab and the
// "Continuar viendo" row. Pure functions; browse.js keeps the results and browseView.js draws them.
import { rootOfRow } from "./homeClassifier.js";
import { projectItem, projectRows, oneEach } from "./catalog.js";
import { TABS } from "./section.js";

export const MAX_SLIDES = 6;
export const MAX_RAILS = 8;
export const MAX_RAIL_ITEMS = 20;
const MAX_SLIDE_TEXT = 160;
const HTTPS = /^https:\/\//;

export const TAB_IDS = TABS.map((t) => t.id);

/** The card Kino draws: the fields a rail needs and nothing else (the tree stays small). */
export function cardOf(item) {
  const out = { id: item.id, ref: item.ref, title: item.title, kind: item.kind };
  if (item.poster && HTTPS.test(item.poster)) out.poster = item.poster;
  // The backdrop too: a person who chose cards (not posters) in Kino's Ajustes sees them in these rails.
  if (item.backdrop && HTTPS.test(item.backdrop)) out.backdrop = item.backdrop;
  if (item.badges) out.badges = item.badges;
  if (item.rating !== undefined) out.rating = item.rating;
  if (item.ids) out.ids = item.ids;
  return out;
}

/**
 * Up to MAX_SLIDES featured titles of one tab: the first items, in row order, that have a backdrop and a synopsis, one per
 * title. An item without either is a poster, never a slide.
 */
export function slidesOf(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    for (const item of row.items) {
      if (out.length >= MAX_SLIDES) return out;
      if (item.adult === true || seen.has(item.id) || !item.backdrop || !HTTPS.test(item.backdrop)) continue;
      const text = typeof item.overview === "string" ? item.overview.trim() : "";
      if (text === "") continue;
      seen.add(item.id);
      out.push({
        id: item.id, ref: item.ref, kind: item.kind, title: item.title, image: item.backdrop,
        text: text.length <= MAX_SLIDE_TEXT ? text : `${text.slice(0, MAX_SLIDE_TEXT - 1).trimEnd()}…`,
      });
    }
  }
  return out;
}

/** The tab's rails: the classified rows of its root, trimmed to what a screen draws. */
export function railsOf(rows) {
  return rows.slice(0, MAX_RAILS).map((r) => ({
    id: r.id, title: r.title, ref: r.ref, items: r.items.slice(0, MAX_RAIL_ITEMS).map(cardOf),
  }));
}

/** One tab as the screen draws it, from the classified rows of every root; null when its root has no row yet. */
export function tabOf(rows, tab, nowMs, idsOf, english, spanish) {
  const projected = projectRows(rows.filter((r) => rootOfRow(r.id) === tab), nowMs, idsOf, english, spanish);
  if (projected.length === 0) return null;
  return { slides: slidesOf(projected), rails: railsOf(projected) };
}

/**
 * The titles the person played, newest first, found in the classified rows by contentId (a title that has left the portal's
 * lists is simply not shown).
 */
export function recentOf(rows, ids, nowMs, idsOf, english, spanish) {
  if (ids.length === 0) return [];
  const byId = new Map();
  for (const r of rows) for (const item of oneEach(r.shown)) if (!byId.has(item.id)) byId.set(item.id, item);
  const out = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    const card = projectItem(item, nowMs, idsOf, english, spanish);
    if (card) out.push(cardOf(card));
  }
  return out;
}
