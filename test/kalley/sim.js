// A model of Xuper on the KALLEY (32-bit Realtek TV, Kino 0.9.50), run under QuickJS (`qjs`), the
// engine Kino uses. The plugin's real portal, crypto, catalog and live modules run against a portal
// whose answers are as heavy as the real ones (hex of base64 of the 3DES body: the JS work of an
// answer is decoding that wire and parsing the JSON; the 3DES itself is the host's, native, not
// modelled). Time is scaled: the plugin's clock runs SLOWDOWN times faster than the Mac's, so its slice
// decisions see what they would see on the TV, and every call is reported as Kino would get it: when
// it has answered AND its sandbox has nothing pending (quickjs-kt's evaluate drains the job queue).
//
// SLOWDOWN (250) is the KALLEY against this Mac's qjs, calibrated on 2.2.7's device run: a 500-channel
// live page took 15.4-19.4 s there; the same page here costs ~70 ms of plugin JS with 2.2.7's decoder.
// Every cost is scaled alike, the engine's own native string work included: pessimistic for the code
// that moved from JS loops to engine calls.
// Network time is not modelled (the portal answered in ~0.26 s on the TV). What the host (Kotlin) does
// for kino.crypto is added as host time at HOST_BYTES_PER_MS, the same for every version (2.2.7's 3DES
// decrypt was the host's too).
//
// Prints one JSON line: { calls: [{ label, ms }], ... }. Built and run by kalley.test.mjs.
import * as os from "os";
import { makePortal } from "../../src/portal.js";
import { makeCrypto } from "../../src/crypto.js";
import { makeCatalog } from "../../src/catalog.js";
import { makeCategories } from "../../src/categories.js";
import { makeSection } from "../../src/section.js";
import { makeLiveCatalog } from "../../src/liveCatalog.js";
import { makeLiveTiles } from "../../src/liveTiles.js";

const SLOWDOWN = 250;
const HOST_BYTES_PER_MS = 25_000; // 25 MB/s through kino.crypto on the TV, marshalling included
const T0 = Date.now();
let hostMs = 0;
const clock = { now: () => T0 + (Date.now() - T0) * SLOWDOWN + hostMs };

// ---- the portal's answers ----------------------------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const TAGS = ["Action", "Adventure", "Comedy", "Drama", "Thriller", "Crime", "Sci-Fi", "Fantasy", "Romance", "Mystery", "Horror", "Family", "Biography", "History", "Documentary", "War", "Music", "Animation"];
const WORDS = "un hermano y una hermana descubren ritual aterrador en la apartada casa de su nueva madre adoptiva donde nada es lo que parece cuando llega la noche".split(" ");
const hex32 = (n) => n.toString(16).padStart(32, "0").toUpperCase();
function asset(n, type) {
  const tags = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => TAGS[Math.floor(rnd() * TAGS.length)]);
  return {
    contentId: hex32(n * 7919 + 13), name: WORDS.slice(0, 2 + Math.floor(rnd() * 3)).join(" ") + " " + n, programType: type, tags: tags.join(","),
    score: Math.round(rnd() * 90) / 10, duration: 5400, description: Array.from({ length: 26 }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(" "),
    shelveTime: `2026-09-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")} 10:00:00`,
    posterList: [{ fileType: "icon", fileUrl: `https://img.example.test/public/images/vod/${hex32(n)}/icon_${n}.jpg` }, { fileType: "poster", fileUrl: `https://img.example.test/public/images/vod/${hex32(n + 1)}/bg_${n}.jpg` }],
    // What else a real asset carries (ratings, cast, ids, flags...): weight the JS must decode and parse.
    extra: { cast: WORDS.slice(0, 12).join(", "), director: "x".repeat(20), tag: "y".repeat(60), ids: [n, n + 1, n + 2], vip: false },
  };
}
function vodRoot(base, pool, cols, per, type) {
  const items = Array.from({ length: pool }, (_, i) => asset(base + i, type));
  const names = ["2026", "2026 Peliculas teatrales", "2025", ...Array.from({ length: cols }, (_, c) => "Seccion " + c)].slice(0, cols);
  return { recommendList: names.map((name, c) => ({ columnId: c, name, assetList: Array.from({ length: per }, () => items[Math.floor(rnd() * pool)]) })) };
}
function channelPage(from, n) {
  return { channelList: Array.from({ length: n }, (_, i) => ({
    channelCode: "CH" + (from + i), name: "Canal " + (from + i), channelNumber: from + i + 1,
    posterList: [{ fileType: "icon", fileUrl: `https://img.example.test/live/${hex32(from + i)}.png` }],
    // A real channel entry carries its stream catalog, EPG pointers and flags: ~1.1 KB in all.
    extra: { epg: "e".repeat(300), streams: Array.from({ length: 4 }, (_, k) => ({ q: k, u: "z".repeat(120) })), flags: [1, 0, 1] },
  })) };
}
const LIVE_TOTAL = 1037;
const ROOTS = { masnew_movies: vodRoot(0, 900, 50, 30, "movie"), masnew_series: vodRoot(10000, 600, 40, 30, "teleplay"), masnew_anime: vodRoot(20000, 300, 25, 30, "series"), masnew_kids: vodRoot(30000, 300, 25, 30, "movie") };
const LIVE_CATEGORIES = { recommendList: [{ columnId: 1, name: "ChannelList" }, { columnId: 2, name: "Noticias" }] };

