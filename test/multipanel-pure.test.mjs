// 1.0.46: supertv's live channels from 2–3 independent panels — the pure part: how a secondary panel's categories map
// (src/liveMap.js) and how its channels merge with the primary's by name (src/liveMerge.js).
// Fixtures: the phone's 30 supertv categories (line.znn8.xyz, live-categories-121.json), the categories of 9 real panels
// (stv-panels.json) and one DAZN category on two independent panels (stv-dazn.json: zee-ott 25 rows, tresinl 92).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.kino = { lang: "es", log() {} };
const { mapCategories, targetOf, MAX_EXPOSED } = await import("../src/liveMap.js");
const { composeMerged, mergeKey, MERGED_REF_MAX } = await import("../src/liveMerge.js");
const { decodeRef } = await import("../src/refs.js");
const live = await import("../src/live.js");
const { rankSupertv, EVENT_RE } = await import("../src/sources/supertv.js");
const { isAdultTitle } = await import("../src/sources/adult.js");

const REAL = JSON.parse(readFileSync(new URL("./fixtures/live-categories-121.json", import.meta.url), "utf8")).categories;
const PANELS = JSON.parse(readFileSync(new URL("./fixtures/stv-panels.json", import.meta.url), "utf8")).panels;
const DAZN = JSON.parse(readFileSync(new URL("./fixtures/stv-dazn.json", import.meta.url), "utf8"));
const SEC = (id) => (id === "supertv2" || id === "supertv3" ? "supertv" : null);
const where = (m, src, id) => m.byRaw.get(src + "\u0001" + id);
const ID = /^[A-Za-z0-9._~-]{1,128}$/;

/** A slot's categories as its connector stores them: supertv's shaping (sports, no 18+, ES first, ≤ 30) and no events. */
function slotCats(host) {
  const out = [], seen = new Set();
  for (const [id, name] of PANELS[host]) {
    if (seen.has(id) || isAdultTitle(name)) continue;
    const r = rankSupertv(name);
    if (r < 0 || EVENT_RE.test(name)) continue;
    seen.add(id);
    out.push({ id, title: name.trim(), r, i: out.length });
  }
  return out.sort((a, b) => a.r - b.r || a.i - b.i).slice(0, 30).map(({ id, title }) => ({ id, title }));
}
const phonePrimary = () => REAL.filter((c) => c.src === "supertv").map((c) => ({ src: "supertv", cat: { id: c.rawId, title: c.title } }));
const as = (src, cats) => cats.map((cat) => ({ src, cat }));
const realRaw = () => REAL.map((c) => ({ src: c.src, cat: { id: c.rawId, title: c.title, ...(c.adult ? { adult: true } : {}) } }));

// ═════════════ mapping ═════════════

test("a secondary panel's titles map by supertv's own rules: the phone's 30 znn8 categories land where supertv's do", () => {
  for (const c of REAL.filter((x) => x.src === "supertv")) assert.equal(targetOf("supertv", { id: c.rawId, title: c.title }), c.expect, c.title);
  // the same 30 as a slot's, with the primary serving every target: each kept one maps to its supertv target
  const prim = phonePrimary();
  const sec = as("supertv2", prim.map((r) => ({ ...r.cat, id: "s" + r.cat.id })));
  const m = mapCategories(prim.concat(sec), { secondaryOf: SEC });
  for (const c of REAL.filter((x) => x.src === "supertv")) {
    const got = where(m, "supertv2", "s" + c.rawId);
    if (got) assert.equal(got, c.expect, c.title);
  }
  // other panels' namings: "ES ▎…", "ES | …", "┃ES┃ …", "ESPAÑA DAZN", "→ ESPAÑA DAZN ←" are Spain
  for (const t of ["ES ▎DAZN", "ES | LALIGA VIP", "┃ES┃ DAZN ESPAÑA", "ESPAÑA DAZN", "→ ESPAÑA DAZN ←", "ESPAÑA DEPORTES"]) {
    assert.equal(targetOf("supertv", { id: "1", title: t }), "v.sp.es", t);
  }
  assert.equal(targetOf("supertv", { id: "1", title: "DE ▎SKY BUNDESLIGA" }), "v.sp.de");
  assert.equal(targetOf("supertv", { id: "1", title: "AR ▎BEIN SPORTS HD" }), "v.sp.world", "AR is Arabic on these panels");
});

