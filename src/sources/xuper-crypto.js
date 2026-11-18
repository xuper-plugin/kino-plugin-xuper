// src/sources/xuper-crypto.js — crypto puro (sin kino.crypto, sin Node) para el conector xuper.
// Replica kino.crypto.encrypt/decrypt("des-ede3-ecb", {padding:"pkcs7"}) y kino.crypto.hash("md5").
//   · 3DES-EDE/ECB/PKCS7 sobre la clave `magisKey` (hex → 24 bytes), con el truco SP-box (Paul Tero,
//     dominio público) para que descifrar una página de ~250 canales no tarde segundos en una TV.
//   · MD5 estándar (para password = md5(pwd+salt) y sn = md5(snToken+salt)).
//   · base64 y hex propios (atob/btoa existen en Kino, pero esto evita bordes binarios y chunking).
// Verificado byte-a-byte contra Node `crypto` (createCipheriv des-ede3-ecb / createHash md5).

// ───────────────────────── utilidades de bytes ─────────────────────────
const _enc = new TextEncoder();
const _dec = new TextDecoder("utf-8", { fatal: false });

export function utf8Bytes(str) { return _enc.encode(str); }
export function bytesToUtf8(bytes) { return _dec.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); }

export function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) throw new Error("hex inválido");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(b)) throw new Error("hex inválido");
    out[i] = b;
  }
  return out;
}

export function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

// hex de los bytes ASCII de un string (toHex del plugin original: cada char → 2 hex).
export function asciiToHex(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) out += (str.charCodeAt(i) & 0xff).toString(16).padStart(2, "0");
  return out;
}

// string ASCII a partir de un hex (fromHex del plugin original).
export function hexToAscii(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) throw new Error("hex inválido");
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.substr(i, 2), 16);
    if (Number.isNaN(code)) throw new Error("hex inválido");
    out += String.fromCharCode(code);
  }
  return out;
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes) {
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < len ? B64_ALPHABET[b2 & 63] : "=";
  }
  return out;
}

const B64_LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function base64ToBytes(b64) {
  let clean = "";
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c === 61) break; // '='
    if (c === 10 || c === 13 || c === 32 || c === 9) continue; // whitespace
    if (B64_LOOKUP[c] < 0) throw new Error("base64 inválido");
    clean += b64[i];
  }
  const outLen = (clean.length * 6) >> 3;
  const out = new Uint8Array(outLen);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64_LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out;
}

// ───────────────────────── MD5 estándar ─────────────────────────
function md5Bytes(bytes) {
  const rotl = (x, c) => (x << c) | (x >>> (32 - c));
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  const len = bytes.length;
  const withOne = len + 1;
  const padLen = ((56 - (withOne % 64)) + 64) % 64;
  const total = withOne + padLen + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[len] = 0x80;
  const bitLenLo = (len * 8) >>> 0;
  const bitLenHi = Math.floor(len / 0x20000000) >>> 0;
  for (let i = 0; i < 4; i++) msg[total - 8 + i] = (bitLenLo >>> (8 * i)) & 0xff;
  for (let i = 0; i < 4; i++) msg[total - 4 + i] = (bitLenHi >>> (8 * i)) & 0xff;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) {
      const p = off + j * 4;
      M[j] = (msg[p] | (msg[p + 1] << 8) | (msg[p + 2] << 16) | (msg[p + 3] << 24));
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (B & C) | (~B & D); g = i; }
      else if (i < 32) { f = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { f = C ^ (B | ~D); g = (7 * i) & 15; }
      const tmp = D;
      D = C; C = B;
      const sum = (A + f + K[i] + M[g]) | 0;
      B = (B + rotl(sum, S[i])) | 0;
      A = tmp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let w = 0; w < 4; w++) for (let i = 0; i < 4; i++) out[w * 4 + i] = (words[w] >>> (8 * i)) & 0xff;
  return out;
}

