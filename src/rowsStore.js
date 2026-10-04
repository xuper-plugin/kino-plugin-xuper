// The classified VOD rows (homeClassifier output) kept in kino.storage, so that a cold start answers
// home, categories and section from storage instead of fetching, parsing and classifying the four
// roots again. Only what those three read is kept: per row its id, title and `shown` items (never
// `all`, which only browse and the scoped search page through); per item the fields projectItem
// and the category tiles read.
//
// The whole snapshot is far bigger than one storage value should be, so it is split into parts of at
// most PART_BUDGET_BYTES each (as the app stores them: escaped, `storedLength`), all of them together
// under the snapshot's budget. A meta key, written LAST, names the parts' generation, count, length
// and checksum: a read that finds a part of another generation, a missing part or a checksum that
// does not match is a miss, never a mix of two snapshots.
import { storedLength } from "./homeTree.js";
import { asText } from "./util.js";

export const ROWS_FORMAT = 1;
export const META_KEY = "rows:meta";
export const PART_PREFIX = "rows:";
// All parts and the meta together: the 80 KB the four per-root trees had (storageBudget.test.mjs).
export const SNAPSHOT_BUDGET_BYTES = 80_000;
export const PART_BUDGET_BYTES = 20_000;
// What the meta and each part's generation tag may take, kept out of the text's own budget.
const META_RESERVE_BYTES = 400;
const PART_TAG_BYTES = 16;
export const TEXT_BUDGET_BYTES = SNAPSHOT_BUDGET_BYTES - META_RESERVE_BYTES - 4 * PART_TAG_BYTES;

function commonPrefix(urls) {
  if (urls.length === 0) return "";
  let p = urls[0];
  for (const u of urls) { while (!u.startsWith(p)) p = p.slice(0, -1); if (p === "") break; }
  return p.length >= 12 ? p : "";
}

/**
 * The rows that keep every `shown` item: the first `keepFull` rows; the rest keep only their first
 * item (the category tile's picture), and the snapshot is marked partial. Items are deduplicated by
 * identity, in first-use order.
 */
function collect(rows, keepFull) {
  const index = new Map();
  const items = [];
  const refs = rows.map((r, n) => {
    const shown = n < keepFull ? r.shown : r.shown.slice(0, 1);
    return shown.map((i) => {
      let k = index.get(i);
      if (k === undefined) { k = items.length; index.set(i, k); items.push(i); }
      return k;
    });
  });
  return { items, refs };
}

// The stored bytes a description adds over an empty one.
const descCost = (d) => storedLength(JSON.stringify(d)) - 4;

/**
 * The stored form: `{ v, c: 1 when every row keeps all its shown items, p: common url prefix,
 * g: genre names, t: type names, i: [[id, title, poster, backdrop, durationS, type#, [genre#], score,
 * description, shelved seconds]], r: [[row id, row title, [item#]]] }`. Items are in first-use order;
 * only the first `descItems` keep their description (a description is whole or absent, never cut:
 * an absent one lets Kino use TMDB's synopsis, a cut one would show as the synopsis). `genres: false`
 * drops genres, `keepFull` is how many rows keep every shown item.
 */
export function encodeRows(rows, { descItems = Infinity, genres = true, keepFull = Infinity } = {}) {
  const { items, refs } = collect(rows, keepFull);
  const urls = [];
  for (const i of items) { if (i.poster) urls.push(i.poster); if (i.backdrop) urls.push(i.backdrop); }
  const p = commonPrefix(urls);
  const strip = (u) => (u ? u.slice(p.length) : null);
  const genreIx = new Map();
  const typeIx = new Map();
  const ix = (map, v) => { let k = map.get(v); if (k === undefined) { k = map.size; map.set(v, k); } return k; };
  const i = items.map((it, n) => [
    it.id, it.title, strip(it.poster), strip(it.backdrop), it.durationS, ix(typeIx, it.type),
    genres ? it.genres.map((g) => ix(genreIx, g)) : [], it.score, n < descItems ? it.description : "",
    it.shelvedAtMs > 0 ? Math.round(it.shelvedAtMs / 1000) : 0,
  ]);
  const r = rows.map((row, n) => [row.id, row.title, refs[n]]);
  const c = keepFull >= rows.length || rows.slice(keepFull).every((row) => row.shown.length <= 1) ? 1 : 0;
  return JSON.stringify({ v: ROWS_FORMAT, c, p, g: [...genreIx.keys()], t: [...typeIx.keys()], i, r });
}

