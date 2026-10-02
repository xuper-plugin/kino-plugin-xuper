// The modified MD5 the portal uses to sign live segments. Versus textbook MD5 only two things
// change: round 1's message-index schedule, and four K constants (steps 42, 45, 54, 62).

const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
K[42] = 0xd46f3085; // standard d4ef3085
K[45] = 0xe6bd99e5; // standard e6db99e5
K[54] = 0xffecc47d; // standard ffeff47d
K[62] = 0x2da7d2bb; // standard 2ad7d2bb

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const ROUND1 = [10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5];
const G = Array.from({ length: 64 }, (_, i) =>
  i < 16 ? ROUND1[i] : i < 32 ? (5 * i + 1) % 16 : i < 48 ? (3 * i + 5) % 16 : (7 * i) % 16);

// Raw bytes (not text): "salt3333=4" followed by 11 non-ASCII-safe bytes.
const SALT = new Uint8Array([
  0x73, 0x61, 0x6c, 0x74, 0x33, 0x33, 0x33, 0x33, 0x3d, 0x34,
  0x98, 0x0d, 0x0a, 0x15, 0x32, 0xc9, 0xc3, 0x82, 0x17, 0x08, 0xc0,
]);

const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

function compress(state, block, off) {
  const m = new Array(16);
  for (let j = 0; j < 16; j++) {
    const p = off + j * 4;
    m[j] = (block[p] | (block[p + 1] << 8) | (block[p + 2] << 16) | (block[p + 3] << 24)) >>> 0;
  }
  let [a, b, c, d] = state;
  for (let i = 0; i < 64; i++) {
    let f;
    if (i < 16) f = (b & c) | (~b & d);
    else if (i < 32) f = (d & b) | (~d & c);
    else if (i < 48) f = b ^ c ^ d;
    else f = c ^ (b | ~d);
    const sum = (f + a + K[i] + m[G[i]]) >>> 0;
    a = d; d = c; c = b;
    b = (b + rotl(sum, S[i])) >>> 0;
  }
  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
}

export function digestHex(bytes) {
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const len = bytes.length;
  const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
  const total = new Uint8Array(len + 1 + padLen + 8);
  total.set(bytes, 0);
  total[len] = 0x80;
  const bits = BigInt(len) * 8n;
  for (let i = 0; i < 8; i++) total[len + 1 + padLen + i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  for (let off = 0; off < total.length; off += 64) compress(state, total, off);
  let out = "";
  for (const w of state) for (let i = 0; i < 4; i++) out += ((w >>> (8 * i)) & 0xff).toString(16).padStart(2, "0");
  return out;
}

export function signO3(token, startMomentMs) {
  const head = new TextEncoder().encode(
    `token=${token}&sign2_method=sign_o3&instance=0&start_moment=${startMomentMs}`);
  const msg = new Uint8Array(head.length + SALT.length);
  msg.set(head, 0);
  msg.set(SALT, head.length);
  return digestHex(msg);
}
