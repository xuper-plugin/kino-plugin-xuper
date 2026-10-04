// The one mapping between a portal channel code and what Kino sees (id + ref) of a live channel.
// A code that already is a valid SDK id (and does not start with "~" or "x.") is its own id and its
// own ref, so favourites and recents saved before this mapping keep working. Any other code becomes:
//   id  "x.b" + base64url(UTF-8 code)           when that fits 128 characters (reversible),
//       "x.h" + 32 hex of a deterministic hash  otherwise (the raw code then lives only in the ref);
//   ref "xlive1:" + the raw code                (resolve, rotation and the portal use the raw code).
// Valid codes never start with "x.", and codes that do are encoded, so the namespaces cannot clash.
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const REF_PREFIX = "xlive1:";
const MAX_CODE_CHARS = 2000; // the ref is capped at 4096 by the SDK; beyond this the code is dropped
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const isValidId = (s) => typeof s === "string" && ID.test(s);
const plainCode = (code) => ID.test(code) && !code.startsWith("~") && !code.startsWith("x.");

function b64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

function unb64url(text) {
  const bytes = [];
  let acc = 0;
  let bits = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
  }
  return new Uint8Array(bytes);
}

// Four independent 32-bit FNV-1a style lanes: deterministic, no dependency; 128 bits.
function hash128(s) {
  const lanes = [0x811c9dc5, 0x01000193 ^ 0x9e3779b9, 0xdeadbeef, 0x41c6ce57];
  const mul = [16777619, 2246822519, 3266489917, 668265263];
  for (const b of new TextEncoder().encode(s)) {
    for (let i = 0; i < 4; i++) {
      lanes[i] = Math.imul(lanes[i] ^ (b + i), mul[i]);
      lanes[i] ^= lanes[(i + 1) % 4] >>> 13;
    }
  }
  return lanes.map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

/** `{ id, ref }` of a portal channel code, or null when it cannot be given one (blank or absurdly long). */
export function channelOf(code) {
  if (typeof code !== "string" || code.trim() === "" || code.length > MAX_CODE_CHARS) return null;
  if (plainCode(code)) return { id: code, ref: code };
  const body = b64url(new TextEncoder().encode(code));
  const id = ("x.b" + body).length <= 128 ? "x.b" + body : "x.h" + hash128(code);
  return { id, ref: REF_PREFIX + code };
}

/** The id Kino keeps for a raw portal code (what `migrate` answers), or null. */
export const idOfCode = (code) => channelOf(code)?.id ?? null;

/** True when [ref] is the ref of an odd-code channel (a plain one is a bare valid code). */
export const isWrappedRef = (ref) => typeof ref === "string" && ref.startsWith(REF_PREFIX) && ref.length > REF_PREFIX.length && ref.length <= 4096;

/** The raw portal code behind a live ref (bare or wrapped). */
export const codeOfRef = (ref) => (isWrappedRef(ref) ? ref.slice(REF_PREFIX.length) : ref);

/** The raw code behind a reversible id ("x.b..."), null for any other id (plain ids are their own code). */
export function codeOfId(id) {
  if (typeof id !== "string") return null;
  if (!id.startsWith("x.b")) return id.startsWith("x.") ? null : id;
  const bytes = unb64url(id.slice(3));
  if (!bytes) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (_) { return null; }
}
