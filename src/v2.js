// v2.js — the "v2" catalog and matches payloads: pure functions shared by the device and the publisher.
//
// A v2 catalog stores every Kino item once (`items`) and lets each section hold integer indexes into it:
//   { schema: 2, hash, gen, items: [item…], sections: { <name>: { all, home?, slides?, rails, genres } } }
// - `all`    unique item indexes in first-seen order: Kino "Ver más" is `all`, the Home row `all.slice(0, home)`;
// - `home`   18, absent in `adultos` (never on Kino Home);
// - `slides` the own screen's hero (at most 6, none in `adultos`, none whose item is adult anywhere);
// - `rails`  `{ title?, items, ref? }` per portal row, at most 20 indexes each; `ref` = `col:<columnId>` (`:a` in
//            `adultos`), the row's whole portal column for its «Ver más» (recommended mode only);
// - `genres` the 24 most frequent tags (raw values; the screen localizes the chips).
// An optional field is left out, never written as "". `hash` = the first 16 hex characters of sha256 over the
// canonical JSON (the object without `gen` and `hash`, keys in the order the builder writes them).
import { SECTIONS, lang } from "./config.js";
import { toItems, rowList, rowCards, sectionCards } from "./items.js";
import { itemRef, colRef } from "./refs.js";

export const SCHEMA = 2;
export const SECTION_NAMES = SECTIONS.map((s) => s.name);
const ADULT_SECTIONS = new Set(SECTIONS.filter((s) => s.adult).map((s) => s.name));
export const HOME_ITEMS = 18;
export const BROWSE_PAGE = 100;   // Kino's MAX_BROWSE_ITEMS
const MAX_SLIDES = 6;
const RAIL_CAP = 20;
const GENRES_TOP = 24;
const SLIDE_TEXT = 160;
const HTTP = /^https?:\/\//;
const HTTPS = /^https:\/\//;
const ID_RX = /^[A-Za-z0-9._~-]{1,128}$/;
const HASH_RX = /^[0-9a-f]{16}$/;
const COLUMN_ID_RX = /^[1-9]\d{0,11}$/;             // a portal column id (the backend's column_id is an int)
const COL_REF_RX = /^col:[1-9]\d{0,11}(:a)?$/;      // a rail's «Ver más» (src/refs.js colRef)

// ── builders (moved from screenView.js; legacy mode = byte-for-byte what 1.0.43 drew) ──

/** The wide hero image of a slider card: stage|land|banner|horizontal|backdrop|still, else the first image. */
export function heroImage(posterList, httpsOnly = false) {
  if (!Array.isArray(posterList)) return null;
  const withUrl = posterList.filter((p) => p && p.fileUrl && (httpsOnly ? HTTPS : HTTP).test(p.fileUrl));
  const wide = withUrl.find((p) => /stage|land|banner|horizontal|backdrop|still/i.test(p.fileType || ""));
  const chosen = wide || withUrl[0];
  return chosen ? chosen.fileUrl : null;
}

/**
 * Slider cards → hero slides `{ id, ref, kind, title, image, text }` (1.0.43 shape: `text` may be "").
 * `clean` (the recommended mode): a card Kino's limits would refuse (an id outside its pattern, an image URL over
 * 2,048 characters) is skipped, so the next card takes its place, and the title is trimmed and capped (a blank one
 * becomes "—").
 */
export function slidesOf(sliderCards, httpsOnly = false, clean = false) {
  const out = [], seen = new Set();
  for (const c of sliderCards || []) {
    if (out.length >= MAX_SLIDES) break;
    if (!c || !c.contentId || seen.has(String(c.contentId))) continue;
    if (clean && !ID_RX.test(String(c.contentId))) continue;
    const image = heroImage(c.posterList, httpsOnly);
    if (!image || (clean && image.length > 2048)) continue;
    seen.add(String(c.contentId));
    const type = String(c.type == null ? "" : c.type);
    const text = (typeof c.description === "string" ? c.description.trim() : "");
    out.push({
      id: String(c.contentId), ref: itemRef(c.contentId, type), kind: type === "0" ? "series" : "movie",
      title: clean ? (String(c.name || "").trim().slice(0, 200) || "—") : String(c.name || "—"), image,
      text: text.length > SLIDE_TEXT ? `${text.slice(0, SLIDE_TEXT - 1).trimEnd()}…` : text,
    });
  }
  return out;
}

