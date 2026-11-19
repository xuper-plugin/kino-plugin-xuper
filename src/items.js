// items.js — pure mapping of a portal card to a Kino item (no `kino`, no network). Shared by the device and
// by the publisher's v2 converter (src/v2.js), so both produce exactly the same items.
import { itemRef } from "./refs.js";

/** 1.0.43's choice: the first poster|stage|vertical entry, else the first with a URL (landscape on this portal). */
export function pickPoster(posterList) {
  if (!Array.isArray(posterList)) return undefined;
  const withUrl = posterList.filter((p) => p && p.fileUrl);
  const chosen = withUrl.find((p) => /poster|stage|vertical/i.test(p.fileType || "")) || withUrl[0];
  return chosen ? chosen.fileUrl : undefined;
}

const isGif = (u) => /\.gif(?:[?#]|$)/i.test(String(u || ""));
const isHttps = (u) => /^https:\/\//i.test(String(u || ""));
const MAX_URL = 2048;                              // Kino's image URL limit
const ID_RX = /^[A-Za-z0-9._~-]{1,128}$/;          // Kino's item id pattern
const okImage = (u) => !!u && isHttps(u) && String(u).length <= MAX_URL;
const typeOf = (p) => String((p && p.fileType) || "").toLowerCase();

/** The portrait art Kino paints on a card: the portal's `icon` entry (262×370), the official cover. A static entry
 *  wins over a GIF one when both exist, but a GIF is still used over no portrait at all: Kino's image loader has no
 *  animated-GIF decoder, so it paints a GIF's first frame as a still — no animation, no TV-box CPU cost — and the real
 *  cover beats falling back to the wide landscape art. */
export function pickPortrait(posterList) {
  if (!Array.isArray(posterList)) return undefined;
  const icons = posterList.filter((x) => x && x.fileUrl && typeOf(x) === "icon");
  const p = icons.find((x) => !isGif(x.fileUrl)) || icons[0];
  return p ? p.fileUrl : undefined;
}

/** The landscape art for Kino's `backdrop`: the first `stage`, else the first `poster` (both 1920×1080 here). */
export function pickBackdrop(posterList) {
  if (!Array.isArray(posterList)) return undefined;
  for (const t of ["stage", "poster"]) {
    const p = posterList.find((x) => x && x.fileUrl && typeOf(x) === t);
    if (p) return p.fileUrl;
  }
  return undefined;
}

// duration "HH:MM:SS" (or "MM:SS") → minutes. Empty/invalid → 0. With minutes, Kino keeps the title in its library
// and resumes it ("continue watching"); live items carry no runtimeMinutes.
export function durationToMinutes(d) {
  if (typeof d !== "string" || !d) return 0;
  const parts = d.split(":").map((x) => parseInt(x, 10));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => Number.isNaN(n))) return 0;
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  const mins = Math.round((h * 3600 + m * 60 + s) / 60);
  return mins > 0 ? mins : 0;
}

/**
 * card → Kino item.
 * `opts.poster`:
 *   "legacy" (default) — exactly 1.0.43: `poster` = pickPoster (landscape), no `backdrop`;
 *   "recommended"      — `poster` = the non-GIF portrait `icon`, else the landscape art; `backdrop` = the
 *                        landscape art when it differs; only https images up to 2,048 characters (Kino's screens
 *                        blank plain http); within Kino's item limits (title ≤ 200, overview ≤ 2,000, rating ≤ 10,
 *                        runtime ≤ 1,000); and a card whose id Kino would refuse (outside ^[A-Za-z0-9._~-]{1,128}$)
 *                        is left out here, as Kino would drop it, instead of failing the whole catalog's validation.
 */
export function toItem(card, adult = false, opts) {
  if (!card || !card.contentId) return null;
  const rec = !!(opts && opts.poster === "recommended");
  if (rec && !ID_RX.test(String(card.contentId))) return null;
  const type = String(card.type == null ? "" : card.type);
  const item = {
    id: String(card.contentId),
    ref: itemRef(card.contentId, type),
    title: rec ? (String(card.name || card.title || "").trim().slice(0, 200) || "—") : String(card.name || card.title || "—"),
    kind: type === "0" ? "series" : "movie",
  };
  if (rec) {
    const wide = pickBackdrop(card.posterList);
    // the first usable candidate: the portrait, else the landscape art, else 1.0.43's pick
    const poster = [pickPortrait(card.posterList), wide, pickPoster(card.posterList)].find(okImage);
    if (poster) item.poster = poster;
    if (okImage(wide) && wide !== poster) item.backdrop = wide;
  } else {
    const poster = pickPoster(card.posterList);
    if (poster) item.poster = poster;
  }
  if (card.description) item.overview = rec ? String(card.description).slice(0, 2000) : String(card.description);
  const score = Number(card.score);
  if (score > 0 && (!rec || score <= 10)) item.rating = score;
  let tags = typeof card.tags === "string"
    ? card.tags.split(/[,，/]/).map((s) => s.trim()).filter(Boolean)
    : Array.isArray(card.tags) ? card.tags : [];
  if (rec) tags = tags.filter((g) => typeof g === "string" && g.trim()).map((g) => g.trim());
  if (tags.length) item.genres = tags.slice(0, 5);
  const rt = durationToMinutes(card.duration);
  if (rt > 0 && (!rec || rt <= 1000)) item.runtimeMinutes = rt;   // → Kino's native "continue watching"
  if (adult) item.adult = true;           // 18+: Kino shows it only with the parental lock open
  return item;
}

export function toItems(cards, adult = false, opts) {
  const out = [], seen = new Set();
  for (const c of cards || []) {
    const it = toItem(c, adult, opts);
    if (it && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
  }
  return out;
}

/** The portal rows of a section ({recommendList|columnList}) → the row list. */
export function rowList(rowsData) {
  return (rowsData && (rowsData.recommendList || rowsData.columnList)) || [];
}

/** The cards of one portal row. */
export function rowCards(r) {
  return (r && (r.assetList || r.contentList || r.list)) || [];
}

// /section/{name} → {slider, rows:{recommendList:[{assetList:[...]}, ...]}} → every card (in order, not deduped).
export function sectionCards(rowsData) {
  const cards = [];
  for (const r of rowList(rowsData)) cards.push(...rowCards(r));
  return cards;
}
