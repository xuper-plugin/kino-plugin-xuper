// Body crypto for the portal: UTF-8 JSON -> 3DES-EDE/ECB/PKCS5 -> padded base64 -> the ASCII
// bytes of that base64 -> lowercase hex. The key is the typed secret `magisKey`; it never
// enters this code, only its marker does.
const HEX = /^(?:[0-9a-f]{2})+$/;

const toHex = (s) =>
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(h) {
  if (typeof h !== "string" || !HEX.test(h)) throw new Error("not hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return new TextDecoder("utf-8", { fatal: true }).decode(out);
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
      } catch (e) { throw fail("cifrar"); }
    },
    decryptBlob(wire) {
      try {
        const text = kino.crypto.decrypt("des-ede3-ecb", {
          key: kino.secret("magisKey"), data: fromHex(wire), padding: "pkcs7",
        });
        if (typeof text !== "string" || text === "") throw new Error("empty");
        return text;
      } catch (e) { throw fail("descifrar"); }
    },
  };
}