/**
 * Portal rows → `[{ title, items, columnId? }]` (rows without items are skipped; `title` "" when the row has no name).
 * `columnId`: the row's portal column when it has a usable one (a positive integer), whose whole content is its «Ver más»:
 * a row carries only the portal's first 10 titles.
 */
export function railsOf(rows, adult = false, opts) {
  const out = [];
  for (const r of rowList(rows)) {
    const items = toItems(rowCards(r), adult, opts).slice(0, RAIL_CAP);
    if (!items.length) continue;
    const rail = { title: String((r && (r.name || r.title || r.columnName)) || ""), items };
    const col = r && r.columnId != null ? String(r.columnId) : "";
    if (COLUMN_ID_RX.test(col)) rail.columnId = col;
    out.push(rail);
  }
  return out;
}

/** The most frequent tags of a section's items (stable for ties), for the genre filter. */
export function genresOf(items) {
  const m = new Map();
  for (const it of items) for (const g of (it.genres || [])) m.set(g, (m.get(g) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, GENRES_TOP).map((e) => e[0]);
}

/**
 * Legacy Release `home.json` ({sections:{<name>:{slider, rows}}}) → v2 body `{ schema, items, sections }`
 * (no `hash`/`gen`: see `seal`). `opts.poster`: "recommended" (default) or "legacy" (1.0.43's posters).
 */
export function fromLegacyHome(legacy, opts) {
  const poster = opts && opts.poster === "legacy" ? "legacy" : "recommended";
  const rec = poster === "recommended";
  const itemOpts = { poster };
  const items = [], index = new Map();
  const idx = (it) => {
    let i = index.get(it.id);
    if (i === undefined) { i = items.length; index.set(it.id, i); items.push(it); }
    else if (it.adult && !items[i].adult) items[i].adult = true;   // adult is OR-ed across sections
    return i;
  };
  const built = [];
  const src = (legacy && legacy.sections) || {};
  for (const name of SECTION_NAMES) {
    const s = src[name];
    if (!s || typeof s !== "object") continue;
    const adult = ADULT_SECTIONS.has(name);
    const all = toItems(sectionCards(s.rows), adult, itemOpts);
    const sec = { all: all.map(idx) };
    if (!adult) sec.home = HOME_ITEMS;
    // Recommended mode cleans what Kino's limits would refuse per card and slide (src/items.js `toItem`, `slidesOf`
    // `clean`) and caps rail titles, so one bad card is left out (as Kino would drop it) instead of failing the whole
    // catalog's validation. Legacy mode stays byte-for-byte 1.0.43.
    const slides = adult ? [] : slidesOf(s.slider, rec, rec).map((x) => { const y = { ...x }; if (!y.text) delete y.text; return y; });
    sec.slides = slides;
    const railTitle = (t) => (rec ? t.slice(0, 200) : t);
    sec.rails = railsOf(s.rows, adult, itemOpts).map((r) => {
      const rail = r.title ? { title: railTitle(r.title), items: r.items.map(idx) } : { items: r.items.map(idx) };
      // «Ver más» pages the row's whole portal column (src/catalog.js browse); legacy mode stays 1.0.43's shape.
      if (rec && r.columnId) rail.ref = colRef(r.columnId, adult);
      return rail;
    });
    sec.genres = genresOf(all);
    built.push([name, sec]);
  }
  // A hero slide is never gated by Kino: drop any slide whose title is adult in any section.
  const adultIds = new Set(items.filter((it) => it.adult).map((it) => it.id));
  const sections = {};
  for (const [name, sec] of built) {
    const slides = sec.slides.filter((x) => !adultIds.has(x.id));
    const out = { all: sec.all };
    if (sec.home !== undefined) out.home = sec.home;
    if (slides.length) out.slides = slides;
    out.rails = sec.rails;
    out.genres = sec.genres;
    sections[name] = out;
  }
  return { schema: SCHEMA, items, sections };
}

const teamObj = (t) => (t && typeof t === "object" ? t : null);

/** Legacy `matches.json` → v2 body `{ schema, matches }`. gameState/score/channelCode/matchLogo are dropped. */
export function fromLegacyMatches(legacy) {
  const out = [];
  for (const x of (legacy && legacy.matches) || []) {
    if (!x || typeof x !== "object") continue;
    const y = {};
    if (x.matchName) y.league = String(x.matchName);
    if (x.gameTime) y.time = String(x.gameTime);
    const a = teamObj(x.team_a), b = teamObj(x.team_b);
    if (a && b) {
      y.a = team(a);
      y.b = team(b);
    } else {
      const t = String(x.gameName || "").trim().slice(0, 80);
      if (t) y.title = t;
    }
    if (x.channelName) y.ch = String(x.channelName);
    out.push(y);
  }
  return { schema: SCHEMA, matches: out };
}

function team(o) {
  const t = { n: String(o.teamName || o.teamAlias || "?") };
  if (HTTPS.test(o.teamLogo || "")) t.l = String(o.teamLogo);
  return t;
}

// ── hash and seal ──

/** The canonical text that `hash` covers: the object without `gen` and `hash`. */
export function canonicalText(obj) {
  const rest = {};
  for (const k of Object.keys(obj || {})) if (k !== "gen" && k !== "hash") rest[k] = obj[k];
  return JSON.stringify(rest);
}

/** First 16 hex characters of sha256(canonicalText). `sha256(text) → hex` is injected (kino.crypto / node:crypto). */
export function canonicalHash(obj, sha256) {
  return String(sha256(canonicalText(obj))).toLowerCase().slice(0, 16);
}

/** body → `{ schema, hash, gen?, …rest }` in the published key order. */
export function seal(body, gen, sha256) {
  const out = { schema: body.schema, hash: canonicalHash(body, sha256) };
  if (Number.isFinite(gen) && gen > 0) out.gen = gen;
  for (const k of Object.keys(body)) if (k !== "schema" && k !== "hash" && k !== "gen") out[k] = body[k];
  return out;
}

// ── validation (Kino's limits; a payload that fails is never stored) ──

function emptyStrings(v, path, bad) {
  if (v === "") { bad("empty string at " + path); return; }
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) emptyStrings(v[i], path + "[" + i + "]", bad); return; }
  if (v && typeof v === "object") for (const k of Object.keys(v)) emptyStrings(v[k], path + "." + k, bad);
}

