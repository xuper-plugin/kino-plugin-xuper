// The portal's `getNextColumns` answer for one VOD root, as sections of items (native
// MagisLiveCatalog.tree, native-magis.md §4.1), plus the compact form kept in kino.storage.
import { encode } from "./refs.js";

const PORTAL_OFFSET_MS = 8 * 3600_000; // the portal's shelveTime has no zone: China time, UTC+8

const isBlank = (s) => typeof s !== "string" || s.trim() === "";
const asText = (v) => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v));
const nonBlank = (v) => { const s = asText(v); return s.trim() === "" ? null : s; };

// Kotlin's `opt(k)?.toString()?.toIntOrNull()` / `toDoubleOrNull()`.
const INT = /^[+-]?\d+$/;
const DEC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function intOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!INT.test(s)) return null;
  const n = Number(s);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}
function numberOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return DEC.test(s) ? Number(s) : null;
}

/** `yyyy-MM-dd HH:mm:ss` read as UTC+8, as epoch ms; 0 when missing or unreadable (0 = unknown). */
export function parseShelveTime(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) return 0;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t); // non-lenient: February 30th or 25:00 do not round-trip
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d ||
      back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== s) return 0;
  return t - PORTAL_OFFSET_MS;
}

// First `posterList` entry of the given fileType with a url.
function imageOf(asset, fileType) {
  if (!Array.isArray(asset.posterList)) return null;
  for (const p of asset.posterList) {
    if (p && p.fileType === fileType && !isBlank(p.fileUrl)) return p.fileUrl;
  }
  return null;
}

function itemFrom(a) {
  if (a === null || typeof a !== "object") return null;
  const id = nonBlank(a.contentId);
  if (id === null) return null;
  const type = nonBlank(a.programType) ?? "movie";
  const tags = asText(a.tags).split(",").map((t) => t.trim()).filter((t) => t !== "");
  return {
    id,
    title: asText(a.name),
    poster: imageOf(a, "icon") ?? nonBlank(a.posterUrl),
    backdrop: imageOf(a, "poster"),
    durationS: intOrNull(a.duration) ?? 0,
    type,
    genres: tags,
    score: numberOrNull(a.score),
    description: asText(a.description),
    shelvedAtMs: parseShelveTime(asText(a.shelveTime)),
  };
}

/** Sections `[{ name, items }]` of a `getNextColumns` answer; a column with a blank name is skipped. */
export function parseTree(response) {
  const columns = response && Array.isArray(response.recommendList) ? response.recommendList : [];
  const sections = [];
  for (const c of columns) {
    if (c === null || typeof c !== "object") continue;
    const name = nonBlank(c.name);
    if (name === null) continue;
    const items = [];
    if (Array.isArray(c.assetList)) for (const a of c.assetList) { const it = itemFrom(a); if (it) items.push(it); }
    sections.push({ name, items });
  }
  return sections;
}

export const refOf = (item) => encode({ contentId: item.id, programType: item.type, episode: 0 });

// ---- compact storage form -----------------------------------------------------------------------
// { v: format version, p: common image url prefix, i: [[id,title,poster,backdrop,durationS,type,genres,score,desc,shelvedAtMs]...],
//   s: [[name,[index into i...]]...] }. Items are deduplicated (an item shows in several sections), the
// url prefix is kept once, and descriptions can be cut to fit the storage budget.

export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { n += 4; i++; } else n += 3;
  }
  return n;
}

function commonPrefix(urls) {
  if (urls.length === 0) return "";
  let p = urls[0];
  for (const u of urls) { while (!u.startsWith(p)) p = p.slice(0, -1); if (p === "") break; }
  return p.length >= 12 ? p : "";
}

function cut(text, max) {
  if (text.length <= max) return text;
  const end = text.charCodeAt(max - 1) >= 0xd800 && text.charCodeAt(max - 1) < 0xdc00 ? max - 1 : max;
  return text.slice(0, end);
}

export const TREE_FORMAT = 1;

/**
 * `shed` trims what the stored form keeps: `descMax` (description length), `genres` and `backdrop`
 * (false drops them) and `perSection` (items kept per section).
 */
export function encodeTree(sections, { descMax = Infinity, genres = true, backdrop = true, perSection = Infinity } = {}) {
  sections = sections.map((s) => (s.items.length > perSection ? { ...s, items: s.items.slice(0, perSection) } : s));
  const urls = [];
  for (const s of sections) for (const i of s.items) { if (i.poster) urls.push(i.poster); if (backdrop && i.backdrop) urls.push(i.backdrop); }
  const p = commonPrefix(urls);
  const strip = (u) => (u === null ? null : u.slice(p.length));
  const table = new Map();
  const items = [];
  const s = sections.map((sec) => [sec.name, sec.items.map((i) => {
    const rec = [i.id, i.title, strip(i.poster), backdrop ? strip(i.backdrop) : null, i.durationS, i.type, genres ? i.genres : [], i.score,
      cut(i.description, descMax), i.shelvedAtMs];
    const key = JSON.stringify(rec);
    if (!table.has(key)) { table.set(key, items.length); items.push(rec); }
    return table.get(key);
  })]);
  return JSON.stringify({ v: TREE_FORMAT, p, i: items, s });
}

/** The sections of a stored tree; throws when the stored value is not one (the caller treats it as a miss). */
export function decodeTree(text) {
  const o = JSON.parse(text);
  if (o === null || typeof o !== "object" || o.v !== TREE_FORMAT || typeof o.p !== "string" || !Array.isArray(o.i) || !Array.isArray(o.s)) {
    throw new Error("stored tree is malformed");
  }
  const full = (u) => (typeof u === "string" ? o.p + u : null);
  const items = o.i.map((r) => {
    if (!Array.isArray(r) || typeof r[0] !== "string" || typeof r[5] !== "string" || !Array.isArray(r[6])) {
      throw new Error("stored item is malformed");
    }
    return {
      id: r[0], title: asText(r[1]), poster: full(r[2]), backdrop: full(r[3]), durationS: Number(r[4]) || 0,
      type: r[5], genres: r[6].map(asText), score: typeof r[7] === "number" ? r[7] : null,
      description: asText(r[8]), shelvedAtMs: Number(r[9]) || 0,
    };
  });
  return o.s.map((sec) => {
    if (!Array.isArray(sec) || typeof sec[0] !== "string" || !Array.isArray(sec[1])) throw new Error("stored section is malformed");
    return { name: sec[0], items: sec[1].map((n) => { if (!items[n]) throw new Error("stored index is malformed"); return items[n]; }) };
  });
}
