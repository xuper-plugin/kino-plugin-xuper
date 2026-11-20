// legacy.js — what Xuper 2.x left in Kino, read by this version. Pure: no `kino`, no network, no storage.
//
// The update keeps the plugin id, so Kino hands this code every value 2.x gave it:
//   - library rows («Continuar viendo», history, Mis listas, downloads): `magis1:<programType>:<episode>:<contentId>`
//     (contentId last: it may hold ':'), a chapter as `magis1:teleplay:<seriesNumber>:<seasonContentId>`, and rows from
//     before the plugin existed in the gateway form `base64url(json).<hmac>` with json {"s":"magis","p":{content_id,
//     program_type,episode}} (the signature and its 24 h expiry are ignored on purpose: nothing to check them with);
//   - live favourites and recents: the bare portal channel code, or `xlive1:<code>` for a code Kino could not use as an id.
// Those ids are masnew's (the portal behind src/sources/xuper.js), not the catalog's (MagisPro): they never match a
// `v:` item, so they are played and listed on masnew, as 2.x did (src/catalog.js).
// `migrate` claims what Kino saved while Xuper was native, as 2.x's did, in these same terms.

export const MAGIS_PREFIX = "magis1";
const LIVE_PREFIX = "xlive1:";
/** The program types the portal serves by chapters. */
const SERIES = new Set(["teleplay", "series", "variety"]);
const INT = /^[+-]?\d+$/;
/** A bare live channel code: Kino's item id pattern, as 2.x's liveChannels handed it out. */
const CHANNEL_CODE = /^[A-Za-z0-9._~-]{1,128}$/;
const ITEM_ID = /^[A-Za-z0-9._~-]{1,128}$/;
const MAX_CODE_CHARS = 2000;
const MAX_NUMBER = 99999;   // the contract's maxEpisodeNumber
const MAX_SEASON = 999;     // maxSeasonNumber

const str = (v) => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v));
const blank = (v) => typeof v !== "string" || v.trim() === "";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Kotlin's String.toIntOrNull: optional sign, digits, inside the Int range.
function toIntOrNull(v) {
  const text = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
  if (text === null || !INT.test(text)) return null;
  const n = Number(text);
  return n >= -2147483648 && n <= 2147483647 ? n || 0 : null;
}

const make = (contentId, programType, episode) => ({ contentId, programType, episode, isSeries: SERIES.has(programType) });

/** `{ contentId, programType = "movie", episode = 0 }` as 2.x wrote it. */
export function encodeMagis({ contentId, programType = "movie", episode = 0 }) {
  return `${MAGIS_PREFIX}:${programType || "movie"}:${episode}:${contentId}`;
}

/** A chapter's ref: always the literal `teleplay`, even for variety (2.x's encodeChapter). */
export function encodeChapter(seriesNumber, seasonContentId) {
  return encodeMagis({ contentId: seasonContentId, programType: "teleplay", episode: seriesNumber });
}

// ---- base64url (strict, as java.util.Base64.getUrlDecoder) to a UTF-8 string ----
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlToText(data) {
  const body = data.replace(/={1,2}$/, "");
  if (body.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(body)) return null;
  const bytes = [];
  let acc = 0, bits = 0;
  for (const ch of body) {
    acc = (acc << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); acc &= (1 << bits) - 1; }
  }
  return utf8(bytes);
}

// 2.x's own UTF-8 decoder (no TextDecoder needed): a broken sequence reads as U+FFFD.
function utf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); i++; continue; }
    const need = b >= 0xc2 && b < 0xe0 ? 1 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xf0 && b < 0xf5 ? 3 : 0;
    if (need === 0 || i + need > bytes.length - 1) { out += "�"; i++; continue; }
    let cp = b & (0xff >> (need + 2));
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) { ok = false; break; }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (!ok || cp > 0x10ffff) { out += "�"; i++; continue; }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

// org.json optInt over a parsed value.
function optInt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") { const n = Number(v.trim()); return v.trim() !== "" && Number.isFinite(n) ? Math.trunc(n) : 0; }
  return 0;
}

function fromGatewayRef(ref) {
  const dot = ref.indexOf(".");
  if (dot <= 0) return null;
  const text = base64UrlToText(ref.slice(0, dot));
  let json;
  try { json = text === null ? null : JSON.parse(text); } catch (_) { return null; }
  if (!isObj(json) || str(json.s) !== "magis" || !isObj(json.p)) return null;
  const contentId = str(json.p.content_id);
  if (blank(contentId)) return null;
  return make(contentId, str(json.p.program_type).trim() === "" ? "movie" : str(json.p.program_type), optInt(json.p.episode));
}