const isIdx = (n, len) => Number.isInteger(n) && n >= 0 && n < len;
const httpsUrl = (u) => typeof u === "string" && HTTPS.test(u) && u.length <= 2048;

/** → [] when the catalog is valid, else a list of problems (at most 20). */
export function validateCatalog(v2) {
  const errs = [];
  const bad = (m) => { if (errs.length < 20) errs.push(m); };
  if (!v2 || typeof v2 !== "object") return ["not an object"];
  if (v2.schema !== SCHEMA) bad("schema is not 2");
  if (v2.hash !== undefined && !HASH_RX.test(String(v2.hash))) bad("hash is not 16 hex");
  if (!Array.isArray(v2.items)) { bad("items is not an array"); return errs; }
  if (!v2.sections || typeof v2.sections !== "object") { bad("sections is not an object"); return errs; }
  emptyStrings(v2, "$", bad);
  const n = v2.items.length;
  const ids = new Set();
  const adultIds = new Set();
  v2.items.forEach((it, i) => {
    const at = "items[" + i + "]";
    if (!it || typeof it !== "object") { bad(at + " is not an object"); return; }
    if (typeof it.id !== "string" || !ID_RX.test(it.id)) bad(at + ".id");
    else if (ids.has(it.id)) bad(at + ".id duplicated");
    else ids.add(it.id);
    if (typeof it.ref !== "string" || !it.ref || it.ref.length > 4096) bad(at + ".ref");
    if (typeof it.title !== "string" || !it.title.trim() || it.title.length > 200) bad(at + ".title");
    if (it.kind !== "movie" && it.kind !== "series") bad(at + ".kind");
    if (it.poster !== undefined && !httpsUrl(it.poster)) bad(at + ".poster is not https");
    if (it.backdrop !== undefined && !httpsUrl(it.backdrop)) bad(at + ".backdrop is not https");
    if (it.overview !== undefined && (typeof it.overview !== "string" || it.overview.length > 2000)) bad(at + ".overview");
    if (it.rating !== undefined && !(typeof it.rating === "number" && it.rating > 0 && it.rating <= 10)) bad(at + ".rating");
    if (it.genres !== undefined && !(Array.isArray(it.genres) && it.genres.length <= 5 && it.genres.every((g) => typeof g === "string"))) bad(at + ".genres");
    if (it.runtimeMinutes !== undefined && !(Number.isInteger(it.runtimeMinutes) && it.runtimeMinutes >= 1 && it.runtimeMinutes <= 1000)) bad(at + ".runtimeMinutes");
    if (it.adult !== undefined && it.adult !== true) bad(at + ".adult");
    if (it.adult === true && typeof it.id === "string") adultIds.add(it.id);
  });
  let homeRows = 0;
  for (const name of Object.keys(v2.sections)) {
    const s = v2.sections[name];
    const at = "sections." + name;
    if (!SECTION_NAMES.includes(name)) { bad(at + " is unknown"); continue; }
    if (!s || typeof s !== "object") { bad(at + " is not an object"); continue; }
    const adult = ADULT_SECTIONS.has(name);
    if (!Array.isArray(s.all) || !s.all.every((x) => isIdx(x, n))) bad(at + ".all");
    else if (new Set(s.all).size !== s.all.length) bad(at + ".all has duplicates");
    else if (adult) {
      // every title of an adult section is gated by Kino only when it carries the flag
      const i = s.all.find((x) => !v2.items[x] || v2.items[x].adult !== true);
      if (i !== undefined) bad(at + ": item " + (v2.items[i] && v2.items[i].id) + " is in " + name + " but not adult");
    }
    if (adult && s.home !== undefined) bad(at + ".home on an adult section");
    if (!adult && s.home !== undefined && !(Number.isInteger(s.home) && s.home >= 1 && s.home <= 60)) bad(at + ".home");
    if (!adult && Number.isInteger(s.home) && Array.isArray(s.all) && s.all.length) homeRows++;
    if (s.slides !== undefined) {
      if (!Array.isArray(s.slides) || s.slides.length > MAX_SLIDES) bad(at + ".slides");
      else {
        if (adult && s.slides.length) bad(at + ".slides on an adult section");
        s.slides.forEach((x, i) => {
          const sa = at + ".slides[" + i + "]";
          if (!x || typeof x !== "object") { bad(sa); return; }
          if (typeof x.id !== "string" || !ID_RX.test(x.id)) bad(sa + ".id");
          if (adultIds.has(x.id)) bad(sa + " is an adult title");
          if (typeof x.ref !== "string" || !x.ref) bad(sa + ".ref");
          if (x.kind !== "movie" && x.kind !== "series") bad(sa + ".kind");
          if (typeof x.title !== "string" || !x.title.trim()) bad(sa + ".title");
          if (!httpsUrl(x.image)) bad(sa + ".image is not https");
          if (x.text !== undefined && (typeof x.text !== "string" || x.text.length > SLIDE_TEXT)) bad(sa + ".text");
        });
      }
    }
    if (!Array.isArray(s.rails)) bad(at + ".rails");
    else s.rails.forEach((r, i) => {
      if (!r || !Array.isArray(r.items) || r.items.length > RAIL_CAP || !r.items.every((x) => isIdx(x, n))) bad(at + ".rails[" + i + "]");
      if (r && r.title !== undefined && (typeof r.title !== "string" || r.title.length > 200)) bad(at + ".rails[" + i + "].title");
      // a rail's «Ver más»: a portal column, flagged 18+ exactly when the section is (an adult column unflagged would
      // page its titles past Kino's parental lock)
      if (r && r.ref !== undefined && (typeof r.ref !== "string" || !COL_REF_RX.test(r.ref) || r.ref.endsWith(":a") !== adult)) bad(at + ".rails[" + i + "].ref");
    });
    if (!Array.isArray(s.genres) || s.genres.length > GENRES_TOP || !s.genres.every((g) => typeof g === "string")) bad(at + ".genres");
  }
  if (!homeRows) bad("no section has a Home row");
  return errs;
}