// The wire as the portal sends it: lowercase hex of the ASCII of a base64 body. The base64 is a
// stand-in of the right length (the 3DES is the host's: the stub below hands back the plaintext).
const A64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const plainOf = new Map();
function wireOf(obj) {
  const plain = JSON.stringify(obj);
  const len = Math.ceil(plain.length * 4 / 3);
  const pieces = [];
  let piece = "";
  for (let i = 0; i < len; i++) {
    piece += A64.charCodeAt((i * 7919) % 64).toString(16);
    if (piece.length >= 8192) { pieces.push(piece); piece = ""; }
  }
  pieces.push(piece);
  const hex = pieces.join("");
  plainOf.set(len, plain);
  return { data: hex };
}
function answerFor(path, bean) {
  if (path === "getNextColumns") return bean.columnCode === "masnew_live" ? LIVE_CATEGORIES : ROOTS[bean.columnCode];
  if (path === "v6/getLiveData") {
    const from = (bean.pageNum - 1) * bean.pageSize;
    return channelPage(from, Math.max(0, Math.min(bean.pageSize, LIVE_TOTAL - from)));
  }
  throw new Error("unscripted " + path);
}
const wires = new Map(); // built once per answer, outside the measured calls
function bodyFor(path, bean) {
  const key = path + JSON.stringify(bean);
  if (!wires.has(key)) wires.set(key, JSON.stringify({ returnCode: "0", ...wireOf(answerFor(path, bean)) }));
  return wires.get(key);
}

// ---- kino ---------------------------------------------------------------------------------------
const store = {};
let pending = 0;
let lastRequest = null;
const requests = [];
const kino = {
  log: () => {},
  error: (code, msg) => { const e = new Error(msg); e.name = "KinoError_" + code; e.code = code; return e; },
  sleep: async () => {},
  secret: () => "secret-marker",
  crypto: {
    // Requests (short) and the hex pass-through (AES-ECB of the wire's bytes): host time by size.
    // A request body's "ciphertext" names the request it carries, so calls in flight together (the
    // Categorías VOD rows beside the live categories) each get their own answer.
    encrypt: (alg, { data }) => {
      hostMs += data.length / HOST_BYTES_PER_MS;
      if (alg === "aes-128-ecb") return { passBytes: data.length / 2 };
      requests.push(lastRequest);
      return "R" + (requests.length - 1);
    },
    // The host's AES (the pass-through back to text) and 3DES (the plaintext of that wire).
    decrypt: (alg, { data }) => {
      if (alg === "aes-128-ecb") { hostMs += data.passBytes / HOST_BYTES_PER_MS; return "A".repeat(data.passBytes); }
      hostMs += data.length / HOST_BYTES_PER_MS;
      return plainOf.get(data.length);
    },
    hash: (_alg, text) => String(text.length), // native on the device; not modelled
  },
  fetch: async (_url, opts) => {
    pending++;
    try {
      await new Promise((r) => os.setTimeout(r, 0));
      const token = opts.body.replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
      const req = requests[Number(token.slice(1))];
      const body = bodyFor(req.path, req.bean);
      return { status: 200, text: () => body };
    } finally { pending--; }
  },
  storage: {
    get: (k) => (Object.hasOwn(store, k) ? store[k] : null),
    set: (k, v) => { store[k] = String(v); },
    remove: (k) => { delete store[k]; },
    keys: () => Object.keys(store),
  },
};
globalThis.kino = kino;
// Kino's sandbox has TextEncoder; bare qjs does not (only ASCII request bodies go through it here).
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = class { encode(s) { return Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0)); } };
}

