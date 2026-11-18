// src/liveMap.js: the virtual live categories (pure). Fixtures: the 121 real categories collected on the device
// (test/fixtures/live-categories-121.json) and 147 synthetic xuper-like column titles (xuper-columns-synthetic.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.kino = { lang: "es", log() {} };
const { mapCategories, hexEnc, MAX_EXPOSED } = await import("../src/liveMap.js");

const REAL = JSON.parse(readFileSync(new URL("./fixtures/live-categories-121.json", import.meta.url), "utf8")).categories;
const XUPER = JSON.parse(readFileSync(new URL("./fixtures/xuper-columns-synthetic.json", import.meta.url), "utf8")).columns;
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const rawOf = (c) => ({ src: c.src, cat: { id: c.rawId, title: c.title, ...(c.adult ? { adult: true } : {}) } });
const realRaw = () => REAL.map(rawOf);
const xuperRaw = () => XUPER.map((c) => ({ src: "xuper", cat: { id: c.id, title: c.title } }));
const where = (m, src, id) => m.byRaw.get(src + "\u0001" + id);

/** I1: every raw category is a member of exactly one exposed category (hidden ones included), and the inverse holds. */
function assertI1(m, raw) {
  const seen = new Map();
  for (const e of m.all.values()) {
    assert.ok(ID.test(e.id), "invalid id " + e.id);
    for (const mem of e.members) {
      const k = mem.src + "\u0001" + mem.rawCat;
      assert.ok(!seen.has(k), "member twice: " + k);
      seen.set(k, e.id);
      assert.equal(m.byRaw.get(k), e.id, "byRaw inverts the members");
    }
    if (e.adult) assert.ok(e.members.every((x) => raw.find((r) => r.src === x.src && String(r.cat.id) === x.rawCat).cat.adult || e.id === "v.adult"));
  }
  for (const r of raw) assert.ok(seen.has(r.src + "\u0001" + String(r.cat.id)), "lost: " + r.src + " " + r.cat.id);
  assert.ok(m.list.length <= MAX_EXPOSED, "exposed " + m.list.length);
}

test("the 121 real categories map exactly as designed (§2.5): 35 exposed, nothing unmapped, nothing lost", () => {
  const raw = realRaw();
  const m = mapCategories(raw);
  for (const c of REAL) assert.equal(where(m, c.src, c.rawId), c.expect, c.src + " " + JSON.stringify(c.title));
  assert.equal(m.list.length, 35);
  assert.equal(m.stats.passed, 0);
  assert.deepEqual(m.list.slice(0, 3).map((e) => e.id), ["v.co", "v.sports", "v.mx"], "Colombia first, then Deportes");
  assertI1(m, raw);
  // supertv's raw ids change between bootstrap servers: it is matched by title only
  const moved = mapCategories([{ src: "supertv", cat: { id: "1805", title: "┃ES┃ M+ DEPORTES" } }]);
  assert.equal(where(moved, "supertv", "1805"), "v.sp.es");
});

test("the 147 xuper-like columns map as designed (§2.6); with the 121 real ones: 60–90 exposed, nothing lost", () => {
  const m1 = mapCategories(xuperRaw());
  for (const c of XUPER) {
    const got = where(m1, "xuper", c.id);
    if (c.expect) assert.equal(got, c.expect, JSON.stringify(c.title));
    else assert.equal(got, "xuper." + hexEnc(c.id), JSON.stringify(c.title) + " passes through with its 1.0.45 id");
  }
  const raw = realRaw().concat(xuperRaw());
  const m = mapCategories(raw);
  assert.ok(m.list.length >= 60 && m.list.length <= 90, String(m.list.length));
  assert.equal(m.list.length, 67);
  assert.equal(m.stats.passed, 15);
  assert.equal(m.list[m.list.length - 1].id, "v.adult", "Adults last");
  assert.equal(m.list.filter((e) => e.id === "v.all.xuper").length, 1);
  assertI1(m, raw);
});