test("secondary categories: only single-country sports targets the primary serves, never events, ≤ 6 per target; no new category, ids and count unchanged", () => {
  const prim = phonePrimary();
  const zee = slotCats("line.zee-ott.xyz"), fv = slotCats("fv99.nesewvp.top");
  const raw = realRaw().concat(as("supertv2", zee), as("supertv3", fv));
  const without = mapCategories(realRaw(), { secondaryOf: SEC });
  const m = mapCategories(raw, { secondaryOf: SEC });
  assert.deepEqual(m.list.map((e) => e.id), without.list.map((e) => e.id), "the exposed categories are 1.0.45's");
  assert.equal(m.list.length, 35);
  // kept: Spain (zee-ott 4, fv99 5), Netherlands, Germany, United Kingdom; dropped: UEFA (no single country), France and
  // the US (the primary serves neither), and nothing goes to events
  const kept = (src) => [...m.byRaw].filter(([k]) => k.startsWith(src + "\u0001")).map(([k, v]) => [k.split("\u0001")[1], v]);
  const title = (cats, id) => cats.find((c) => c.id === id).title;
  const zk = kept("supertv2").map(([id, v]) => title(zee, id) + " → " + v);
  assert.deepEqual(zk, ["ES ▎DEPORTE → v.sp.es", "ES ▎DAZN → v.sp.es", "ES ▎M+ CAMPEONES → v.sp.es", "ES ▎LALIGA+ → v.sp.es",
    "UK ▎PREMIER LEAGUE → v.sp.gb", "DE ▎SKY BUNDESLIGA → v.sp.de",
    "NL ▎VIAPLAY PREMIER LEAGUE ʀᴀᴡ → v.sp.nl", "NL ▎VIAPLAY BUNDESLIGA ʀᴀᴡ → v.sp.nl", "NL ▎VIAPLAY LIGUE 1 ʀᴀᴡ → v.sp.nl"]);
  assert.deepEqual(kept("supertv3").map(([, v]) => v), ["v.sp.es", "v.sp.es", "v.sp.es", "v.sp.es", "v.sp.es", "v.sp.de", "v.sp.de"]);
  assert.ok(!m.all.get("v.events").members.some((x) => SEC(x.src)), "no secondary event category");
  assert.ok(!m.all.get("v.sp.eu").members.some((x) => SEC(x.src)), "no secondary member where the category has no single country");
  for (const e of m.all.values()) {
    for (const s of ["supertv2", "supertv3"]) {
      const per = new Map();
      for (const x of e.members) if (x.src === s) per.set(e.id, (per.get(e.id) || 0) + 1);
      for (const n of per.values()) assert.ok(n <= 6, e.id + " " + s + " " + n);
    }
    if (e.members.some((x) => SEC(x.src))) assert.ok(e.members.some((x) => x.src === "supertv"), e.id + " has a primary member");
    assert.ok(ID.test(e.id));
  }
  // a dropped secondary category has no exposed id at all: never passed through, never in a bucket
  for (const c of zee.concat(fv)) {
    const id = where(m, "supertv2", c.id) || where(m, "supertv3", c.id);
    if (id) assert.ok(id.startsWith("v.sp."), c.title + " → " + id);
  }
  assert.ok(![...m.all.keys()].some((id) => id.startsWith("v.more.supertv") || id.startsWith("supertv2.") || id.startsWith("supertv3.")));
  assert.deepEqual(m.stats.secondary, { kept: 16, dropped: zee.length + fv.length - 16 });
  assert.ok(m.list.length <= MAX_EXPOSED);
});

test("a secondary panel alone brings nothing; a Latin American panel adds only its Spanish category to an ES-only primary", () => {
  const ltv = slotCats("ltv.ddns.net");
  const m = mapCategories(as("supertv2", ltv).concat(as("supertv3", slotCats("fv99.nesewvp.top"))), { secondaryOf: SEC });
  assert.equal(m.list.length, 0, "no primary member anywhere: no category");
  const es = [{ src: "supertv", cat: { id: "1", title: "ES ▎DEPORTE" } }];
  const m2 = mapCategories(es.concat(as("supertv2", ltv)), { secondaryOf: SEC });
  assert.deepEqual(m2.all.get("v.sp.es").members.map((x) => x.src + " " + x.rawCat), ["supertv 1", "supertv2 161"], "➡ ESPAÑA DEPORTES");
  assert.deepEqual(m2.list.map((e) => e.id), ["v.sp.es"], "its PERU / CHILE / MÉXICO … DEPORTES (Deportes: no single country) are dropped");
  assert.deepEqual(m2.stats.secondary, { kept: 1, dropped: ltv.length - 1 });
});