const session = { ensure: async () => {}, withValidSession: async (b, _o) => b({ userId: "u", userToken: "t" }), current: () => ({ sn: "sn" }), mode: () => "own" };
const crypto = makeCrypto(kino);
function newRuntime() {
  const portal = makePortal({ kino, crypto, config: { hosts: ["a.test"], appId: "a", apkVersion: "1" }, clock, snProvider: () => "sn" });
  // The request is remembered here (the wire is opaque): which path and bean the next fetch answers.
  const wrapped = { call: (path, bean, opts) => { lastRequest = { path, bean }; return portal.call(path, bean, opts); } };
  const catalog = makeCatalog({ kino, portal: wrapped, session, clock });
  const live = makeLiveCatalog({ kino, portal: wrapped, session, clock });
  // As wiring.js: the Categorías live tiles are asked beside the VOD rows.
  const liveTiles = makeLiveTiles({ kino, live, clock });
  return {
    catalog, categories: makeCategories({ catalog, kino, liveTiles }), section: makeSection({ kino, catalog, clock }), live, liveTiles,
  };
}

// ---- the scenario -------------------------------------------------------------------------------
const calls = [];
async function call(label, f) {
  const start = Date.now();
  const hostAtStart = hostMs;
  let error = null;
  try { await f(); } catch (e) { error = `${e.name}: ${e.message}`; }
  do { await new Promise((r) => os.setTimeout(r, 0)); } while (pending > 0);
  calls.push({ label, ms: Math.round((Date.now() - start) * SLOWDOWN + hostMs - hostAtStart), ...(error ? { error } : {}) });
}
// Warm the wires (their building is the test bench's, not the plugin's).
for (const code of Object.keys(ROOTS)) bodyFor("getNextColumns", { columnCode: code, pageNum: 1, pageSize: 60, version: "" });
bodyFor("getNextColumns", { columnCode: "masnew_live", pageNum: 1, pageSize: 200, version: "" });
for (const pageSize of [250, 500]) {
  for (let pageNum = 1; (pageNum - 1) * pageSize < LIVE_TOTAL + pageSize; pageNum++) {
    bodyFor("v6/getLiveData", { columnId: 1, pageNum, pageSize, dataVersion: "", expireTimeStr: "" });
  }
}

const scenario = (globalThis.scriptArgs || [])[1] || "all";
let r = newRuntime();
if (scenario === "all" || scenario === "fresh") {
  // The update from 2.2.3 (the same as a fresh install, plus 2.2.3's tree:* keys in storage): each cold
  // start makes one categories call, then the TV idles past Kino's 5 minutes and the sandbox is dropped.
  store["tree:anime"] = "x".repeat(18_000);
  store["tree:infantil"] = "y".repeat(18_000);
  for (let start = 1; start <= 4; start++) {
    r = newRuntime();
    await call(`fresh: start ${start}, categories`, () => r.categories.categories());
  }
  await call("fresh: home, same sandbox", () => r.catalog.home());
  await call("fresh: section, same sandbox", () => r.section.section({ tab: "series" }));
  await call("fresh: section, another tab", () => r.section.section({ tab: "anime" }));
  r = newRuntime();
  await call("next start: categories", () => r.categories.categories());
  await call("next start: section", () => r.section.section({ tab: "anime" }));
  await call("next start: section, another tab", () => r.section.section({ tab: "series" }));
  await call("next start: section, same tab again", () => r.section.section({ tab: "series" }));
}
if (scenario === "all" || scenario === "live") {
  r = newRuntime();
  await call("live: categories", () => r.live.liveCategories());
  let cursor = null;
  let page = 0;
  let total = 0;
  do {
    page++;
    let out = null;
    await call(`live: Todos page ${page}`, async () => { out = await r.live.liveChannels({ categoryId: "1", cursor }); });
    if (!out) break;
    total += out.items.length;
    cursor = out.next ?? null;
  } while (cursor !== null && page < 30);
  calls.push({ label: "live: Todos channels", count: total });
}
print(JSON.stringify({ slowdown: SLOWDOWN, calls, stored: Object.keys(store).sort() }));