/**
 * A 2.x VOD ref of either form → `{ contentId, programType, episode, isSeries }`, or null when it is not one (2.x's
 * refs.decode). Never Kino's own `plg1:` wrapper.
 */
export function decodeMagis(ref) {
  if (typeof ref !== "string" || blank(ref) || ref.startsWith("plg1:")) return null;
  if (ref.startsWith(MAGIS_PREFIX + ":")) {
    const parts = ref.split(":");
    if (parts.length < 4) return null;
    const contentId = parts.slice(3).join(":");
    if (blank(contentId)) return null;
    const type = parts[1];
    return make(contentId, type.trim() === "" ? "movie" : type, toIntOrNull(parts[2]) ?? 0);
  }
  return fromGatewayRef(ref);
}

/**
 * The portal channel code behind a 2.x live ref: `xlive1:<code>`, or a bare code (no ':' — every ref of this version
 * has one — Kino's id pattern, not "~…", not a 2.x VOD ref). Null for anything else.
 */
export function legacyLiveCode(ref) {
  if (typeof ref !== "string") return null;
  if (ref.startsWith(LIVE_PREFIX)) {
    const code = ref.slice(LIVE_PREFIX.length);
    return code.trim() !== "" && code.length <= MAX_CODE_CHARS ? code : null;
  }
  if (!CHANNEL_CODE.test(ref) || ref.startsWith("~") || decodeMagis(ref) !== null) return null;
  return ref;
}

// ---- a season's chapter list (masnew v4/getItemData's assetData) ----

// The most season chips a series shows. Was 50, which cut long-running shows (Survivor is ~47+ seasons and, with the
// portal's specials/other versions in `sameSeasonSeriesList`, can pass 50 → the last seasons became unreachable). 200
// covers any real series and stays cheap (a chip is id/ref/title/number).
export const MAX_SEASON_CHIPS = 200;

/**
 * What a series detail's `sameSeasonSeriesList` says about season `ownId` (2.x's parseSeasonList): `own` is this
 * season's number (null when the list carries seasons but not this one) and `all` every season with a usable id and
 * number, ordered by number. A missing or EMPTY list is a single-season series: `own` is then 1.
 */
export function parseSeasonList(list, ownId) {
  let own = null;
  const all = [];
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) {
    if (!isObj(entry)) continue;
    const id = typeof entry.contentId === "string" ? entry.contentId : typeof entry.contentId === "number" ? String(entry.contentId) : "";
    const number = toIntOrNull(entry.seasonNumber);
    if (id === ownId) own = number;
    if (id.trim() !== "" && number !== null) all.push({ id, number });
  }
  if (own === null && entries.length === 0) own = 1;
  all.sort((a, b) => a.number - b.number);
  return { own, all };
}

/**
 * masnew's `assetData` of season `seriesId` → `{ items: [{ seriesNumber (raw text or null), contentId, name }], season
 * (null = unknown), seasons: [{ id, number }] }` (2.x's portalChapters, without its cache and TMDB).
 */
export function chaptersOf(assetData, seriesId) {
  const d = isObj(assetData) ? assetData : {};
  const items = (Array.isArray(d.simpleProgramList) ? d.simpleProgramList : []).filter(isObj).map((it) => ({
    seriesNumber: typeof it.seriesNumber === "string" ? it.seriesNumber : typeof it.seriesNumber === "number" ? String(it.seriesNumber) : null,
    contentId: typeof it.contentId === "string" ? it.contentId : typeof it.contentId === "number" ? String(it.contentId) : "",
    name: typeof it.name === "string" ? it.name : "",
  }));
  const seasons = parseSeasonList(d.sameSeasonSeriesList, seriesId);
  return { items, season: seasons.own, seasons: seasons.all };
}

/** The chapter whose seriesNumber is `episode` (trimmed); `episode` <= 0 is the first (2.x's findChapter). */
export function findChapter(items, episode) {
  if (!Array.isArray(items) || !items.length) return undefined;
  if (!(episode > 0)) return items[0];
  return items.find((it) => typeof it.seriesNumber === "string" && it.seriesNumber.trim() === String(episode));
}

