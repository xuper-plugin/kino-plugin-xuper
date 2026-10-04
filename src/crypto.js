// Body crypto for the portal: UTF-8 JSON -> 3DES-EDE/ECB/PKCS5 -> padded base64 -> the ASCII
// bytes of that base64 -> lowercase hex. The key is the typed secret `magisKey`; it never
// enters this code, only its marker does.
const toHex = (s) =>
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

// The wire is decoded in pieces of this many hex digits: even, and no longer than what the app's
// QuickJS can run a regular expression over without its backtrack state filling the 64 MB sandbox.
const HEX_CHUNK = 65_536;
const NOT_LOWER_HEX = /[^0-9a-f]/;
const NOT_ASCII = /[^\x00-\x7f]/;
const PAIR = /../g;

/**
 * The ASCII text (the base64) behind a lowercase hex wire, or a throw. The decoding is the engine's own
 * (each pair becomes `%xx`, then decodeURIComponent), not a loop over every character in JS: on a 32-bit
 * TV that loop was most of a portal answer's cost (a 500-channel page took 15-19 s, 2.2.7 on the KALLEY;
 * the same work is ~3.5x faster this way). Each piece is checked with one-character classes only: a regex
 * with repetition over megabytes ran the sandbox out of memory ("out of memory in regexp execution").
 */
function fromHex(h) {
  if (typeof h !== "string" || h.length === 0 || h.length % 2 !== 0) throw new Error("not hex");
  const parts = [];
  for (let i = 0; i < h.length; i += HEX_CHUNK) {
    const piece = h.slice(i, i + HEX_CHUNK);
    if (NOT_LOWER_HEX.test(piece)) throw new Error("not hex");
    const text = decodeURIComponent(piece.replace(PAIR, "%$&"));
    if (NOT_ASCII.test(text)) throw new Error("not ascii"); // base64 is ASCII
    parts.push(text);
  }
  return parts.join("");
}

// The host decodes the hex instead, when it can: an AES-ECB encryption of the wire's bytes (handed over
// as hex) and its decryption with the same throwaway key give back those bytes as text, the base64,
// all of it done by the app (Kotlin) instead of the sandbox. The key is not a secret: nothing is hidden
// by it, it only carries the bytes through. Pieces stay under kino.crypto's 5 MB per input.
const PASS_KEY = "kino-xuper-hex16";
const HOST_CHUNK = 4_000_000; // hex digits: 2 MB of bytes

function hostFromHex(kino, h) {
  if (typeof h !== "string" || h.length === 0 || h.length % 2 !== 0) throw new Error("not hex");
  const parts = [];
  for (let i = 0; i < h.length; i += HOST_CHUNK) {
    const piece = h.slice(i, i + HOST_CHUNK);
    const sealed = kino.crypto.encrypt("aes-128-ecb", { key: PASS_KEY, data: piece, inputEncoding: "hex" });
    const text = kino.crypto.decrypt("aes-128-ecb", { key: PASS_KEY, data: sealed });
    if (typeof text !== "string" || text.length * 2 !== piece.length) throw new Error("not ascii");
    parts.push(text);
  }
  return parts.join("");
}

// The wire's base64, decoded by the host when it can (it refuses odd or non-hex input itself), else by
// fromHex with its strict checks. No pass of the sandbox over the whole wire on the host's way: on a
// 32-bit TV even a one-character regex over megabytes costs seconds. A non-ASCII byte cannot slip
// through: it is not base64, so the 3DES step that follows refuses it. Either case of hex reads alike.
function wireText(kino, h) {
  let text = null;
  try { text = hostFromHex(kino, h); } catch (_) { /* the engine's way below */ }
  return text === null ? { text: fromHex(h), how: "engine" } : { text, how: "host" };
}

export function makeCrypto(kino, { onDecode = null } = {}) {
  // Only the failure kind goes into the message, never the underlying text: it could echo input.
  const fail = (what) => kino.error("unavailable", "el portal no se pudo " + what);
  return {
    encryptBody(plain) {
      try {
        const b64 = kino.crypto.encrypt("des-ede3-ecb", {
          key: kino.secret("magisKey"), data: plain, padding: "pkcs7",
        });
        if (typeof b64 !== "string" || b64 === "") throw new Error("empty");
        return toHex(b64);
      } catch (_) { throw fail("cifrar"); }
    },
    // `onDecode({ how, bytes, ms })`, optional: which way a wire was decoded and how long it took.
    decryptBlob(wire) {
      try {
        const startedAt = Date.now();
        const { text: b64, how } = wireText(kino, wire);
        if (onDecode) onDecode({ how, bytes: wire.length, ms: Date.now() - startedAt });
        const text = kino.crypto.decrypt("des-ede3-ecb", {
          key: kino.secret("magisKey"), data: b64, padding: "pkcs7",
        });
        if (typeof text !== "string" || text === "") throw new Error("empty");
        return text;
      } catch (_) { throw fail("descifrar"); }
    },
  };
}