test("a category hidden as known-empty stays hidden when a secondary panel lists it (visibility follows the primary)", () => {
  const raw = [{ src: "supertv", cat: { id: "1", title: "ES ▎DEPORTE" } }, { src: "supertv2", cat: { id: "9", title: "ES ▎DAZN" } }];
  const m = mapCategories(raw, { secondaryOf: SEC, knownEmpty: (s) => s === "supertv" });
  assert.ok(m.all.get("v.sp.es").hidden);
  assert.equal(m.list.length, 0);
  const shown = mapCategories(raw, { secondaryOf: SEC, knownEmpty: (s) => s === "supertv2" });
  assert.ok(!shown.all.get("v.sp.es").hidden, "an empty secondary list never hides the primary's");
});

// ═════════════ merging across panels (real DAZN titles) ═════════════

const ACC = { primary: "http://line.zee-ott.xyz\u0001u1\u0001p1\u0001", secondary: "http://pp.tresinl.xyz\u0001u5\u0001p5\u0001" };
const daznList = (src, rows, base, secondary) => ({
  member: { src, rawCat: secondary ? "196" : "2956", cc: "es" }, rank: secondary ? 10 : 4, secondary: !!secondary,
  items: live.normalizeChannels(src, rows.map(([sid, name]) => ({ id: base + sid, title: name, logo: "https://logo.test/" + sid + ".png" }))),
});
const primaryList = () => daznList("supertv", DAZN.zeeott, ACC.primary, false);
const secondaryList = () => daznList("supertv2", DAZN.tresinl, ACC.secondary, true);
const membersOf = (c) => (c.ref.startsWith("M:") ? decodeRef(c.ref).members.map((m) => m.ref) : [c.ref]);
const srcOf = (r) => decodeRef(r).source;

test("cross-panel merge on real titles: the primary's rows keep id, title, logo and order; 8 gain a member on the other panel", () => {
  const before = composeMerged([primaryList()], { merge: true, cc: "es" });
  const out = composeMerged([primaryList(), secondaryList()], { merge: true, cc: "es" });
  assert.equal(before.length, 17);
  const head = out.slice(0, before.length);
  assert.deepEqual(head.map((c) => [c.id, c.title, c.logo]), before.map((c) => [c.id, c.title, c.logo]), "the top of the list is 1.0.45's");
  const cross = head.filter((c) => membersOf(c).some((r) => srcOf(r) === "supertv2"));
  const shown = cross.map((c) => c.title).sort();
  // shown without the panel's "ES ▎" (src/liveTitles.js): Spain's own tag in Spain's category
  assert.deepEqual(shown, ["DAZN 1 FHD", "DAZN 2 FHD", "DAZN 3 FHD", "DAZN 4 FHD", "DAZN F1 FHD",
    "DAZN LALIGA 2 FHD", "DAZN LALIGA FHD", "DAZN MOTOGP FHD"]);
  for (const c of cross) {
    const ms = membersOf(c);
    assert.deepEqual([...new Set(ms.map(srcOf))], ["supertv", "supertv2"], "the primary's copies first, then the other panel's");
    assert.ok(ms.filter((r) => srcOf(r) === "supertv2").length <= 2, "at most 2 copies of one secondary panel, best quality first");
    assert.ok(c.ref.length <= MERGED_REF_MAX);
  }
  // DAZN 1: zee-ott FHD + HD, then tresinl's best two of FHD / HD / SD / plain
  const d1 = head.find((c) => c.title === "DAZN 1 FHD");
  const t = new Map([...primaryList().items, ...secondaryList().items].map((c) => [c.ref, c.title]));
  assert.deepEqual(membersOf(d1).map((r) => t.get(r)), ["ES ▎DAZN 1 FHD", "ES ▎DAZN 1 HD", "DAZN 1 FHD", "DAZN 1 HD"]);
  // a channel only the other panel lists is not listed (its id and ref would encode the slot's account): every row is
  // one of the primary's
  assert.equal(out.length, before.length);
  assert.ok(out.every((c) => membersOf(c).some((r) => srcOf(r) === "supertv")));
});