// A chapter name that only numbers the chapter (accents and case ignored): blank, digits, "Capítulo 3", "Episodio 3",
// "Cap. 3", "Ep 3", "Chapter 3", "E03"; and the portal's usual "<series>_<that>" ("One Piece T1_8") or
// "<series>_<series>-01". 2.x shows "Capítulo N" for those that carry a "_".
const GENERIC_TITLE = /^(?:(?:capitulo|episodio|chapter|episode|cap|ep|e)\.?\s*#?\s*)?\d*$/;
const TRAILING_NUMBER = /[\s._-]*\d+$/;
const plainTitle = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/\s+/g, " ").trim();
function isGenericTitle(s) {
  if (typeof s !== "string") return true;
  const t = plainTitle(s);
  if (GENERIC_TITLE.test(t)) return true;
  const cut = t.lastIndexOf("_");
  if (cut < 0) return false;
  const series = t.slice(0, cut).trim();
  const rest = t.slice(cut + 1).trim();
  return GENERIC_TITLE.test(rest) || (TRAILING_NUMBER.test(rest) && rest.replace(TRAILING_NUMBER, "").trim() === series);
}

/**
 * Kino's `episodes` answer for 2.x series ref `m` from its chapter list `raw` (`chaptersOf`), numbered exactly as 2.x
 * numbered them: Kino keys a chapter's progress by its season and number (`::e<n>`, `::t<s>e<n>`), so the chapters a
 * person watched under 2.x keep their progress. `english`: the visible language.
 */
export function episodesAnswer(m, raw, english) {
  const chapterN = (n) => (english ? "Episode " : "Capítulo ") + n;
  const seasonN = (n) => (english ? "Season " : "Temporada ") + n;
  const episodes = raw.items.slice(0, 5000).map((it) => {
    const number = toIntOrNull(it.seriesNumber) ?? 0;
    const numbered = number > 0 && it.name.includes("_") && isGenericTitle(it.name);
    const ep = { number, title: it.name.trim() !== "" && !numbered ? it.name : chapterN(number), ref: encodeChapter(number, m.contentId) };
    if (raw.season !== null) ep.season = raw.season;
    return ep;
  });
  const out = { episodes };
  if (raw.seasons.length > 0) {
    out.seasons = raw.seasons.slice(0, MAX_SEASON_CHIPS).map((s) => ({
      id: s.id,
      // A season is a portal title of the same kind: its ref is what 2.x's search gave it.
      ref: encodeMagis({ contentId: s.id, programType: m.programType, episode: 0 }),
      title: seasonN(s.number),
      number: s.number,
      current: s.id === m.contentId,
    }));
  }
  return out;
}

// ---- migrate (capability "migrate"): what Kino saved while Xuper was native ----

/** The provider keys Kino files native Xuper live favourites and recents under ("legacy" from Kino 0.9.50 on). */
const LIVE_PROVIDERS = new Set(["xuper", "legacy"]);
const whole = (v, max) => (Number.isInteger(v) && v >= 1 && v <= max ? v : null);

function migrateTitle(input) {
  const m = decodeMagis(input.ref);
  if (!m || !ITEM_ID.test(m.contentId)) return null;
  // The ref 2.x's search gave the title: the chapter number is not part of a title.
  return { kind: m.isSeries ? "series" : "movie", id: m.contentId, ref: encodeMagis({ contentId: m.contentId, programType: m.programType, episode: 0 }) };
}

function migrateChapter(input) {
  const m = decodeMagis(input.ref);
  if (!m || !ITEM_ID.test(m.contentId)) return null;
  // The number the ref carries is what resolve looks the chapter up by, so it wins; a ref that says "first chapter"
  // (<= 0) takes the number Kino saved next to it, else 1 (resolve reads "no chapter" as the first one).
  const number = whole(m.episode, MAX_NUMBER) ?? whole(input.episode, MAX_NUMBER) ?? 1;
  const out = { kind: "episode", ref: encodeChapter(number, m.contentId), number };
  const season = whole(input.season, MAX_SEASON);
  if (season !== null) out.season = season;
  return out;
}

function migrateLive(input, liveIdOf) {
  if (!LIVE_PROVIDERS.has(input.provider) || typeof input.code !== "string") return null;
  const code = input.code;
  if (code.trim() === "" || code.length > MAX_CODE_CHARS) return null;
  const id = liveIdOf(code);
  return typeof id === "string" && ITEM_ID.test(id) ? { kind: "live", code: id } : null;
}

/**
 * Kino's `migrate(input)`: this plugin's answer for a value Kino saved, or null when it is not Xuper's. Never throws.
 * `liveIdOf(code)`: the id this version's liveChannels gives a masnew channel code (src/catalog.js passes it).
 */
export function migrate(input, liveIdOf) {
  try {
    if (!isObj(input)) return null;
    if (input.kind === "title") return migrateTitle(input);
    if (input.kind === "chapter") return migrateChapter(input);
    if (input.kind === "live") return migrateLive(input, liveIdOf);
    return null;
  } catch (_) {
    return null;
  }
}