/** → [] when the matches payload is valid, else a list of problems (at most 20). */
export function validateMatches(m2) {
  const errs = [];
  const bad = (m) => { if (errs.length < 20) errs.push(m); };
  if (!m2 || typeof m2 !== "object") return ["not an object"];
  if (m2.schema !== SCHEMA) bad("schema is not 2");
  if (m2.hash !== undefined && !HASH_RX.test(String(m2.hash))) bad("hash is not 16 hex");
  if (!Array.isArray(m2.matches)) { bad("matches is not an array"); return errs; }
  emptyStrings(m2, "$", bad);
  m2.matches.forEach((m, i) => {
    const at = "matches[" + i + "]";
    if (!m || typeof m !== "object") { bad(at); return; }
    for (const side of ["a", "b"]) {
      const t = m[side];
      if (t === undefined) continue;
      if (!t || typeof t.n !== "string") bad(at + "." + side);
      else if (t.l !== undefined && !httpsUrl(t.l)) bad(at + "." + side + ".l is not https");
    }
    if (m.kickoff !== undefined && !Number.isFinite(m.kickoff)) bad(at + ".kickoff");
  });
  return errs;
}

// ── joins (what home(), browse() and the screen read) ──

const _byId = new WeakMap();

/** The item with that id, or null. */
export function itemById(v2, id) {
  if (!v2 || !Array.isArray(v2.items)) return null;
  let m = _byId.get(v2);
  if (!m) {
    m = new Map();
    v2.items.forEach((it, i) => { if (it && it.id != null) m.set(String(it.id), i); });
    _byId.set(v2, m);
  }
  const i = m.get(String(id == null ? "" : id));
  return i === undefined ? null : v2.items[i];
}