export function md5Hex(input) {
  const bytes = typeof input === "string" ? utf8Bytes(input) : input;
  return bytesToHex(md5Bytes(bytes));
}

// ───────────────────────── DES / 3DES (SP-box, Paul Tero, dominio público) ─────────────────────────
const _spfunction1 = [0x1010400,0,0x10000,0x1010404,0x1010004,0x10404,0x4,0x10000,0x400,0x1010400,0x1010404,0x400,0x1000404,0x1010004,0x1000000,0x4,0x404,0x1000400,0x1000400,0x10400,0x10400,0x1010000,0x1010000,0x1000404,0x10004,0x1000004,0x1000004,0x10004,0,0x404,0x10404,0x1000000,0x10000,0x1010404,0x4,0x1010000,0x1010400,0x1000000,0x1000000,0x400,0x1010004,0x10000,0x10400,0x1000004,0x400,0x4,0x1000404,0x10404,0x1010404,0x10004,0x1010000,0x1000404,0x1000004,0x404,0x10404,0x1010400,0x404,0x1000400,0x1000400,0,0x10004,0x10400,0,0x1010004];
const _spfunction2 = [-0x7fef7fe0,-0x7fff8000,0x8000,0x108020,0x100000,0x20,-0x7fefffe0,-0x7fff7fe0,-0x7fffffe0,-0x7fef7fe0,-0x7fef8000,-0x80000000,-0x7fff8000,0x100000,0x20,-0x7fefffe0,0x108000,0x100020,-0x7fff7fe0,0,-0x80000000,0x8000,0x108020,-0x7ff00000,0x100020,-0x7fffffe0,0,0x108000,0x8020,-0x7fef8000,-0x7ff00000,0x8020,0,0x108020,-0x7fefffe0,0x100000,-0x7fff7fe0,-0x7ff00000,-0x7fef8000,0x8000,-0x7ff00000,-0x7fff8000,0x20,-0x7fef7fe0,0x108020,0x20,0x8000,-0x80000000,0x8020,-0x7fef8000,0x100000,-0x7fffffe0,0x100020,-0x7fff7fe0,-0x7fffffe0,0x100020,0x108000,0,-0x7fff8000,0x8020,-0x80000000,-0x7fefffe0,-0x7fef7fe0,0x108000];
const _spfunction3 = [0x208,0x8020200,0,0x8020008,0x8000200,0,0x20208,0x8000200,0x20008,0x8000008,0x8000008,0x20000,0x8020208,0x20008,0x8020000,0x208,0x8000000,0x8,0x8020200,0x200,0x20200,0x8020000,0x8020008,0x20208,0x8000208,0x20200,0x20000,0x8000208,0x8,0x8020208,0x200,0x8000000,0x8020200,0x8000000,0x20008,0x208,0x20000,0x8020200,0x8000200,0,0x200,0x20008,0x8020208,0x8000200,0x8000008,0x200,0,0x8020008,0x8000208,0x20000,0x8000000,0x8020208,0x8,0x20208,0x20200,0x8000008,0x8020000,0x8000208,0x208,0x8020000,0x20208,0x8,0x8020008,0x20200];
const _spfunction4 = [0x802001,0x2081,0x2081,0x80,0x802080,0x800081,0x800001,0x2001,0,0x802000,0x802000,0x802081,0x81,0,0x800080,0x800001,0x1,0x2000,0x800000,0x802001,0x80,0x800000,0x2001,0x2080,0x800081,0x1,0x2080,0x800080,0x2000,0x802080,0x802081,0x81,0x800080,0x800001,0x802000,0x802081,0x81,0,0,0x802000,0x2080,0x800080,0x800081,0x1,0x802001,0x2081,0x2081,0x80,0x802081,0x81,0x1,0x2000,0x800001,0x2001,0x802080,0x800081,0x2001,0x2080,0x800000,0x802001,0x80,0x800000,0x2000,0x802080];
const _spfunction5 = [0x100,0x2080100,0x2080000,0x42000100,0x80000,0x100,0x40000000,0x2080000,0x40080100,0x80000,0x2000100,0x40080100,0x42000100,0x42080000,0x80100,0x40000000,0x2000000,0x40080000,0x40080000,0,0x40000100,0x42080100,0x42080100,0x2000100,0x42080000,0x40000100,0,0x42000000,0x2080100,0x2000000,0x42000000,0x80100,0x80000,0x42000100,0x100,0x2000000,0x40000000,0x2080000,0x42000100,0x40080100,0x2000100,0x40000000,0x42080000,0x2080100,0x40080100,0x100,0x2000000,0x42080000,0x42080100,0x80100,0x42000000,0x42080100,0x2080000,0,0x40080000,0x42000000,0x80100,0x2000100,0x40000100,0x80000,0,0x40080000,0x2080100,0x40000100];
const _spfunction6 = [0x20000010,0x20400000,0x4000,0x20404010,0x20400000,0x10,0x20404010,0x400000,0x20004000,0x404010,0x400000,0x20000010,0x400010,0x20004000,0x20000000,0x4010,0,0x400010,0x20004010,0x4000,0x404000,0x20004010,0x10,0x20400010,0x20400010,0,0x404010,0x20404000,0x4010,0x404000,0x20404000,0x20000000,0x20004000,0x10,0x20400010,0x404000,0x20404010,0x400000,0x4010,0x20000010,0x400000,0x20004000,0x20000000,0x4010,0x20000010,0x20404010,0x404000,0x20400000,0x404010,0x20404000,0,0x20400010,0x10,0x4000,0x20400000,0x404010,0x4000,0x400010,0x20004010,0,0x20404000,0x20000000,0x400010,0x20004010];
const _spfunction7 = [0x200000,0x4200002,0x4000802,0,0x800,0x4000802,0x200802,0x4200800,0x4200802,0x200000,0,0x4000002,0x2,0x4000000,0x4200002,0x802,0x4000800,0x200802,0x200002,0x4000800,0x4000002,0x4200000,0x4200800,0x200002,0x4200000,0x800,0x802,0x4200802,0x200800,0x2,0x4000000,0x200800,0x4000000,0x200800,0x200000,0x4000802,0x4000802,0x4200002,0x4200002,0x2,0x200002,0x4000000,0x4000800,0x200000,0x4200800,0x802,0x200802,0x4200800,0x802,0x4000002,0x4200802,0x4200000,0x200800,0,0x2,0x4200802,0,0x200802,0x4200000,0x800,0x4000002,0x4000800,0x800,0x200002];
const _spfunction8 = [0x10001040,0x1000,0x40000,0x10041040,0x10000000,0x10001040,0x40,0x10000000,0x40040,0x10040000,0x10041040,0x41000,0x10041000,0x41040,0x1000,0x40,0x10040000,0x10000040,0x10001000,0x1040,0x41000,0x40040,0x10040040,0x10041000,0x1040,0,0,0x10040040,0x10000040,0x10001000,0x41040,0x40000,0x41040,0x40000,0x10041000,0x1000,0x40,0x10040040,0x1000,0x41040,0x10001000,0x40,0x10000040,0x10040000,0x10040040,0x10000000,0x40000,0x10001040,0,0x10041040,0x40040,0x10000040,0x10040000,0x10001000,0x10001040,0,0x10041040,0x41000,0x41000,0x1040,0x1040,0x40040,0x10000000,0x10041000];