test("cross-panel must not merge: other feeds, numbered event slots and the same stream id on two panels", () => {
  const out = composeMerged([primaryList(), secondaryList()], { merge: true, cc: "es" });
  const t = new Map([...primaryList().items, ...secondaryList().items].map((c) => [c.ref, c.title]));
  const rowOf = (title) => out.find((c) => membersOf(c).some((r) => t.get(r) === title));
  const together = (a, b) => { const r = rowOf(a); return !!r && membersOf(r).some((x) => t.get(x) === b); };
  assert.ok(together("ES ▎DAZN LALIGA FHD", "DAZN LIGA FHD"), "the measured alias: DAZN LIGA = DAZN LaLiga");
  assert.ok(together("ES ▎DAZN LALIGA 2 FHD", "DAZN LIGA 2 FHD"));
  assert.equal(mergeKey("DAZN LIGA 2 HD (OP1)", "es"), mergeKey("ES ▎DAZN LALIGA 2 FHD", "es"), "the same channel…");
  assert.ok(!rowOf("DAZN LIGA 2 HD (OP1)"), "… past the 2 copies a panel adds: left out, never a second row");
  for (const p of ["┃ES┃ DAZN 1 FHD", "ES | DAZN 1 HD", "DAZN 1"]) assert.equal(mergeKey(p, "es"), mergeKey("ES ▎DAZN 1 FHD", "es"), p);
  assert.ok(together("ES ▎DAZN MOTOGP FHD", "Dazn MotoGP FHD"));
  assert.ok(!together("ES ▎DAZN 1 FHD", "DAZN 2 FHD"));
  assert.ok(!together("ES ▎DAZN LALIGA FHD", "DAZN LA LIGA 4"));
  assert.ok(!together("ES ▎DAZN LALIGA FHD", "DAZN LIGA 5 FHD"));
  assert.ok(!together("ES ▎DAZN ACB 1", "Dazn Baloncesto FHD"));
  assert.ok(!rowOf("DAZN EVENTOS 3") && !rowOf("DAZN EVENTOS 1"), "a secondary panel's numbered event feeds are not listed");
  assert.ok(!rowOf("DAZN LIGA ALTERNATIVA 2"), "nor its numbered backups");
  // "Dazn Liga Femenina 1" is not DAZN LaLiga (and, only the other panel's, it is not listed)
  assert.notEqual(mergeKey("Dazn Liga Femenina 1 HD", "es"), mergeKey("ES ▎DAZN LALIGA FHD", "es"));
  const fem = composeMerged([primaryList(), daznList("supertv2", [[1, "Dazn Liga Femenina 1 HD"]], ACC.secondary, true)], { merge: true, cc: "es" });
  assert.deepEqual(fem.map((c) => c.ref), composeMerged([primaryList()], { merge: true, cc: "es" }).map((c) => c.ref));
  // the same stream id on two panels is two channels unless their names match (and the other panel's is not listed)
  const same = composeMerged([daznList("supertv", [[152089, "ES ▎DAZN 1 FHD"]], ACC.primary, false), daznList("supertv2", [[152089, "DAZN SERIE A 1 HD"]], ACC.secondary, true)], { merge: true, cc: "es" });
  assert.equal(same.length, 1);
  assert.ok(same[0].ref.startsWith("L:supertv:"));
  // the counts: 17 primary rows (8 with failover), nothing else
  assert.equal(out.length, 17);
});

