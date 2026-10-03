// Body crypto for the portal: UTF-8 JSON -> 3DES-EDE/ECB/PKCS5 -> padded base64 -> the ASCII
// bytes of that base64 -> lowercase hex. The key is the typed secret `magisKey`; it never
// enters this code, only its marker does.
const toHex = (s) =>
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

// Lowercase hex digit -> value, anything else -> -1.
const HEX_VALUE = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < 10; i++) t[48 + i] = i;
  for (let i = 0; i < 6; i++) t[97 + i] = 10 + i;
  return t;
})();
const CHUNK = 4096;

/**
 * The ASCII text (the base64) behind a lowercase hex wire, or a throw. No regex over the wire: the
 * app's QuickJS keeps a backtrack state per repetition, so validating a 500-channel getLiveData page
 * (megabytes of hex) with one ran the 64 MB sandbox out of memory ("out of memory in regexp
 * execution") whenever the heap was already half full. One pass, built in short pieces.
 */
function fromHex(h) {
  if (typeof h !== "string" || h.length === 0 || h.length % 2 !== 0) throw new Error("not hex");
  const parts = [];
  const buf = new Uint8Array(CHUNK);
  let n = 0;
  for (let i = 0; i < h.length; i += 2) {
    const a = h.charCodeAt(i), b = h.charCodeAt(i + 1);
    const hi = a < 128 ? HEX_VALUE[a] : -1, lo = b < 128 ? HEX_VALUE[b] : -1;
    if (hi < 0 || lo < 0) throw new Error("not hex");
    const byte = (hi << 4) | lo;
    if (byte > 0x7f) throw new Error("not ascii"); // base64 is ASCII
    buf[n++] = byte;
    if (n === CHUNK) { parts.push(String.fromCharCode.apply(null, buf)); n = 0; }
  }
  if (n > 0) parts.push(String.fromCharCode.apply(null, buf.subarray(0, n)));
  return parts.join("");
}

export function makeCrypto(kino) {
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
    decryptBlob(wire) {
      try {
        const text = kino.crypto.decrypt("des-ede3-ecb", {
          key: kino.secret("magisKey"), data: fromHex(wire), padding: "pkcs7",
        });
        if (typeof text !== "string" || text === "") throw new Error("empty");
        return text;
      } catch (_) { throw fail("descifrar"); }
    },
  };
}
