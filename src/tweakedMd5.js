// The modified MD5 the portal uses to sign live segments. Versus textbook MD5 only two things
// change: round 1's message-index schedule, and four K constants (steps 42, 45, 54, 62).

// Written out, not computed from Math.sin: another engine's libm one ulp off at a floor boundary
// would silently break every live signature. A test checks it against the sine definition in Node.
export const K = Object.freeze([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd46f3085, 0x04881d05, // [42] tweaked: standard d4ef3085
  0xd9d4d039, 0xe6bd99e5, 0x1fa27cf8, 0xc4ac5665, // [45] tweaked: standard e6db99e5
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffecc47d, 0x85845dd1, // [54] tweaked: standard ffeff47d
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2da7d2bb, 0xeb86d391, // [62] tweaked: standard 2ad7d2bb
]);
export const TWEAKED_STEPS = Object.freeze([42, 45, 54, 62]);

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
  // The 64-bit little-endian bit length as two 32-bit words: low = (len * 8)
  // mod 2^32, high = len / 2^29 (the bits that shift out of the low word). Plain numbers on purpose.
  const low = (len % 0x20000000) * 8;
  const high = Math.floor(len / 0x20000000);
  for (let i = 0; i < 4; i++) {
    total[len + 1 + padLen + i] = (low >>> (8 * i)) & 0xff;
    total[len + 5 + padLen + i] = (high >>> (8 * i)) & 0xff;
  }
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