const at = (v2, i) => v2.items[i];

/** Kino Home rows: one per non-adult section with items, `all.slice(0, home)`. */
export function homeRows(v2) {
  const out = [];
  if (!v2 || !v2.sections) return out;
  const en = lang() === "en";
  for (const sec of SECTIONS) {
    if (sec.adult) continue;
    const s = v2.sections[sec.name];
    if (!s || !s.home || !Array.isArray(s.all) || !s.all.length) continue;
    const items = s.all.slice(0, s.home).map((i) => at(v2, i)).filter(Boolean);
    if (!items.length) continue;
    out.push({ id: `sec-${sec.name}`, title: en ? sec.titleEn : sec.title, items, ref: `cat:${sec.name}`, genre: sec.genre });
  }
  return out;
}

/** One section as the screen draws it: `{ slides, rails: [{ title?, items, ref? }], genres, all }`, or null. */
export function sectionView(v2, name) {
  const s = v2 && v2.sections && v2.sections[name];
  if (!s) return null;
  const items = (ids) => (ids || []).map((i) => at(v2, i)).filter(Boolean);
  return {
    slides: (s.slides || []).map((x) => ({ ...x })),
    rails: (s.rails || []).map((r) => {
      const rail = r.title ? { title: r.title, items: items(r.items) } : { items: items(r.items) };
      if (r.ref) rail.ref = r.ref;
      return rail;
    }),
    genres: (s.genres || []).slice(),
    all: items(s.all),
  };
}

