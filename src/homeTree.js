// The portal's `getNextColumns` answer for one VOD root, as sections of items (native
// MagisLiveCatalog.tree, native-magis.md §4.1), and the stored size every storage budget is measured in.
import { encode } from "./refs.js";
import { isBlank, asText, intOrNull } from "./util.js";

const PORTAL_OFFSET_MS = 8 * 3600_000; // the portal's shelveTime has no zone: China time, UTC+8

const nonBlank = (v) => { const s = asText(v); return s.trim() === "" ? null : s; };

// Kotlin's `opt(k)?.toString()?.toIntOrNull()` / `toDoubleOrNull()`.
const DEC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
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

/** A portal item's picture as the SDK wants it: the `icon` entry of `posterList`, else the loose `posterUrl`. */
export const logoOf = (a) => imageOf(a, "icon") ?? nonBlank(a.posterUrl);

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

// ---- stored sizes -------------------------------------------------------------------------------

/**
 * The bytes `s` takes in the app's storage file: Android's org.json writes every stored value
 * escaped (`"`, `\` and `/` get a backslash, \t \b \n \r \f two characters, other control
 * characters \uXXXX) and the file is measured in UTF-8. Byte budgets are measured with this.
 */
export function storedLength(s) {
  // Counted with regular expressions: on QuickJS a per-character loop is the slow part of measuring
  // an 80 KB snapshot on a TV.
  let n = s.length + countOf(s, /["\\/\t\b\n\r\f]/g) + 5 * countOf(s, /[\x00-\x07\x0b\x0e-\x1f]/g);
  if (NON_ASCII.test(s)) {
    // UTF-8: 2 bytes up to U+07FF, 3 up to U+FFFF; a surrogate pair is 4 bytes for its 2 units, a lone one 3.
    const pairs = countOf(s, /[\ud800-\udbff][\udc00-\udfff]/g) / 2;
    n += countOf(s, /[\u0080-\u07ff]/g) + 2 * countOf(s, /[\u0800-\ud7ff\ue000-\uffff]/g) + 2 * pairs +
      2 * (countOf(s, /[\ud800-\udfff]/g) - 2 * pairs);
  }
  return n;
}

const NON_ASCII = /[^\x00-\x7f]/;
const countOf = (s, re) => s.length - s.replace(re, "").length;

export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { n += 4; i++; } else n += 3;
  }
  return n;
}