test("a secondary panel's events, PPV slots and matches are never listed; its overflow never makes a duplicate row", () => {
  const ppv = ["PPV MAIN EVENT 01: Usyk vs Dubois", "PPV 04:", "UFC 03:", "EVENT 12:", "Real Madrid vs Barcelona"].map((n, i) => [900 + i, n]);
  const out = composeMerged([daznList("supertv", [[1, "ES ▎DAZN 1 FHD"]], ACC.primary, false), daznList("supertv2", ppv, ACC.secondary, true)], { merge: true, cc: "es" });
  assert.deepEqual(out.map((c) => c.title), ["DAZN 1 FHD"]);
  // the primary's own slots stay listed (1.0.45)
  const own = composeMerged([daznList("supertv", ppv, ACC.primary, false)], { merge: true, cc: "es" });
  assert.equal(own.length, ppv.length);
  // event-only feeds and numbered replays of another panel (tresinl "ESPAÑA DEPORTES", the kit run of 2026-11-17)
  const onlyEvents = ["MOVISTAR LA LIGA 1 (Solo Eventos)", "MOVISTAR LIGA CAMPEONES 2 ( SOLO FUNCIONA CUANDO HAY EVENTOS )",
    "MOVISTAR DEPORTE 4 (Solo Eventos)", "LA LIGA REPLAY 3", "DAZN EVENTOS 12"].map((n, i) => [700 + i, n]);
  const kept = ["MOVISTAR DEPORTE 7", "EUROSPORT 3 FHD"].map((n, i) => [800 + i, n]);
  // the primary lists the channels those feeds are named after
  const primRows = ["ES ▎DAZN 1 FHD", "ES ▎MOVISTAR LA LIGA 1", "ES ▎MOVISTAR LIGA CAMPEONES 2", "ES ▎MOVISTAR DEPORTE 4", "ES ▎LA LIGA REPLAY 3",
    "ES ▎MOVISTAR DEPORTE 7", "ES ▎EUROSPORT 3"].map((n, i) => [i + 1, n]);
  const tresSec = daznList("supertv2", onlyEvents.concat(kept), ACC.secondary, true);
  const tres = composeMerged([daznList("supertv", primRows, ACC.primary, false), tresSec], { merge: true, cc: "es" });
  assert.deepEqual(tres.map((c) => c.title), primRows.map(([, n]) => n.replace("ES ▎", "")));
  const secTitle = new Map(tresSec.items.map((c) => [c.ref, c.title]));
  assert.deepEqual(tres.flatMap(membersOf).filter((r) => srcOf(r) === "supertv2").map((r) => secTitle.get(r)), ["MOVISTAR DEPORTE 7", "EUROSPORT 3 FHD"],
    "only the plain feeds join the primary's channels");
  assert.equal(composeMerged([daznList("supertv", onlyEvents, ACC.primary, false)], { merge: true, cc: "es" }).length, onlyEvents.length, "a primary's own: listed as in 1.0.45");
  // 12 copies of one channel on each of two slots: each slot adds its 2 best, the ref stays ≤ 1400, no second row
  const many = (n, src, base) => daznList(src, Array.from({ length: n }, (_, i) => [5000 + i, "DAZN 1 " + ["FHD", "HD", "SD"][i % 3] + " [Opc." + (i + 1) + "]"]), base, src !== "supertv");
  const big = composeMerged([daznList("supertv", [[1, "ES ▎DAZN 1 FHD"], [2, "ES ▎DAZN 1 HD"]], ACC.primary, false), many(12, "supertv2", ACC.secondary),
    { ...many(12, "supertv3", "http://fv99.nesewvp.top:8080\u0001u9\u0001p9\u0001"), rank: 11 }], { merge: true, cc: "es" });
  assert.equal(big.length, 1);
  const ms = membersOf(big[0]).map(srcOf);
  assert.deepEqual(ms, ["supertv", "supertv", "supertv2", "supertv2", "supertv3", "supertv3"]);
  assert.ok(big[0].ref.length <= MERGED_REF_MAX);
});