const MAX_CATEGORY_TITLE = 40;   // the contract's output.categories.maxTitleChars

/**
 * Kino's Categorías tiles: one per section with items, in menu order, `ref` its `cat:` "Ver más" (browse pages it),
 * `art` its first item's backdrop, else its poster. The 18+ section's tile is `adult` (Kino shows it only while the 18+
 * lock is open) and has no picture.
 */
export function categoryTiles(v2) {
  const out = [];
  if (!v2 || !v2.sections) return out;
  const en = lang() === "en";
  for (const sec of SECTIONS) {
    const s = v2.sections[sec.name];
    if (!s || !Array.isArray(s.all) || !s.all.length) continue;
    const tile = { id: `sec-${sec.name}`, title: (en ? sec.titleEn : sec.title).slice(0, MAX_CATEGORY_TITLE), ref: `cat:${sec.name}` };
    if (sec.adult) tile.adult = true;
    else {
      const first = s.all.map((i) => at(v2, i)).find(Boolean);
      const art = first && (first.backdrop || first.poster);
      if (art) tile.art = art;
    }
    out.push(tile);
  }
  return out;
}

/** "Ver más" for a section: pages of `size` (Kino's maximum is 100); `cursor` is the page number as text. */
export function browsePage(v2, name, cursor, size = BROWSE_PAGE) {
  const s = v2 && v2.sections && v2.sections[name];
  if (!s || !Array.isArray(s.all)) return { items: [], next: null };
  const page = Math.max(1, parseInt(cursor || "1", 10) || 1);
  const start = (page - 1) * size;
  const items = s.all.slice(start, start + size).map((i) => at(v2, i)).filter(Boolean);
  return { items, next: start + size < s.all.length ? String(page + 1) : null };
}

// ── matches: time window ──

export const LIVE_BEFORE_MS = 5 * 60 * 1000;
export const LIVE_AFTER_MS = 130 * 60 * 1000;
export const HIDE_AFTER_MS = 3 * 3600 * 1000;

/**
 * The portal's `gameTime` "YYYY-MM-DD HH:MM" → epoch ms (NaN when it does not parse). It is UTC: every match of the
 * published matches.json lines up with its real kickoff only in UTC (Nations League 19:45 = the 20:45 CET slot,
 * Canada–Guatemala 01:00 = 20:00 ET, Uruguay 23:00 = 20:00 UYT, Liga 1 Perú 18:00 = 13:00 PET, Russia–Venezuela
 * 16:00 = 19:00 MSK), and the publisher sends the portal no time zone. Reading it as device-local time put "EN VIVO"
 * hours off and hid matches before they ended.
 */
export function parseUtcTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ""));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** The kickoff of a v2 match (epoch ms): `kickoff` when present, else its `time` read as UTC. */
export function matchStart(m) {
  if (m && Number.isFinite(m.kickoff)) return m.kickoff;
  return parseUtcTime(m && m.time);
}

/** "EN VIVO" comes from the time window [kickoff − 5 min, kickoff + 130 min]: the payload carries no live state. */
export function isLiveMatch(m, now = Date.now()) {
  const t = matchStart(m);
  return Number.isFinite(t) && now >= t - LIVE_BEFORE_MS && now <= t + LIVE_AFTER_MS;
}

/** Matches still worth showing: those whose kickoff is unknown or less than 3 h ago. */
export function visibleMatches(list, now = Date.now()) {
  return (list || []).filter((m) => { const t = matchStart(m); return !Number.isFinite(t) || t + HIDE_AFTER_MS >= now; });
}