test("budget: 300 unknown xuper titles → 24 pass through, the rest in v.more.xuper; ≤ 90; a too-long id goes to the bucket", () => {
  const raw = realRaw().concat(Array.from({ length: 300 }, (_, i) => ({ src: "xuper", cat: { id: String(5000 + i), title: "Zona " + i } })));
  raw.push({ src: "premiumtv", cat: { id: "Q".repeat(80), title: "Larguísimo" } });
  const m = mapCategories(raw, { srcName: (s) => ({ xuper: "Xuper", premiumtv: "Premium TV" }[s] || s) });
  assert.ok(m.list.length <= 90);
  assert.equal(m.list.filter((e) => e.kind === "pass" && e.src === "xuper").length, 24);
  const bucket = m.all.get("v.more.xuper");
  assert.equal(bucket.members.length, 276);
  assert.equal(bucket.title, "Más canales · Xuper");
  assert.equal(bucket.merge, false);
  assert.equal(where(m, "premiumtv", "Q".repeat(80)), "v.more.premiumtv", "an id Kino would refuse is bucketed, not dropped");
  for (const e of m.list) assert.ok(ID.test(e.id));
  for (const e of m.list.filter((x) => x.kind === "bucket")) assert.ok(!e.adult);
  // the passing ones are the lowest raw ids (new xuper columns get higher ids: they never push an old one out)
  assert.deepEqual(m.list.filter((e) => e.kind === "pass" && e.src === "xuper").map((e) => e.members[0].rawCat), Array.from({ length: 24 }, (_, i) => String(5000 + i)));
  const more = mapCategories(raw.concat([{ src: "xuper", cat: { id: "9999", title: "Zona nueva" } }]));
  assert.deepEqual(more.list.filter((e) => e.kind === "pass").map((e) => e.id), m.list.filter((e) => e.kind === "pass").map((e) => e.id), "pass-through ids stable");
  assertI1(m, raw);
});

test("a pass-through title equal to another exposed title gets its source's name", () => {
  const m = mapCategories([{ src: "premiumtv", cat: { id: "x1", title: "Zona" } }, { src: "xuper", cat: { id: "2", title: "zóna" } }],
    { srcName: (s) => (s === "xuper" ? "Xuper" : "Premium TV") });
  assert.deepEqual(m.list.map((e) => e.title), ["Zona", "zóna · Xuper"]);
});

test("adult never mixes: +18, XXX, Adultos and a category flagged adult all go to v.adult (adult: true), alone", () => {
  const raw = [
    { src: "xuper", cat: { id: "1", title: "+18" } }, { src: "xuper", cat: { id: "2", title: "XXX" } },
    { src: "premiumtv", cat: { id: "Adultos", title: "Adultos" } }, { src: "supertv", cat: { id: "7", title: "┃ES┃ DEPORTES", adult: true } },
    { src: "xuper", cat: { id: "3", title: "Colombia" } }, { src: "xuper", cat: { id: "4", title: "Sexto Sentido" } },
  ];
  const m = mapCategories(raw);
  const adult = m.all.get("v.adult");
  assert.equal(adult.adult, true);
  assert.deepEqual(adult.members.map((x) => x.src + ":" + x.rawCat), ["xuper:1", "xuper:2", "premiumtv:Adultos", "supertv:7"]);
  for (const e of m.all.values()) if (e.id !== "v.adult") assert.ok(!e.adult && e.members.every((x) => !["1", "2", "Adultos", "7"].includes(x.rawCat)));
  assert.equal(where(m, "xuper", "4"), "xuper." + hexEnc("4"), "'Sexto Sentido' is not 18+");
});

test("stability and inversion over random registries: same registry → same ids; every raw in exactly one category", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const titles = [...REAL.map((c) => c.title), ...XUPER.map((c) => c.title), "Zona", "Canal raro", "+18", "VIP", "┃TR┃ BEIN"];
  const srcs = ["tvenvivo", "caracol", "cablevisionhd", "premiumtv", "supertv", "futbollibre", "nuvio-sports", "deportv", "cncverse", "xuper"];
  for (let round = 0; round < 30; round++) {
    const raw = [];
    const n = 20 + Math.floor(rnd() * 250);
    for (let i = 0; i < n; i++) {
      const src = srcs[Math.floor(rnd() * srcs.length)];
      raw.push({ src, cat: { id: String(Math.floor(rnd() * 400)), title: titles[Math.floor(rnd() * titles.length)], ...(rnd() < 0.03 ? { adult: true } : {}) } });
    }
    const a = mapCategories(raw), b = mapCategories(raw);
    assert.deepEqual(a.list.map((e) => e.id), b.list.map((e) => e.id));
    const dedup = [];
    const seen = new Set();
    for (const r of raw) { const k = r.src + "\u0001" + r.cat.id; if (!seen.has(k)) { seen.add(k); dedup.push(r); } }
    assertI1(a, dedup);
  }
});

