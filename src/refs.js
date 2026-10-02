// Content refs, ported from the native MagisRef (native-magis.md §7).
//   own form:    magis1:<programType>:<episode>:<contentId>   (contentId last: it may hold ':')
//   legacy form: base64url(json).<hmac>, json {"s":"magis","p":{content_id,program_type,episode}};
//                the signature and the 24 h expiry are ignored on purpose (nothing to check them with).

export const PREFIX = "magis1";
/** The types the portal serves by chapters. */
export const SERIES = new Set(["teleplay", "series", "variety"]);
export const isSeries = (programType) => SERIES.has(programType);

const blank = (s) => typeof s !== "string" || s.trim() === "";
const INT = /^[+-]?\d+$/;

// Kotlin's String.toIntOrNull: optional sign, digits, inside the Int range.
function toIntOrNull(text) {
  if (!INT.test(text)) return null;
  const n = Number(text);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}

const make = (contentId, programType, episode) =>
  ({ contentId, programType, episode, isSeries: isSeries(programType) });

/** `{ contentId, programType = "movie", episode = 0 }` as the string the app stores. */
export function encode({ contentId, programType = "movie", episode = 0 }) {
  return `${PREFIX}:${programType || "movie"}:${episode}:${contentId}`;
}

/** An episode (chapter) ref: always the literal `teleplay`, even for variety (native-magis §7). */
export function encodeChapter(seriesNumber, seasonContentId) {
  return encode({ contentId: seasonContentId, programType: "teleplay", episode: seriesNumber });
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

function utf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); i++; continue; }
    const need = b >= 0xc2 && b < 0xe0 ? 1 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xf0 && b < 0xf5 ? 3 : 0;
    if (need === 0 || i + need > bytes.length - 1) { out += "\ufffd"; i++; continue; }
    let cp = b & (0xff >> (need + 2));
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) { ok = false; break; }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (!ok || cp > 0x10ffff) { out += "\ufffd"; i++; continue; }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

// org.json optString / optInt over a parsed value.
const optString = (v) => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v));
function optInt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") { const n = Number(v.trim()); return v.trim() !== "" && Number.isFinite(n) ? Math.trunc(n) : 0; }
  return 0;
}

function fromGatewayRef(ref) {
  const dot = ref.indexOf(".");
  if (dot < 0) return null; // substringBefore('.') == ref
  const data = ref.slice(0, dot);
  if (blank(data)) return null;
  let json;
  try {
    const text = base64UrlToText(data);
    json = text === null ? null : JSON.parse(text);
  } catch (_) { return null; }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  if (optString(json.s) !== "magis") return null;
  const p = json.p;
  if (p === null || typeof p !== "object" || Array.isArray(p)) return null;
  const contentId = optString(p.content_id);
  if (blank(contentId)) return null;
  return make(contentId, optString(p.program_type).trim() === "" ? "movie" : optString(p.program_type), optInt(p.episode));
}

/** A Magis ref of its own or a legacy one, or null when it is not Magis's or unreadable. */
export function decode(ref) {
  if (typeof ref !== "string" || blank(ref)) return null;
  if (ref.startsWith(PREFIX + ":")) {
    const parts = ref.split(":");
    if (parts.length < 4) return null;
    const contentId = parts.slice(3).join(":");
    if (blank(contentId)) return null;
    const type = parts[1];
    return make(contentId, type.trim() === "" ? "movie" : type, toIntOrNull(parts[2]) ?? 0);
  }
  return fromGatewayRef(ref);
}

// What liveChannels hands out as a channel's ref: the bare channelCode (liveCatalog.js).
const CHANNEL_CODE = /^[A-Za-z0-9._~-]{1,128}$/;

/** A bare live channel code, not a VOD ref of either form (resolve routes it to live). */
export function isChannelRef(ref) {
  return typeof ref === "string" && CHANNEL_CODE.test(ref) && !ref.startsWith("~") && decode(ref) === null;
}