function desCreateKeys(key) {
  const pc2bytes0  = [0,0x4,0x20000000,0x20000004,0x10000,0x10004,0x20010000,0x20010004,0x200,0x204,0x20000200,0x20000204,0x10200,0x10204,0x20010200,0x20010204];
  const pc2bytes1  = [0,0x1,0x100000,0x100001,0x4000000,0x4000001,0x4100000,0x4100001,0x100,0x101,0x100100,0x100101,0x4000100,0x4000101,0x4100100,0x4100101];
  const pc2bytes2  = [0,0x8,0x800,0x808,0x1000000,0x1000008,0x1000800,0x1000808,0,0x8,0x800,0x808,0x1000000,0x1000008,0x1000800,0x1000808];
  const pc2bytes3  = [0,0x200000,0x8000000,0x8200000,0x2000,0x202000,0x8002000,0x8202000,0x20000,0x220000,0x8020000,0x8220000,0x22000,0x222000,0x8022000,0x8222000];
  const pc2bytes4  = [0,0x40000,0x10,0x40010,0,0x40000,0x10,0x40010,0x1000,0x41000,0x1010,0x41010,0x1000,0x41000,0x1010,0x41010];
  const pc2bytes5  = [0,0x400,0x20,0x420,0,0x400,0x20,0x420,0x2000000,0x2000400,0x2000020,0x2000420,0x2000000,0x2000400,0x2000020,0x2000420];
  const pc2bytes6  = [0,0x10000000,0x80000,0x10080000,0x2,0x10000002,0x80002,0x10080002,0,0x10000000,0x80000,0x10080000,0x2,0x10000002,0x80002,0x10080002];
  const pc2bytes7  = [0,0x10000,0x800,0x10800,0x20000000,0x20010000,0x20000800,0x20010800,0x20000,0x30000,0x20800,0x30800,0x20020000,0x20030000,0x20020800,0x20030800];
  const pc2bytes8  = [0,0x40000,0,0x40000,0x2,0x40002,0x2,0x40002,0x2000000,0x2040000,0x2000000,0x2040000,0x2000002,0x2040002,0x2000002,0x2040002];
  const pc2bytes9  = [0,0x10000000,0x8,0x10000008,0,0x10000000,0x8,0x10000008,0x400,0x10000400,0x408,0x10000408,0x400,0x10000400,0x408,0x10000408];
  const pc2bytes10 = [0,0x20,0,0x20,0x100000,0x100020,0x100000,0x100020,0x2000,0x2020,0x2000,0x2020,0x102000,0x102020,0x102000,0x102020];
  const pc2bytes11 = [0,0x1000000,0x200,0x1000200,0x200000,0x1200000,0x200200,0x1200200,0x4000000,0x5000000,0x4000200,0x5000200,0x4200000,0x5200000,0x4200200,0x5200200];
  const pc2bytes12 = [0,0x1000,0x8000000,0x8001000,0x80000,0x81000,0x8080000,0x8081000,0x10,0x1010,0x8000010,0x8001010,0x80010,0x81010,0x8080010,0x8081010];
  const pc2bytes13 = [0,0x4,0x100,0x104,0,0x4,0x100,0x104,0x1,0x5,0x101,0x105,0x1,0x5,0x101,0x105];

  const iterations = key.length > 8 ? 3 : 1;
  const keys = new Array(32 * iterations);
  const shifts = [0,0,1,1,1,1,1,1,0,1,1,1,1,1,1,0];
  let m = 0, n = 0;
  for (let j = 0; j < iterations; j++) {
    let left = (key[m++] << 24) | (key[m++] << 16) | (key[m++] << 8) | key[m++];
    let right = (key[m++] << 24) | (key[m++] << 16) | (key[m++] << 8) | key[m++];

    let temp = ((left >>> 4) ^ right) & 0x0f0f0f0f; right ^= temp; left ^= (temp << 4);
    temp = ((right >>> -16) ^ left) & 0x0000ffff; left ^= temp; right ^= (temp << -16);
    temp = ((left >>> 2) ^ right) & 0x33333333; right ^= temp; left ^= (temp << 2);
    temp = ((right >>> -16) ^ left) & 0x0000ffff; left ^= temp; right ^= (temp << -16);
    temp = ((left >>> 1) ^ right) & 0x55555555; right ^= temp; left ^= (temp << 1);
    temp = ((right >>> 8) ^ left) & 0x00ff00ff; left ^= temp; right ^= (temp << 8);
    temp = ((left >>> 1) ^ right) & 0x55555555; right ^= temp; left ^= (temp << 1);

    temp = (left << 8) | ((right >>> 20) & 0x000000f0);
    left = (right << 24) | ((right << 8) & 0xff0000) | ((right >>> 8) & 0xff00) | ((right >>> 24) & 0xf0);
    right = temp;

    for (let i = 0; i < shifts.length; i++) {
      if (shifts[i]) { left = (left << 2) | (left >>> 26); right = (right << 2) | (right >>> 26); }
      else { left = (left << 1) | (left >>> 27); right = (right << 1) | (right >>> 27); }
      left &= -0xf; right &= -0xf;

      const lefttemp = pc2bytes0[(left >>> 28) & 0xf] | pc2bytes1[(left >>> 24) & 0xf]
        | pc2bytes2[(left >>> 20) & 0xf] | pc2bytes3[(left >>> 16) & 0xf]
        | pc2bytes4[(left >>> 12) & 0xf] | pc2bytes5[(left >>> 8) & 0xf]
        | pc2bytes6[(left >>> 4) & 0xf];
      const righttemp = pc2bytes7[(right >>> 28) & 0xf] | pc2bytes8[(right >>> 24) & 0xf]
        | pc2bytes9[(right >>> 20) & 0xf] | pc2bytes10[(right >>> 16) & 0xf]
        | pc2bytes11[(right >>> 12) & 0xf] | pc2bytes12[(right >>> 8) & 0xf]
        | pc2bytes13[(right >>> 4) & 0xf];
      temp = ((righttemp >>> 16) ^ lefttemp) & 0x0000ffff;
      keys[n++] = lefttemp ^ temp;
      keys[n++] = righttemp ^ (temp << 16);
    }
  }
  return keys;
}