/**
 * The text that fits `budget` keeping the most: every row with every description; every row with
 * the descriptions of at least the items of the first `keepFull` rows (Home's); then only the first
 * `keepFull` rows whole, with as many descriptions as fit; then that without genres. `{ text, step }`,
 * or null when nothing fits. This is the costliest part of a build on a slow TV, so a step is skipped
 * when the ids and titles alone are over the budget, and at most two encodes are made per step: the
 * whole text minus the descriptions dropped from the end says how many fit.
 */
export function fitRows(rows, { budget = TEXT_BUDGET_BYTES, keepFull = Infinity } = {}) {
  const partial = keepFull < rows.length ? keepFull : Infinity;
  // How many items (in first-use order) the first `keepFull` rows use: Home's items.
  const homeItems = collect(rows.slice(0, keepFull), Infinity).items.length;
  const steps = [
    { keepFull: Infinity, genres: true, least: homeItems },
    { keepFull: partial, genres: true, least: 0 },
    { keepFull: partial, genres: false, least: 0 },
  ];
  for (let s = 0; s < steps.length; s++) {
    const { keepFull: kf, genres, least } = steps[s];
    const items = collect(rows, kf).items;
    // A floor of the stored size: each id and title as a quoted string (quotes escaped), and the
    // descriptions the step must keep; nothing else.
    let floor = 0;
    for (let n = 0; n < items.length && floor <= budget; n++) {
      floor += items[n].id.length + items[n].title.length + 9 + (n < least ? items[n].description.length : 0);
    }
    if (floor > budget) continue;
    const whole = encodeRows(rows, { keepFull: kf, genres });
    let size = storedLength(whole);
    if (size <= budget) return { text: whole, step: s };
    let k = items.length;
    while (k > 0 && size > budget) { k--; size -= descCost(items[k].description); }
    if (size > budget || k < least) continue;
    const fitted = encodeRows(rows, { keepFull: kf, genres, descItems: k });
    if (storedLength(fitted) <= budget) return { text: fitted, step: s };
  }
  return null;
}

const isIndexList = (a, n) => Array.isArray(a) && a.every((k) => Number.isInteger(k) && k >= 0 && k < n);

/** `{ rows, complete }` of a stored text, rows as `{ id, title, shown, all: null }`; throws when it is not one. */
export function decodeRows(text) {
  const o = JSON.parse(text);
  if (o === null || typeof o !== "object" || o.v !== ROWS_FORMAT || typeof o.p !== "string" || !Array.isArray(o.g) ||
      !Array.isArray(o.t) || !Array.isArray(o.i) || !Array.isArray(o.r) || (o.c !== 0 && o.c !== 1)) {
    throw new Error("stored rows are malformed");
  }
  const full = (u) => (typeof u === "string" ? o.p + u : null);
  const items = o.i.map((r) => {
    if (!Array.isArray(r) || r.length !== 10 || typeof r[0] !== "string" || typeof o.t[r[5]] !== "string" || !isIndexList(r[6], o.g.length)) {
      throw new Error("stored item is malformed");
    }
    return {
      id: r[0], title: asText(r[1]), poster: full(r[2]), backdrop: full(r[3]), durationS: Number(r[4]) || 0,
      type: o.t[r[5]], genres: r[6].map((g) => asText(o.g[g])), score: typeof r[7] === "number" ? r[7] : null,
      description: asText(r[8]), shelvedAtMs: (Number(r[9]) || 0) * 1000,
    };
  });
  const rows = o.r.map((r) => {
    if (!Array.isArray(r) || typeof r[0] !== "string" || typeof r[1] !== "string" || !isIndexList(r[2], items.length)) {
      throw new Error("stored row is malformed");
    }
    return { id: r[0], title: r[1], shown: r[2].map((k) => items[k]), all: null };
  });
  return { rows, complete: o.c === 1 };
}

/**
 * `text` in consecutive slices of at most `budget` stored bytes each, never splitting a surrogate pair.
 * Each slice is measured whole and shrunk until it fits (a character costs 1 to 6 stored bytes), so a
 * part may be a little under the budget.
 */
export function splitParts(text, budget = PART_BUDGET_BYTES) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let len = Math.min(budget, text.length - start);
    for (;;) {
      let end = start + len;
      const c = text.charCodeAt(end - 1);
      if (end < text.length && c >= 0xd800 && c < 0xdc00) end--;
      const size = storedLength(text.slice(start, end));
      if (size <= budget || end - start <= 1) { len = end - start; break; }
      len = Math.max(1, Math.min(end - start - 1, Math.floor((end - start) * budget / size) - 2));
    }
    parts.push(text.slice(start, start + len));
    start += len;
  }
  return parts.length === 0 ? [""] : parts;
}