test("the kit's real titles (2026-11-17) merge: 'LaLiga TV N', REPUESTO and bare ALTERNATIVA copies, R. Madrid TV, and Movistar / 'M.' as M+ in Spain", () => {
  const same = [
    ["ES ▎M+ LALIGA 2 FHD", "ES: (FHD) M+ LALIGA TV 2"], ["ES ▎M+ LALIGA 3 FHD", "ES: (FHD) M+ LALIGA TV 3"],
    ["ES ▎LALIGA HYPERMOTION FHD", "ES: LALIGA TV HYPERMOTION"], ["ES ▎LALIGA HYPERMOTION 2 FHD", "ES: LALIGA TV HYPERMOTION 2"],
    ["ES ▎LALIGA HYPERMOTION 3 FHD", "ES: LALIGA TV HYPERMOTION 3"],
    ["ES ▎DAZN LALIGA FHD", "ES: (FHD REPUESTO) DAZN LALIGA"], ["ES ▎DAZN LALIGA FHD", "ES: (HD REPUESTO2) DAZN LALIGA"],
    ["ES ▎DAZN F1 FHD", "ES: (FHD REPUESTO) DAZN F1"], ["ES ▎M+ LALIGA TV UHD", "ES: (FHD REPUESTO) M+ LALIGA"],
    ["ES ▎DAZN LALIGA FHD", "DAZN LIGA ALTERNATIVA"], ["ES ▎R.MADRID TV FHD", "ES: REAL MADRID TV"], ["ES ▎R.MADRID TV FHD", "REAL MADRID TV"],
    ["ES ▎M+ LALIGA TV UHD", "MOVISTAR LA LIGA FHD"], ["ES ▎M+ LALIGA 2 FHD", "MOVISTAR LA LIGA 2 FHD"],
    ["ES ▎M+ LALIGA 2 FHD", "M. LaLiga 2 OPC2"], ["ES ▎M+ LALIGA 3 FHD", "M. LaLiga 3 OPC2"],
  ];
  for (const [a, b] of same) assert.equal(mergeKey(b, "es"), mergeKey(a, "es"), a + " = " + b);
  const apart = [
    ["ES ▎M+ LALIGA 2 FHD", "ES: (FHD) M+ LALIGA TV BAR"], ["ES ▎LALIGA HYPERMOTION FHD", "ES ▎LALIGA HYPERMOTION 2 FHD"],
    ["ES ▎DAZN LALIGA FHD", "DAZN LIGA ALTERNATIVA 2"], ["ES ▎M+ LALIGA TV UHD", "M+ LIGA DE CAMPEONES 2 HD"],
    ["ES ▎M+ DEPORTES FHD", "ES ▎M+ DEPORTES 2 FHD"], ["ES ▎DAZN LALIGA FHD", "DAZN LA LIGA 4"],
  ];
  for (const [a, b] of apart) assert.notEqual(mergeKey(b, "es"), mergeKey(a, "es"), a + " ≠ " + b);
  // Movistar is M+ only inside Spain's category: Peru's "Movistar Deportes" is not M+ Deportes
  for (const cc of ["pe", null]) assert.notEqual(mergeKey("Movistar Deportes", cc), mergeKey("M+ Deportes", cc), String(cc));

  // composed as the kit stored them: every one of those rows of the other panels joins the primary's channel
  const P = "http://line.zee-ott.xyz\u0001u1\u0001p1\u0001", F = "http://fv99.nesewvp.top:8080\u0001u3\u0001p3\u0001";
  const prim = ["ES ▎M+ LALIGA TV UHD", "ES ▎M+ LALIGA 2 FHD", "ES ▎M+ LALIGA 3 FHD", "ES ▎LALIGA HYPERMOTION FHD", "ES ▎LALIGA HYPERMOTION 2 FHD",
    "ES ▎LALIGA HYPERMOTION 3 FHD", "ES ▎R.MADRID TV FHD", "ES ▎DAZN LALIGA FHD", "ES ▎DAZN F1 FHD"];
  const fv = ["ES: (FHD) M+ LALIGA TV 2", "ES: (FHD) M+ LALIGA TV 3", "ES: LALIGA TV HYPERMOTION", "ES: LALIGA TV HYPERMOTION 2",
    "ES: LALIGA TV HYPERMOTION 3", "ES: (FHD REPUESTO) DAZN LALIGA", "ES: (FHD REPUESTO) DAZN F1", "ES: (FHD REPUESTO) M+ LALIGA", "ES: REAL MADRID TV"];
  const tres = ["MOVISTAR LA LIGA 2 FHD", "M. LaLiga 3 OPC2", "DAZN LIGA ALTERNATIVA", "REAL MADRID TV"];
  const lists = [
    { ...daznList("supertv", prim.map((n, i) => [100 + i, n]), P, false), member: { src: "supertv", rawCat: "1", cc: "es" } },
    { ...daznList("supertv2", fv.map((n, i) => [200 + i, n]), F, true), member: { src: "supertv2", rawCat: "2", cc: "es" } },
    { ...daznList("supertv3", tres.map((n, i) => [300 + i, n]), ACC.secondary, true), member: { src: "supertv3", rawCat: "3", cc: "es" }, rank: 11 },
  ];
  const out = composeMerged(lists, { merge: true, cc: "es" });
  assert.deepEqual(out.map((c) => c.title), prim.map((n) => n.replace("ES ▎", "")), "no row of the other panels' own");
  const title = new Map(lists.flatMap((l) => l.items.map((c) => [c.ref, c.title])));
  const joined = out.flatMap(membersOf).filter((r) => srcOf(r) !== "supertv").map((r) => title.get(r));
  assert.deepEqual(joined.sort(), fv.concat(tres).sort(), "every copy on the other panels is failover of the primary's channel");
});
