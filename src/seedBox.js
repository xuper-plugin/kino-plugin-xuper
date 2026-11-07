// The seed pool as published: either a plain JSON array (the old file) or an envelope that only Kino can open,
// { "v": 1, "iv": <base64, 12 bytes>, "data": <base64, AES-256-GCM ciphertext + tag> }, encrypted with the sealed
// `seedKey` secret of this plugin. The seal opens only inside Kino's runtime, so the same file read from outside Kino
// (a copy of this code, a script) is noise. Sealing is obfuscation, not secrecy (GUIDE §Sealed secrets), but it takes
// the pool out of reach of anyone who just copied the plugin's logic.

/** True when `text` is an envelope this code can try to open. */
export function isSeedBox(parsed) {
  return !!parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && parsed.v === 1 && typeof parsed.iv === "string" && typeof parsed.data === "string";
}

/** The seed list inside an envelope; null when it cannot be opened (no secret declared, wrong key, tampered). Never throws. */
export function openSeedBox(kino, box) {
  try {
    const text = kino.crypto.decrypt("aes-256-gcm", { key: kino.secret("seedKey"), iv: box.iv, ivEncoding: "base64", data: box.data });
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : null;
  } catch (_) { return null; }
}
