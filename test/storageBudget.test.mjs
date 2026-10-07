// kino.storage is 256 KB for the WHOLE plugin, measured by the app as the whole map encoded as ONE
// Android org.json object in UTF-8 (PluginStorage.kt). org.json escapes `"`, `\` and `/` (and
// control characters) inside each stored value, which the final review measured at about +12.5%
// on the plugin's caches. So every byte budget is measured on the ESCAPED length, and the worst
// case of every key the plugin writes, all full at once, still fits.
import test from "node:test";
import assert from "node:assert/strict";
import { storedLength } from "../src/homeTree.js";
import { makeByteCache } from "../src/byteCache.js";

const STORAGE_CAP = 262_144;

// An independent model of Android's JSONStringer.string(): the escaped text, then its UTF-8 bytes.
function androidQuoted(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"' || ch === "\\" || ch === "/") out += "\\" + ch;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return Buffer.byteLength(out, "utf8");
}

test("storedLength is the UTF-8 length of the value as Android's org.json writes it", () => {
  for (const s of ["", "plain", 'say "hi"', "a\\b", "https://img.test/a/b.png", "tab\there\nnew\r\f\b", "\u0001\u001f", "ñandú 😀 日本", JSON.stringify({ u: "https://x/y", t: 'q"' })]) {
    assert.equal(storedLength(s), androidQuoted(s), JSON.stringify(s));
  }
});

// A payload as heavy in escaped characters as the real ones (urls, quoted JSON keys).
const heavy = (n) => ({ u: `https://img.test/public/images/${String(n).padStart(32, "0")}/a/b/c.png`, t: `Título "${n}"`, d: "x/".repeat(40) });

test("a byte cache never stores more than its budget once escaped, even with slash- and quote-heavy entries", () => {
  for (const budget of [24_000, 32_000]) {
    const store = new Map();
    const kino = { storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) } };
    const clock = { t: 1, now() { return this.t; } };
    const cache = makeByteCache({ kino, key: "c", budgetBytes: budget, clock, ttlMs: 3600_000 });
    for (let i = 0; i < 400; i++) { clock.t++; cache.write([{ k: "q" + i, i: Array.from({ length: 5 }, (_, j) => heavy(i * 10 + j)) }]); }
    const text = store.get("c");
    assert.ok(androidQuoted(text) <= budget, `escaped ${androidQuoted(text)} > ${budget}`);
    assert.ok(androidQuoted(text) > budget * 0.9, "and it is really filled up to it");
  }
});

test("worst case: every key the plugin writes, all full at once, fits the 256 KB storage", () => {
  // Byte budgets (escaped): the Home rows snapshot (its parts and meta together, at most 80 KB, in up
  // to five parts: modelled as five keys sharing it), search, chapters. The rest is bounded by count.
  const budgets = { "rows:0": 16_000, "rows:1": 16_000, "rows:2": 16_000, "rows:3": 16_000, "rows:4": 16_000, "search:v1": 24_000, "chapters:v1": 32_000 };
  const hex = (n, w) => n.toString(16).padStart(w, "0");
  // 200 seeds as session.js stores them, with token lengths like the real pool's.
  const seeds = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ sn: hex(i, 32), userId: String(10_000_000 + i), userToken: hex(i, 64) })));
  const session = JSON.stringify({ userId: "12345678", userToken: hex(1, 64), jwtToken: "e".repeat(600), sn: hex(2, 32), acct: hex(3, 64) });
  // A channel's rotation: 4 tried sns, up to 16 excluded (refused before the carried seed it started on).
  const sns = (n) => Array.from({ length: n }, (_, i) => hex(i, 32));
  const rotation = JSON.stringify({ t: sns(4), a: hex(7, 32), k: hex(9, 16), at: 1790000000000, s: 1790000000000, x: sns(16), e: true });
  const misc = {
    seeds, session, pendingRegistration: JSON.stringify({ userId: "1", userToken: hex(1, 64), sn: hex(2, 32), email: "persona.larga@ejemplo.test", at: 1 }),
    refusedAcct: JSON.stringify({ key: hex(4, 64), at: 1 }), liveRotCarried: JSON.stringify({ a: hex(8, 32), at: 1790000000000, r: sns(16) }), region: '{"blocked":true}', seedsAt: "1790000000000", sharedAccount: "true",
  };
  for (let i = 0; i < 12; i++) misc["liveRot:" + "c".repeat(128) + i] = rotation;
  // The genre categories (liveCatalog.js, for the Categorías live tiles): at most 200 [id, genre] pairs.
  misc["liveCats:v2"] = JSON.stringify(Array.from({ length: 200 }, (_, i) => [String(100_000_000 + i), "entretenimiento"]));
  // One logo per tile genre (liveCatalog.js): every genre a tile can have, each URL at the 512-character cap.
  misc["liveLogos:v1"] = JSON.stringify(Object.fromEntries(
    ["deportes", "noticias", "infantil", "cineyseries", "peliculas", "series", "entretenimiento", "musica", "documentales", "anime"]
      .map((g) => [g, ("https://img.test/" + "a/".repeat(300)).slice(0, 512)]),
  ));
  // Wrapper of a value stored with a ttl ({"v":…,"e":…}) and the key itself, per key.
  const TTL_WRAPPER = 40;
  let total = 2; // the braces of the whole map
  for (const [k, budget] of Object.entries(budgets)) total += androidQuoted(k) + 4 + budget + TTL_WRAPPER;
  for (const [k, v] of Object.entries(misc)) total += androidQuoted(k) + 4 + androidQuoted(v) + TTL_WRAPPER;
  assert.ok(total <= STORAGE_CAP, `worst case ${total} B > ${STORAGE_CAP}`);
  // Headroom for what is not modelled here (a new key, a longer token): at least 48 KB.
  assert.ok(STORAGE_CAP - total >= 48_000, `only ${STORAGE_CAP - total} B of headroom`);
});