// Cifra/descifra `bytes` (múltiplo de 8) en ECB con las subclaves ya derivadas. encrypt: 1 cifra, 0 descifra.
function desCrypt(keys, bytes, encrypt) {
  const iterations = keys.length === 32 ? 3 : 9; // 1 clave → 3 pasos nominales; 3 claves → 9
  let looping;
  if (keys.length === 32) looping = encrypt ? [0, 32, 2] : [30, -2, -2];
  else looping = encrypt ? [0, 32, 2, 62, 30, -2, 64, 96, 2] : [94, 62, -2, 32, 64, 2, 30, -2, -2];

  const out = new Uint8Array(bytes.length);
  let o = 0;
  for (let pos = 0; pos < bytes.length; pos += 8) {
    let left = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    let right = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];

    let temp = ((left >>> 4) ^ right) & 0x0f0f0f0f; right ^= temp; left ^= (temp << 4);
    temp = ((left >>> 16) ^ right) & 0x0000ffff; right ^= temp; left ^= (temp << 16);
    temp = ((right >>> 2) ^ left) & 0x33333333; left ^= temp; right ^= (temp << 2);
    temp = ((right >>> 8) ^ left) & 0x00ff00ff; left ^= temp; right ^= (temp << 8);
    temp = ((left >>> 1) ^ right) & 0x55555555; right ^= temp; left ^= (temp << 1);

    left = ((left << 1) | (left >>> 31));
    right = ((right << 1) | (right >>> 31));

    for (let j = 0; j < iterations; j += 3) {
      const endloop = looping[j + 1];
      const loopinc = looping[j + 2];
      for (let i = looping[j]; i !== endloop; i += loopinc) {
        const right1 = right ^ keys[i];
        const right2 = ((right >>> 4) | (right << 28)) ^ keys[i + 1];
        temp = left;
        left = right;
        right = temp ^ (_spfunction2[(right1 >>> 24) & 0x3f] | _spfunction4[(right1 >>> 16) & 0x3f]
          | _spfunction6[(right1 >>> 8) & 0x3f] | _spfunction8[right1 & 0x3f]
          | _spfunction1[(right2 >>> 24) & 0x3f] | _spfunction3[(right2 >>> 16) & 0x3f]
          | _spfunction5[(right2 >>> 8) & 0x3f] | _spfunction7[right2 & 0x3f]);
      }
      temp = left; left = right; right = temp;
    }

    left = ((left >>> 1) | (left << 31));
    right = ((right >>> 1) | (right << 31));

    temp = ((left >>> 1) ^ right) & 0x55555555; right ^= temp; left ^= (temp << 1);
    temp = ((right >>> 8) ^ left) & 0x00ff00ff; left ^= temp; right ^= (temp << 8);
    temp = ((right >>> 2) ^ left) & 0x33333333; left ^= temp; right ^= (temp << 2);
    temp = ((left >>> 16) ^ right) & 0x0000ffff; right ^= temp; left ^= (temp << 16);
    temp = ((left >>> 4) ^ right) & 0x0f0f0f0f; right ^= temp; left ^= (temp << 4);

    out[o++] = (left >>> 24) & 0xff; out[o++] = (left >>> 16) & 0xff; out[o++] = (left >>> 8) & 0xff; out[o++] = left & 0xff;
    out[o++] = (right >>> 24) & 0xff; out[o++] = (right >>> 16) & 0xff; out[o++] = (right >>> 8) & 0xff; out[o++] = right & 0xff;
  }
  return out;
}