// FNV-1a over the UTF-16 units: a torn or mixed snapshot never passes as a whole one.
export function checksum(text) {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) { h ^= text.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/**
 * The snapshot in kino.storage. `read()` → `{ rows, complete, at }` or null (missing, expired, torn or
 * malformed: the caller rebuilds); `write(text, at)` → true when stored. Every key gets `ttlMs`.
 */
export function makeRowsStore({ kino, ttlMs }) {
  const partKey = (n) => `${PART_PREFIX}${n}`;
  const isPartKey = (k) => k.startsWith(PART_PREFIX) && /^\d+$/.test(k.slice(PART_PREFIX.length));

  function read() {
    try {
      const rawMeta = kino.storage.get(META_KEY);
      if (rawMeta === null || rawMeta === undefined) return null;
      const m = JSON.parse(rawMeta);
      if (m === null || typeof m !== "object" || m.v !== ROWS_FORMAT || typeof m.g !== "string" || !Number.isInteger(m.n) ||
          m.n < 1 || m.n > 64 || !Number.isInteger(m.len) || typeof m.h !== "string" || !Number.isFinite(m.at)) return null;
      const tag = m.g + ":";
      let text = "";
      for (let n = 0; n < m.n; n++) {
        const part = kino.storage.get(partKey(n));
        if (typeof part !== "string" || !part.startsWith(tag)) return null;
        text += part.slice(tag.length);
      }
      if (text.length !== m.len || checksum(text) !== m.h) return null;
      const { rows, complete } = decodeRows(text);
      return { rows, complete, at: m.at };
    } catch (_) { return null; }
  }

  // Parts first, the meta last; parts left over from a bigger snapshot and the per-root trees of
  // 2.2.3 and older (`tree:<root>`, up to 80 KB) are removed first so the new parts have the room.
  function write(text, at) {
    const sum = checksum(text);
    const gen = (Math.floor(at) % 2176782336).toString(36) + sum.slice(0, 4);
    const parts = splitParts(text, PART_BUDGET_BYTES - PART_TAG_BYTES);
    let keys = [];
    try { keys = kino.storage.keys(); } catch (_) { /* nothing to clean */ }
    for (const k of keys) {
      if (k === META_KEY || k.startsWith("tree:") || (isPartKey(k) && Number(k.slice(PART_PREFIX.length)) >= parts.length)) {
        try { kino.storage.remove(k); } catch (_) { /* best effort */ }
      }
    }
    try {
      parts.forEach((p, n) => kino.storage.set(partKey(n), `${gen}:${p}`, { ttlMs }));
      kino.storage.set(META_KEY, JSON.stringify({ v: ROWS_FORMAT, g: gen, n: parts.length, len: text.length, h: sum, at }), { ttlMs });
      return true;
    } catch (e) {
      for (let n = 0; n < parts.length; n++) { try { kino.storage.remove(partKey(n)); } catch (_) { /* best effort */ } }
      throw e;
    }
  }

  return { read, write };
}

/**
 * The sections of a root's tree as 2.2.3 and older stored it under `tree:<root>`: `{ v: 1, p: url prefix,
 * i: [[id, title, poster, backdrop, durationS, type, [genre], score, description, shelvedAtMs]],
 * s: [[section name, [item#]]] }`. Throws when the text is not one.
 */
export function decodeLegacyTree(text) {
  const o = JSON.parse(text);
  if (o === null || typeof o !== "object" || o.v !== 1 || typeof o.p !== "string" || !Array.isArray(o.i) || !Array.isArray(o.s)) {
    throw new Error("stored tree is malformed");
  }
  const full = (u) => (typeof u === "string" ? o.p + u : null);
  const items = o.i.map((r) => {
    if (!Array.isArray(r) || typeof r[0] !== "string" || typeof r[5] !== "string" || !Array.isArray(r[6])) throw new Error("stored item is malformed");
    return {
      id: r[0], title: asText(r[1]), poster: full(r[2]), backdrop: full(r[3]), durationS: Number(r[4]) || 0,
      type: r[5], genres: r[6].map(asText), score: typeof r[7] === "number" ? r[7] : null,
      description: asText(r[8]), shelvedAtMs: Number(r[9]) || 0,
    };
  });
  return o.s.map((sec) => {
    if (!Array.isArray(sec) || typeof sec[0] !== "string" || !isIndexList(sec[1], items.length)) throw new Error("stored section is malformed");
    return { name: sec[0], items: sec[1].map((k) => items[k]) };
  });
}