test("countries: AR on supertv is Arabic (international sports), 'AR |' on xuper names no country, ARG and 🇦🇷 are Argentina", () => {
  const one = (src, title) => where(mapCategories([{ src, cat: { id: "x", title } }]), src, "x");
  assert.equal(one("supertv", "┃AR┃ beIN SPORTS"), "v.sp.world");
  assert.equal(one("xuper", "AR | Deportes"), "v.sports");
  assert.equal(one("xuper", "AR | Locales"), "xuper.78", "unknown: passes through");
  assert.equal(one("xuper", "ARG | Noticias"), "v.news");
  assert.equal(one("xuper", "🇦🇷 Canales"), "v.ar");
  assert.equal(one("xuper", "ARG | Canales"), "v.ar");
  assert.equal(one("xuper", "Cine en español"), "v.movies", "'español' is the language, never Spain");
  assert.equal(one("xuper", "Canales en español"), "xuper.78");
  // supertv: an unknown delimited prefix or no prefix is a foreign feed; CA is Canada only on supertv
  assert.equal(one("supertv", "┃TR┃ BEIN"), "v.sp.world");
  assert.equal(one("supertv", "DAZN 1"), "v.sp.world");
  assert.equal(one("supertv", "┃CA┃ TSN"), "v.sp.world");
  assert.equal(one("xuper", "CA | Deportes"), "v.sports", "CA on a Latin American list is not Canada");
  assert.equal(one("xuper", "Canadá"), "v.ca");
  assert.equal(one("supertv", "UEFA ▎ CHAMPIONS"), "v.sp.eu");
  assert.equal(one("supertv", "ES ▎ DAZN"), "v.sp.es");
  assert.equal(one("supertv", "┃LAT┃ ESPN"), "v.sports");
});

test("sports words are whole words: no 'Influencers' (nfl), 'Copacabana' (copa) or 'Cocina Mundial' (mundial) in sports", () => {
  const one = (title) => where(mapCategories([{ src: "xuper", cat: { id: "x", title } }]), "xuper", "x");
  for (const t of ["Influencers", "Olímpica Estéreo", "Serie Animada", "Primera Fila", "Canal del Golfo", "Copacabana"]) assert.equal(one(t), "xuper.78", t);
  assert.equal(one("Cocina Mundial"), "v.ent");
  assert.equal(one("Cine de Primera"), "v.movies");
  for (const t of ["Futebol", "Liga BetPlay", "Copa Mundial", "Mundial de Clubes", "DAZN", "Primera División", "Sky Sports"]) assert.equal(one(t), "v.sports", t);
  for (const t of ["NBA", "Boxeo", "Lucha Libre", "Juegos Olímpicos", "F1 / Motor"]) assert.equal(one(t), "v.othersp", t);
});

test("titles in ES and EN (kino.lang); country and genre fields; known-empty categories hidden but still answering", () => {
  const raw = realRaw();
  kino.lang = "en";
  try {
    const m = mapCategories(raw);
    assert.equal(m.all.get("v.co").title, "Colombia");
    assert.equal(m.all.get("v.sports").title, "Sports");
    assert.equal(m.all.get("v.sp.gb").title, "Sports · United Kingdom");
    assert.equal(m.all.get("v.events").title, "Live events");
    assert.equal(m.all.get("v.docs").title, "Documentaries and culture");
  } finally { kino.lang = "es"; }
  const m = mapCategories(raw);
  assert.equal(m.all.get("v.sp.gb").title, "Deportes · Reino Unido");
  assert.deepEqual([m.all.get("v.co").country, m.all.get("v.co").genre, m.all.get("v.co").cc], ["CO", "otros", "co"]);
  assert.deepEqual([m.all.get("v.sp.de").country, m.all.get("v.sp.de").genre], ["DE", "deportes"]);
  assert.equal(m.all.get("v.news").genre, "noticias");
  assert.equal(m.all.get("v.events").merge, false);
  // a category whose every member is known to be empty (and none is code) is not listed, yet still answers by id
  const empty = mapCategories(raw.concat([{ src: "xuper", cat: { id: "77", title: "Zona" } }]), { knownEmpty: (s, id) => s === "xuper" && id === "77" });
  assert.ok(!empty.list.some((e) => e.id === "xuper." + hexEnc("77")));
  assert.ok(empty.all.get("xuper." + hexEnc("77")).hidden);
  const coded = mapCategories(raw, { knownEmpty: (s) => s === "premiumtv" || s === "caracol", codeBacked: (s) => s === "tvenvivo" });
  assert.ok(coded.list.some((e) => e.id === "v.co"), "a code member keeps it listed");
  assert.ok(!coded.list.some((e) => e.id === "v.cl"), "premiumtv's Chile alone, known empty: hidden");
});