function pkcs7Pad(bytes) {
  const pad = 8 - (bytes.length % 8);
  const out = new Uint8Array(bytes.length + pad);
  out.set(bytes, 0);
  for (let i = bytes.length; i < out.length; i++) out[i] = pad;
  return out;
}

function pkcs7Unpad(bytes) {
  if (bytes.length === 0 || bytes.length % 8 !== 0) throw new Error("bloque 3DES inválido");
  const pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 8 || pad > bytes.length) throw new Error("padding pkcs7 inválido");
  for (let i = bytes.length - pad; i < bytes.length; i++) if (bytes[i] !== pad) throw new Error("padding pkcs7 inválido");
  return bytes.subarray(0, bytes.length - pad);
}

// 3DES-EDE/ECB/PKCS7 sobre bytes de clave (24). Devuelve bytes cifrados.
export function tripleDesEncryptBytes(keyBytes, dataBytes) {
  const keys = desCreateKeys(keyBytes);
  return desCrypt(keys, pkcs7Pad(dataBytes), true);
}
export function tripleDesDecryptBytes(keyBytes, dataBytes) {
  const keys = desCreateKeys(keyBytes);
  return pkcs7Unpad(desCrypt(keys, dataBytes, false));
}

// ───────────────────────── wire del portal (= crypto.js del plugin) ─────────────────────────
// encryptBody(plain): UTF8 → 3DES/PKCS7 → base64 → hex de los bytes ASCII del base64.
export function encryptBody(plain, keyHex) {
  const key = hexToBytes(keyHex);
  const cipher = tripleDesEncryptBytes(key, utf8Bytes(plain));
  const b64 = bytesToBase64(cipher);
  return asciiToHex(b64);
}
// decryptBlob(wire): hex → base64 ASCII → bytes → 3DES descifrar → UTF8.
export function decryptBlob(wireHex, keyHex) {
  const key = hexToBytes(keyHex);
  const b64 = hexToAscii(wireHex);
  const cipher = base64ToBytes(b64);
  const plain = tripleDesDecryptBytes(key, cipher);
  return bytesToUtf8(plain);
}

// hex aleatorio (para el fingerprint del device: no necesita CSPRNG, es un id de aparato).
export function randomHex(nBytes) {
  let out = "";
  for (let i = 0; i < nBytes; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return out;
}
