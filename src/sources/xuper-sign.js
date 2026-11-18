// src/sources/xuper-sign.js — firma por-petición del vivo Magis (port de tweakedMd5.js + liveSign.js).
// JS puro, sin kino. Construye los headers Content-Auth (sign2=sign_o3) + Content-License que la CDN
// de vivo exige en cada petición de playlist/segmento. El MD5 acá es el MD5 MODIFICADO del portal
// (round-1 reordenado + 4 constantes K distintas): NO sirve para MD5 estándar, sólo para firmar vivo.

// Literales que toda petición de CDN de vivo lleva (native LiveHlsProxy).
export const LIVE_USER_AGENT = "Ranger/4.9.4-17294ac0";
export const LIVE_APP = "com.android.msandroid";
export const LIVE_APP_VERSION = "49902";
export const LIVE_X_BUFFER = "0";

// ── MD5 modificado (firma de segmentos de vivo) ──────────────────────────────
const K = [
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
  0x289b7ec6, 0xeaa127fa, 0xd46f3085, 0x04881d05, // [42] tweaked
  0xd9d4d039, 0xe6bd99e5, 0x1fa27cf8, 0xc4ac5665, // [45] tweaked
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffecc47d, 0x85845dd1, // [54] tweaked
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2da7d2bb, 0xeb86d391, // [62] tweaked
];
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const ROUND1 = [10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5];
const G = Array.from({ length: 64 }, (_, i) =>
  i < 16 ? ROUND1[i] : i < 32 ? (5 * i + 1) % 16 : i < 48 ? (3 * i + 5) % 16 : (7 * i) % 16);

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

function digestHex(bytes) {
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const len = bytes.length;
  const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
  const total = new Uint8Array(len + 1 + padLen + 8);
  total.set(bytes, 0);
  total[len] = 0x80;
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

// ── signContext + headers por CDN (port de liveSign.js) ──────────────────────
export const MAX_CONTEXT_CHARS = 4096;
const TOKEN = /token=([0-9A-Fa-f]{32})/;
const HEX32 = /^[0-9A-Fa-f]{32}$/;
const URL_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;

export function tokenOf(authBase) {
  const m = TOKEN.exec(typeof authBase === "string" ? authBase : "");
  return m ? m[1] : "";
}

const normalize = (authority) => String(authority).toLowerCase().replace(/:80$/, "");

export function authorityOf(url) {
  const m = URL_AUTHORITY.exec(typeof url === "string" ? url : "");
  if (!m) return "";
  const at = m[1].lastIndexOf("@");
  return normalize(at >= 0 ? m[1].slice(at + 1) : m[1]);
}

// cdns: [{ cflHost, authBase }] en orden del portal, primario primero.
export function buildSignContext(license, cdns, builtAtMs) {
  const built = Number.isFinite(builtAtMs) ? { b: Math.trunc(builtAtMs / 1000) } : {};
  const encode = (list, withToken) => JSON.stringify({
    l: license,
    c: list.map((d) => (withToken ? { h: d.cflHost, a: d.authBase, t: tokenOf(d.authBase) } : { h: d.cflHost, a: d.authBase })),
    ...built,
  });
  const full = encode(cdns, true);
  if (full.length <= MAX_CONTEXT_CHARS) return { context: full, kept: cdns };
  for (let n = cdns.length; n >= 1; n--) {
    const kept = cdns.slice(0, n);
    const context = encode(kept, false);
    if (context.length <= MAX_CONTEXT_CHARS) return { context, kept };
  }
  return null;
}

function readContext(context) {
  let ctx;
  try { ctx = JSON.parse(context); } catch (_) { ctx = null; }
  const ok = ctx && typeof ctx === "object" && typeof ctx.l === "string" && Array.isArray(ctx.c) && ctx.c.length > 0
    && ctx.c.every((d) => d && typeof d.h === "string" && typeof d.a === "string");
  if (!ok) throw new Error("live signContext no legible");
  return ctx;
}

// Headers firmados para UNA petición de CDN. La entrada es la del host de la url (token y host de la
// MISMA entrada: el par cruzado es lo que la CDN rechaza con 401). nowMs = momento de firma.
export function signRequest({ url, context }, nowMs) {
  const ctx = readContext(context);
  const want = authorityOf(url);
  const cdn = ctx.c.find((d) => normalize(d.h) === want) || ctx.c[0];
  const token = typeof cdn.t === "string" && HEX32.test(cdn.t) ? cdn.t : tokenOf(cdn.a);
  if (token === "") throw new Error("entrada de CDN de vivo sin token");
  const moment = Math.trunc(nowMs);
  return {
    headers: {
      "Content-Auth": `${cdn.a}&sign2_method=sign_o3&instance=0&start_moment=${moment}&sign2=${signO3(token, moment)}`,
      "Content-License": ctx.l,
      "User-Agent": LIVE_USER_AGENT,
      App: LIVE_APP,
      "App-Version": LIVE_APP_VERSION,
      "X-Buffer": LIVE_X_BUFFER,
    },
  };
}
