// src/liveMerge.js: the same channel shown once inside one exposed category (pure). Fixtures: real channel titles of
// the stored lists (test/fixtures/live-lists-sample.json) and real live events with their times
// (test/fixtures/live-events-sample.json), with synthetic refs of realistic length.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.kino = { lang: "es", log() {} };
const LIVE_MERGE = await import("../src/liveMerge.js");
const { mergeKey, composeMerged, memberLabel, eventKey, MERGED_REF_MAX } = LIVE_MERGE;
const { decodeRef } = await import("../src/refs.js");
const live = await import("../src/live.js");

const LISTS = JSON.parse(readFileSync(new URL("./fixtures/live-lists-sample.json", import.meta.url), "utf8")).lists;
const RANK = { tvenvivo: 0, caracol: 1, cablevisionhd: 2, premiumtv: 3, supertv: 4, futbollibre: 5, "nuvio-sports": 6, deportv: 7, cncverse: 8, xuper: 9 };

/** Kino's favourite form of a listed ref (PluginRef.encode: `plg1:<plugin>:` + base64url of {"id","k","r"}). */
const wrapped = (id, ref) => "plg1:xuper:" + Buffer.from(JSON.stringify({ id, k: "live", r: ref }).replace(/\//g, "\\/"), "utf8").toString("base64url");

/** Stored items of one source: raw ids padded so each ref has about `len` characters. */
function items(src, titles, opts = {}) {
  const len = opts.len || 40;
  const raw = titles.map((t, i) => {
    const base = (opts.prefix || "") + i;
    const pad = Math.max(0, len - (`L:${src}:`.length + base.length));
    return { id: base + "x".repeat(pad), title: t, ...(opts.logo ? { logo: "https://l/" + src + "/" + i + ".png" } : {}), ...(opts.adult ? { adult: true } : {}) };
  });
  return live.normalizeChannels(src, raw);
}
const list = (src, titles, opts = {}) => ({ member: { src, rawCat: opts.rawCat || "c", ...(opts.cc ? { cc: opts.cc } : {}) }, rank: RANK[src], items: items(src, titles, opts) });
const membersOf = (c) => (c.ref.startsWith("M:") ? decodeRef(c.ref).members.map((m) => m.ref) : [c.ref]);

/** I2: every raw channel of the union (deduped by Kino id) is in exactly one composed channel. */
function assertI2(lists, out) {
  const union = new Map();
  for (const l of lists) for (const c of l.items) if (!union.has(c.id)) union.set(c.id, c.ref);
  const seen = new Set();
  for (const c of out) {
    for (const r of membersOf(c)) { assert.ok(!seen.has(r), "twice: " + r.slice(0, 40)); seen.add(r); }
    assert.ok(c.ref.length <= 2048);
    if (c.ref.startsWith("M:")) {
      assert.ok(c.ref.length <= MERGED_REF_MAX, "merged ref " + c.ref.length);
      for (const r of membersOf(c)) assert.ok(r.length <= 512);
      assert.ok(wrapped(c.id, c.ref).length <= 2048, "Kino stores it with a favourite");
    }
  }
  assert.equal(new Set(out.map((c) => c.id)).size, out.length, "ids unique");
  assert.deepEqual([...seen].sort(), [...new Set(union.values())].sort());
}

test("must merge (design §3.2, verified on real titles)", () => {
  const same = (cc, ...titles) => { const k = titles.map((t) => mergeKey(t, cc)); assert.ok(k[0] && k.every((x) => x === k[0]), JSON.stringify(titles) + " → " + JSON.stringify(k)); };
  same("co", "Caracol", "Caracol TV", "Caracol HD [Opc.1]", "Caracol HD [Opc.2]", "Caracol SD [Opc.3]", "CO: CARACOL TV FHD");
  same("co", "RCN", "RCN HD", "RCN SD [Opc.2]");
  same(null, "ESPN", "ESPN HD", "ESPN SD (Opc.2)", "ESPN HD - (Opc.3)");
  same(null, "ESPN 2", "ESPN2 HD - (Opc.3)");
  same(null, "Las Estrellas", "Las Estrellas HD (Nacional)[V2](Opc.3)");
  same("mx", "Azteca 7", "Azteca 7 HD  (México)[Opc. 1]");
  same(null, "América TV", "América Televisión HD [Opc.2]");
  same(null, "Universal Channel", "Universal TV SD [Opc.1]");
  same(null, "Liga1 MAX", "Liga 1 Max");
  same(null, "DSports +", "DSports Plus");
  same(null, "R. MADRID TV HD", "R.MADRID TV FHD");
  same(null, "Telemundo Deportes Ahora (Internacional)[1080p]", "Telemundo Deportes Ahora (Internacional)[720p]", "Telemundo Deportes Ahora (Internacional)");
  same("mx", "┃MX┃ ESPN", "MX: ESPN", "ESPN", "🇲🇽 ESPN", "ESPN [MX]");
  same(null, "LAT: ESPN", "ESPN");
  // The Redmi's Deportes and Colombia grids (2026-11-17, O2): spaces, brand renames, a bare country code = its name.
  same(null, "Win+ HD", "Win Sports plus (2)", "Win Sports Plus", "Win+", "Win Sports+");
  same(null, "BluRadio", "Blu Radio HD [No 24/7] (Nacional)");
  same(null, "ESPN Colombia", "ESPN CO (Opc.2)");
  same("co", "ESPN Colombia", "ESPN CO (Opc.2)", "ESPN");
  same(null, "DSports", "Directv Sports", "DIRECTV SPORTS", "DSports [Opc. 1]");
  same(null, "DSports 2", "Directv Sports 2");
  same(null, "DSports +", "Directv Sports Plus");
  same(null, "ESPN 2", "ESPN2", "ESPN 2 HD");
  same(null, "L1 MAX", "Liga 1 Max", "Liga1 MAX");
  same(null, "TUDN México", "TUDN MX");
  same(null, "Sky Sports La Liga", "Sky Sports LaLiga [Opc.2]");
});

test("must not merge: numbered feeds, country feeds outside their country, different versions of a channel", () => {
  const apart = (cc, ...titles) => { const k = titles.map((t) => mergeKey(t, cc)); assert.equal(new Set(k).size, k.length, JSON.stringify(titles) + " → " + JSON.stringify(k)); };
  apart(null, "ESPN", "ESPN 2");
  apart(null, "Fox Sports", "Fox Sports 2", "FOX Sports 2 (USA)");
  apart(null, "ESPN", "ESPN (MX)", "ESPN Mexico", "ESPN (Perú)");
  apart(null, "MX: ESPN", "CL: ESPN", "ESPN");
  apart(null, "AR: TNT Sports", "CL: TNT Sports", "TNT Sports");
  apart(null, "🇲🇽 ESPN", "ESPN");
  apart(null, "Caracol", "Caracol 2", "Caracol Internacional", "Caracol Sports");
  apart(null, "Telefe", "Telefe Internacional Argentina");
  apart(null, "Eurosport 1", "Eurosport 1 REC");
  apart(null, "TVN Local", "TVN");
  apart(null, "beIN Sports ES", "beIN Sports EN");
  apart(null, "Top Barca ES", "Top Barca EN");
  apart(null, "Liga 1", "Liga 1 Max");
  apart(null, "Win Sports", "Win+", "Win Sports 2");   // Win+ is "Win Sports Plus" (O2), never the free Win Sports
  apart(null, "Telemundo 51", "Telemundo");
  apart(null, "Mega TV Arequipa", "Mega");
  apart(null, "Canal 13 Esquipulas", "Canal 13");
  apart(null, "TUDN", "TUDN México");
  // A bare country at the end stays a country outside its own category; spaces between two numbers still count.
  apart(null, "ESPN", "ESPN Colombia", "ESPN CO 2", "ESPN 2");
  apart(null, "beIN Sports", "beIN Sports ES", "DAZN 1", "DAZN 1 DE");
  apart(null, "Canal 13", "Canal 1 3");
  assert.equal(mergeKey("HD", null), "", "nothing usable left: never merged");
});

test("events, matches and numbered slots never merge; nor in a category with merging off", () => {
  const out = composeMerged([list("deportv", ["Alemania vs Países Bajos · ESPN · 20:00", "Alemania vs Países Bajos · ESPN · 20:00"], { prefix: "a" }),
    list("supertv", ["EPL 01", "EPL 01", "PPV 3", "PPV 3", "EVENT 37:", "EVENT 37:", "DAZN 1 FHD", "DAZN 1 HD"], { prefix: "s" })], { merge: true, cc: null });
  assert.equal(out.length, 9, "only DAZN 1 FHD/HD merge");
  assert.ok(out.find((c) => c.title === "DAZN 1 FHD").ref.startsWith("M:"));
  const off = composeMerged([list("tvenvivo", ["Caracol"]), list("premiumtv", ["Caracol HD [Opc.1]"])], { merge: false });
  assert.equal(off.length, 2);
  assert.ok(off.every((c) => c.ref.startsWith("L:")));
});

test("a bare number merges only inside a single-country category ('Canal 13' in Chile, never in News)", () => {
  const ls = () => [list("premiumtv", ["Canal 13"], { prefix: "a" }), list("xuper", ["Canal 13 HD"], { prefix: "b" })];
  assert.equal(composeMerged(ls(), { merge: true, cc: "cl" }).length, 1);
  assert.equal(composeMerged(ls(), { merge: true, cc: null }).length, 2);
});

test("outside a single-country category a member's own raw-category country keeps it apart ('Fútbol Argentino' vs generic)", () => {
  const generic = list("premiumtv", ["TNT Sports"], { prefix: "g" });
  const ar = list("xuper", ["TNT Sports"], { prefix: "a", cc: "ar" });
  const ar2 = list("xuper", ["TNT Sports HD"], { prefix: "b", cc: "ar", rawCat: "d" });
  const out = composeMerged([generic, ar, ar2], { merge: true, cc: null });
  assert.equal(out.length, 2);
  assert.equal(membersOf(out[1]).length, 2, "the two Argentine columns' copies merge together");
});

test("adult and non-adult copies never merge", () => {
  const out = composeMerged([list("xuper", ["Venus"], { prefix: "a" }), list("xuper", ["Venus HD"], { prefix: "b", adult: true })], { merge: true, cc: null });
  assert.equal(out.length, 2);
  assert.equal(out[1].adult, true);
});

test("priority: SOURCES order, then penalty, quality and copy; the primary's id, title (verbatim) and logo; logo fallback", () => {
  const out = composeMerged([
    list("tvenvivo", ["Caracol"]),
    list("caracol", ["Caracol TV"], { logo: true }),
    list("premiumtv", ["Caracol SD [Opc.3]", "Caracol HD [Opc.2]", "Caracol HD [Opc.1]", "Caracol HD (Geo-blocked)"], { logo: true }),
  ], { merge: true, cc: "co" });
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.id, "tvenvivo_" + live.hashId("0" + "x".repeat(40 - "L:tvenvivo:".length - 1)));
  assert.equal(c.title, "Caracol", "verbatim: Kino matches a favourite by id and the same name");
  assert.equal(c.logo, "https://l/caracol/0.png", "the primary has no logo: the first member that has one");
  const titleOf = new Map([...items("premiumtv", ["Caracol SD [Opc.3]", "Caracol HD [Opc.2]", "Caracol HD [Opc.1]", "Caracol HD (Geo-blocked)"], { logo: true })].map((x) => [x.ref, x.title]));
  assert.deepEqual(membersOf(c).slice(2).map((r) => titleOf.get(r)), ["Caracol HD [Opc.1]", "Caracol HD [Opc.2]", "Caracol SD [Opc.3]", "Caracol HD (Geo-blocked)"]);
  assert.deepEqual(membersOf(c).slice(0, 2).map((r) => decodeRef(r).source), ["tvenvivo", "caracol"]);
});

test("merged ref: format and round trip; ≤ 1400 (Kino keeps its wrapped form with a favourite), split when longer; long members alone", () => {
  const two = composeMerged([list("tvenvivo", ["ESPN"]), list("futbollibre", ["ESPN"])], { merge: true, cc: null });
  const [a, b] = [items("tvenvivo", ["ESPN"])[0].ref, items("futbollibre", ["ESPN"])[0].ref];
  assert.equal(two[0].ref, "M:" + a.slice(2) + "," + b.slice(2));
  assert.deepEqual(decodeRef(two[0].ref).members.map((m) => m.ref), [a, b]);
  assert.equal(decodeRef(two[0].ref).source, "tvenvivo");
  // 12 copies of 200 characters: 2,400 → split into a channel of 6 and one of 6, placed one after the other
  const big = composeMerged([list("premiumtv", Array.from({ length: 12 }, (_, i) => "Movistar Deportes [Opc." + (i + 1) + "]"), { len: 200 }), list("premiumtv", ["Otro"], { len: 200, prefix: "z" })], { merge: true, cc: null });
  assert.equal(big.length, 3);
  assert.ok(big[0].ref.length <= MERGED_REF_MAX && big[1].ref.length <= MERGED_REF_MAX);
  assert.equal(membersOf(big[0]).length + membersOf(big[1]).length, 12);
  assert.equal(big[2].title, "Otro");
  for (const c of big) assert.ok(wrapped(c.id, c.ref).length <= 2048);
  // a member over 512 characters (premiumtv España 611, cncverse 2,487) could not be an alternative: it stays alone
  const long = composeMerged([list("premiumtv", ["TVE"], { prefix: "a" }), list("premiumtv", ["TVE HD"], { len: 611, prefix: "b" })], { merge: true, cc: "es" });
  assert.equal(long.length, 2);
  assert.ok(long.every((c) => c.ref.startsWith("L:")));
  const single = composeMerged([list("xuper", ["Solo"])], { merge: true, cc: null });
  assert.equal(single[0].ref, items("xuper", ["Solo"])[0].ref, "one member: its own L: ref");
});

test("I2 on random lists: duplicate ids, same names, long refs, adult channels, events: each raw channel exactly once", () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const names = ["ESPN", "ESPN HD", "ESPN 2", "Caracol", "Caracol TV [Opc.2]", "Canal 13", "EPL 01", "A vs B", "Fox Sports", "HD", "Telefe", "MX: ESPN"];
  for (let round = 0; round < 40; round++) {
    const lists = [];
    const srcs = Object.keys(RANK);
    for (let j = 0; j < 1 + Math.floor(rnd() * 6); j++) {
      const src = srcs[Math.floor(rnd() * srcs.length)];
      const n = Math.floor(rnd() * 30);
      const titles = Array.from({ length: n }, () => names[Math.floor(rnd() * names.length)]);
      const l = list(src, titles, { len: rnd() < 0.2 ? 700 : 30 + Math.floor(rnd() * 200), prefix: String(Math.floor(rnd() * 3)), adult: rnd() < 0.1, cc: rnd() < 0.3 ? "ar" : undefined });
      lists.push(l);
    }
    for (const merge of [true, false]) {
      for (const cc of [null, "co"]) {
        const out = composeMerged(lists, { merge, cc });
        assertI2(lists, out);
        // order: a channel's position is its members' first appearance
        const firstAt = new Map();
        let pos = 0;
        for (const l of lists) for (const c of l.items) if (!firstAt.has(c.ref)) firstAt.set(c.ref, pos++);
        const at = out.map((c) => Math.min(...membersOf(c).map((r) => firstAt.get(r))));
        assert.deepEqual(at, at.slice().sort((x, y) => x - y));
      }
    }
  }
});

test("real lists (fixture): Colombia and Deportes merge across sources, keep every channel, never 'ESPN' with 'ESPN 2'", () => {
  const of = (src, rawCat) => LISTS.find((l) => l.src === src && l.rawCat === rawCat);
  const real = (src, rawCat, cc) => { const l = of(src, rawCat); return list(src, l.titles, { len: l.refLen, rawCat, prefix: rawCat + "-", cc }); };
  const co = [real("tvenvivo", "co"), real("caracol", "all"), real("premiumtv", "Colombia")];
  const coOut = composeMerged(co, { merge: true, cc: "co" });
  assertI2(co, coOut);
  const raw = co.reduce((n, l) => n + l.items.length, 0);
  assert.ok(coOut.length < raw, raw + " → " + coOut.length);
  const caracol = coOut.find((c) => c.title === "Caracol");
  assert.deepEqual([...new Set(membersOf(caracol).map((r) => decodeRef(r).source))], ["tvenvivo", "caracol", "premiumtv"]);
  const sp = [real("tvenvivo", "deportes"), real("cablevisionhd", "sports"), ...["FIFA+", "Sky Sports", "Tigo Sports / Fox", "Deportes", "DSports", "FOX Sports", "Win Sports", "Movistar Deportes", "ESPN"].map((g) => real("premiumtv", g)),
    real("futbollibre", "main"), real("futbollibre", "mas")];
  const spOut = composeMerged(sp, { merge: true, cc: null });
  assertI2(sp, spOut);
  const spRaw = sp.reduce((n, l) => n + l.items.length, 0);
  assert.ok(spOut.length < spRaw * 0.75, spRaw + " → " + spOut.length);
  const espn = spOut.filter((c) => /^espn$/i.test(c.title.trim()));
  assert.equal(espn.length, 1, "one ESPN");
  const titles = new Map(sp.flatMap((l) => l.items.map((c) => [c.ref, c.title])));
  const feed = (t) => { const m = /^\s*espn\s*(\d?)/i.exec(t); return m ? m[1] || "1" : null; };   // "ESPN2 HD - (Opc.3)" → "2"
  for (const c of spOut) {
    if (!feed(c.title)) continue;
    assert.equal(new Set(membersOf(c).map((r) => feed(titles.get(r)))).size, 1, "ESPN and ESPN 2 never share a channel: " + c.title);
  }
  assert.equal(spRaw, 357);
  // The design's measure (§3.6) was 202 and 61; O2 merges Liga 1 Max / L1 MAX, Sky Sports La Liga / LaLiga, Directv
  // Sports / DSports (×3: 1, 2, Plus), ESPN Colombia / ESPN CO, Win+ / Win Sports Plus, TUDN México / TUDN MX; BluRadio.
  assert.equal(spOut.length, 193);
  assert.equal(coOut.length, 60);
  for (const c of [...spOut, ...coOut]) assert.ok(!/\bopc\b/i.test(c.title), "no copy marker shown: " + c.title);
});

test("member labels: '<source> · <quality>' (+ copy), ES and EN, ≤ 48 characters", () => {
  assert.equal(memberLabel("TV en Vivo", "ESPN HD", false), "TV en Vivo · HD");
  assert.equal(memberLabel("Premium TV", "Caracol SD [Opc.3]", false), "Premium TV · SD · opción 3");
  assert.equal(memberLabel("Premium TV", "Caracol SD [Opc.3]", true), "Premium TV · SD · option 3");
  assert.equal(memberLabel("Premium TV", "Caracol", false), "Premium TV");
  assert.equal(memberLabel("Premium TV", "Caracol FHD", false), "Premium TV · FHD");
  assert.ok(memberLabel("x".repeat(80), "Caracol 4K [Opc.2]", false).length <= 48);
});

// ── O2: the shown title ──

test("shown titles lose their option and backup markers; ids and refs never change", () => {
  const { shownTitle } = LIVE_MERGE;
  assert.equal(shownTitle("Caracol HD [Opc.1]"), "Caracol HD");
  assert.equal(shownTitle("ESPN HD - (Opc.3)"), "ESPN HD");
  assert.equal(shownTitle("ESPN CO (Opc.2)"), "ESPN CO");
  assert.equal(shownTitle("DSports  [Opc. 2]"), "DSports");
  assert.equal(shownTitle("Win Sports plus (2)"), "Win Sports plus");
  assert.equal(shownTitle("Azteca 7 HD  (México)[Opc. 1]"), "Azteca 7 HD (México)", "a country tag is not a copy marker");
  assert.equal(shownTitle("Las Estrellas HD (Nacional)[V2](Opc.3)"), "Las Estrellas HD (Nacional)[V2]");
  assert.equal(shownTitle("[Opc.2]"), "[Opc.2]", "nothing else left: kept");
  const alone = list("premiumtv", ["ESPN CO (Opc.2)"], { prefix: "a" });
  const [one] = composeMerged([alone], { merge: true, cc: null });
  assert.deepEqual(one, { ...alone.items[0], title: "ESPN CO" }, "same id and L: ref, the title shown without '(Opc.2)'");
  const off = composeMerged([alone], { merge: false });
  assert.equal(off[0].title, "ESPN CO (Opc.2)", "as stored where merging is off (an old id, a bucket): its copies stay told apart");
  const copies = list("premiumtv", ["Caracol HD [Opc.2]", "Caracol HD [Opc.1]"], { prefix: "p" });
  const m = composeMerged([copies], { merge: true, cc: "co" });
  assert.equal(m.length, 1);
  assert.equal(m[0].title, "Caracol HD", "the primary is copy 1, its title without the marker");
  assert.equal(m[0].id, copies.items[1].id, "the primary's id");
  assert.deepEqual(membersOf(m[0]), [copies.items[1].ref, copies.items[0].ref], "the members' own refs");
});

// ── O1: live events ──

const EVENTS = JSON.parse(readFileSync(new URL("./fixtures/live-events-sample.json", import.meta.url), "utf8"));
const EV_ORDER = ["futbollibre", "deportv", "nuvio-sports", "cncverse", "supertv", "xuper"];
/** The fixture as composeMerged's member lists (events order), refs of their real length. */
function eventLists() {
  return EVENTS.lists.slice().sort((a, b) => EV_ORDER.indexOf(a.src) - EV_ORDER.indexOf(b.src)).map((l) => ({
    member: { src: l.src, rawCat: l.rawCat }, rank: EV_ORDER.indexOf(l.src),
    items: l.items.map((it) => {
      const base = "L:" + l.src + ":" + it.id;
      return { id: it.id, title: it.title, ref: base + "x".repeat(Math.max(0, it.refLen - base.length)), ...(it.start ? { start: it.start } : {}), ...(it.end ? { end: it.end } : {}), ...(it.origin ? { origin: it.origin } : {}) };
    }),
  }));
}
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const repeated = (items) => { const by = new Map(); for (const c of items) by.set(fold(c.title), (by.get(fold(c.title)) || 0) + 1); return [...by].filter(([, n]) => n > 1); };

/** I2 for events: every row of the union exactly once, by its `L:` ref or (a long ref) by its Kino id. */
function assertEventsI2(lists, out) {
  const byId = new Map(), union = new Set();
  for (const l of lists) for (const c of l.items) if (!byId.has(c.id)) { byId.set(c.id, c.ref); union.add(c.ref); }
  const seen = [];
  for (const c of out) {
    if (!c.ref.startsWith("M:")) { seen.push(c.ref); continue; }
    assert.ok(c.ref.length <= MERGED_REF_MAX, "merged ref " + c.ref.length);
    assert.ok(wrapped(c.id, c.ref).length <= 2048, "Kino stores it with a favourite");
    for (const m of decodeRef(c.ref).members) {
      if (m.ref) { assert.ok(m.ref.length <= 512); seen.push(m.ref); }
      else { assert.ok(byId.has(m.id), "a member written by id is a stored row: " + m.id); assert.ok(byId.get(m.id).length > 512, "only long refs go by id"); seen.push(byId.get(m.id)); }
    }
  }
  assert.equal(seen.length, new Set(seen).size, "no row twice");
  assert.deepEqual(seen.slice().sort(), [...union].sort(), "every row once");
  assert.equal(new Set(out.map((c) => c.id)).size, out.length, "ids unique");
}

test("live events (real titles, 2026-11-17 kit run): the same event is one channel; other sessions and other matches stay apart", () => {
  const lists = eventLists();
  const before = composeMerged(lists, { merge: false });
  assert.equal(before.length, 929);
  assert.equal(repeated(before).length, 67, "1.0.45's merged category: 67 titles shown more than once (142 extra copies)");
  const out = composeMerged(lists, { merge: false, events: true, now: EVENTS.at });
  // the kit run's own time: cncverse LivXow's "TENNIS EVENTO" (11-15 08:00, no end) is over, nothing else
  const over = (c) => c.title === "TENNIS EVENTO" && c.start === Date.UTC(2026, 10, 15, 8);
  assertEventsI2(lists.map((l) => ({ ...l, items: l.items.filter((c) => !over(c)) })), out);
  assert.equal(out.length, 786);
  assert.equal(repeated(out).length, 13, "13 titles left twice: other sessions, other days, 24/7 channels of two providers (no start)");
  const titleOf = new Map(lists.flatMap((l) => l.items.map((c) => [c.id, c.title])));
  const srcOf = new Map(lists.flatMap((l) => l.items.map((c) => [c.id, l.member.src + ":" + l.member.rawCat])));
  const idsOf = (c) => (c.ref.startsWith("M:") ? decodeRef(c.ref).members.map((m) => m.id || lists.flatMap((l) => l.items).find((x) => x.ref === m.ref).id) : [c.id]);
  const named = (t) => out.filter((c) => fold(c.title) === fold(t));
  // must merge
  assert.equal(idsOf(named("Singapore vs Brazil")[0]).length, 5, "five cncverse providers, one kick-off");
  assert.deepEqual(idsOf(named("Chile vs. Colombia · Caracol · 23:00 UTC")[0]).map((id) => srcOf.get(id).split(":")[0]), ["deportv", "deportv", "cncverse", "cncverse"], "deportv's two channels of the match and cncverse's copies");
  assert.deepEqual(idsOf(named("LIVE: Afghanistan vs Zimbabwe")[0]).map((id) => srcOf.get(id).split(":")[0]), ["nuvio-sports", "cncverse", "cncverse", "cncverse"]);
  assert.deepEqual(idsOf(named("Polonia vs Suecia — UEFA Nations League")[0]).map((id) => titleOf.get(id)), ["Polonia vs Suecia — UEFA Nations League", "Polonia vs. Suecia · ESPN 5 (720p) · 19:45 UTC"], "futbollibre's agenda leads, deportv's channel follows");
  // must not merge: other sessions under one title, one source's copies at other times, other days
  assert.deepEqual(named("NPL").map((c) => idsOf(c).length), [2, 2], "two NPL matches (06:45 and 11:15)");
  assert.equal(named("Tenis – Nitto ATP Finals – Día #3 — Tennis").length, 2, "futbollibre's 13:00 and 19:30 sessions");
  assert.deepEqual(named("Pakistan vs Sri Lanka").map((c) => idsOf(c).length).sort(), [1, 3], "nuvio's is the next day's play");
  assert.deepEqual(named("MotoGP").map((c) => idsOf(c).length).sort(), [1, 4], "nuvio's 24/7 channel (no start) stays apart; cncverse's four providers (10:40–10:45) are one session");
  assert.deepEqual(named("Russia vs Venezuela").map((c) => idsOf(c).length).sort(), [1, 3], "PlayZTV says 17:00, the others 16:00: not merged");
  assert.equal(named("PPV MAIN EVENT 01: Usyk vs Dubois").length + named("PPV MAIN EVENT 02: Usyk vs. Dubois").length, 2, "one source's slots with no start");
  for (const c of out) {
    const srcs = idsOf(c).map((id) => srcOf.get(id).split(":")[0]);
    const keys = new Set(idsOf(c).map((id) => eventKey(titleOf.get(id)).key));
    assert.equal(keys.size, 1, "one event title per channel: " + c.title);
    if (srcs.length > 1 && srcs.every((s) => s === "supertv")) assert.fail("supertv slots never merge: " + c.title);
  }
});

test("live events: the merge rule on its own (matches across sources, a start time inside one source)", () => {
  const ev = (src, title, start, opts = {}) => ({ member: { src, rawCat: opts.cat || "c" }, rank: EV_ORDER.indexOf(src), items: [{ id: src + "_" + (opts.id || Math.random().toString(36).slice(2, 8)), title, ref: "L:" + src + ":" + (opts.id || title.replace(/\W+/g, "-")) + "x".repeat(opts.len || 0), ...(start ? { start } : {}), ...(opts.adult ? { adult: true } : {}), ...(opts.origin ? { origin: opts.origin } : {}) }] });
  const T = Date.UTC(2026, 10, 17, 20, 0);
  const n = (lists) => composeMerged(lists, { merge: false, events: true, now: T + 30 * 60000 }).length;
  assert.equal(n([ev("nuvio-sports", "LIVE: Adelaide W vs Sydney Sixers W", 0, { id: "a" }), ev("cncverse", "Adelaide W vs Sydney Sixers W", T, { id: "b", len: 1200 })]), 1, "a match in two sources, one start unknown");
  assert.equal(n([ev("nuvio-sports", "Wales vs Portugal", T, { id: "a" }), ev("cncverse", "Wales vs Portugal", T + 20 * 60000, { id: "b" })]), 2, "both starts known, 20 min apart");
  assert.equal(n([ev("nuvio-sports", "Wales vs Portugal", T, { id: "a" }), ev("cncverse", "Wales vs Portugal", T + 10 * 60000, { id: "b" })]), 1, "10 min apart");
  assert.equal(n([ev("nuvio-sports", "Formula 1", 0, { id: "a" }), ev("cncverse", "Formula 1", T, { id: "b" })]), 2, "not a match and a start unknown");
  assert.equal(n([ev("nuvio-sports", "LIVE: Adelaide W vs Sydney Sixers W", 0, { id: "a", cat: "live" }), ev("nuvio-sports", "LIVE: Adelaide W vs Sydney Sixers W", 0, { id: "b", cat: "cricket" })]), 2, "one source, no start: not merged");
  assert.equal(n([ev("nuvio-sports", "LIVE: Adelaide W vs Sydney Sixers W", T, { id: "a", cat: "live" }), ev("nuvio-sports", "Adelaide W vs Sydney Sixers W", T, { id: "b", cat: "cricket" })]), 1, "one source, the same start");
  // The Redmi's "LIVE: Adelaide W vs Sydney Sixers W" ×2: two of nuvio's providers (dlv with a kick-off, ak47 without)
  assert.equal(n([ev("nuvio-sports", "LIVE: Adelaide W vs Sydney Sixers W", T, { id: "a", origin: "dlv" }), ev("nuvio-sports", "LIVE: Adelaide W vs Sydney Sixers W", 0, { id: "b", origin: "ak47" })]), 1, "two providers of one source: the same match");
  assert.equal(n([ev("nuvio-sports", "Willow Cricket", 0, { id: "a", origin: "ts" }), ev("nuvio-sports", "Willow Cricket", 0, { id: "b", origin: "vavoo" })]), 2, "two providers, not a match, no start: apart");
  assert.equal(n([ev("cncverse", "NPL", T, { id: "a", origin: "PlayFy" }), ev("cncverse", "NPL", T + 4.5 * 3600000, { id: "b", origin: "SportzX" })]), 2, "two providers, two NPL matches");
  assert.equal(n([ev("cncverse", "Chile vs Colombia", T, { id: "a" }), ev("nuvio-sports", "Colombia vs Chile", T, { id: "b" })]), 2, "two titles: never guessed");
  assert.equal(n([ev("cncverse", "Chile vs Colombia", T, { id: "a" }), ev("nuvio-sports", "Chile U17 vs Colombia U17", T, { id: "b" })]), 2, "another match");
  assert.equal(n([ev("xuper", "Fútbol | Chile vs Colombia", T, { id: "a" }), ev("xuper", "Fútbol | Perú vs Bolivia", T, { id: "b" }), ev("nuvio-sports", "Fútbol | Ecuador vs Uruguay", T, { id: "c" })]), 3, "two matches at one kick-off under one sport prefix");
  assert.equal(n([ev("xuper", "Fútbol | Chile vs Colombia", T, { id: "a" }), ev("nuvio-sports", "LIVE: Chile vs Colombia", 0, { id: "b" })]), 1, "the match after a prefix");
  assert.equal(n([ev("supertv", "EVENT 37:", 0, { id: "a" }), ev("nuvio-sports", "EVENT 37:", 0, { id: "b" })]), 2, "an empty slot never merges");
  assert.equal(n([ev("cncverse", "Chile vs Colombia", T, { id: "a" }), ev("nuvio-sports", "Chile vs Colombia", T, { id: "b", adult: true })]), 2, "adult never with non-adult");
  // a member whose ref is too long goes by its id; the merged ref stays short
  const out = composeMerged([ev("nuvio-sports", "Wales vs Portugal", T, { id: "a" }), ev("cncverse", "Wales vs Portugal", T, { id: "b", len: 2900 })], { merge: false, events: true, now: T });
  assert.equal(out.length, 1);
  assert.deepEqual(decodeRef(out[0].ref).members.map((m) => m.ref || m.id), ["L:nuvio-sports:a", "cncverse_b"]);
});

// ── merge pass 3 (review 2026-11-17) ──

test("copy markers stay where a listing never merges, or where two copies stay apart: no two channels show one title", () => {
  // Kino lists the remembered 1.0.45 id premiumtv.<hex('Sky Sports')> first, unmerged: seven copies of one channel
  const sky = list("premiumtv", [2, 3, 4, 5, 6, 7].map((n) => "Sky Sports LaLiga [Opc." + n + "]"), { prefix: "s" });
  const old = composeMerged([sky], { merge: false });
  assert.deepEqual(old.map((c) => c.title), sky.items.map((c) => c.title), "as stored: '[Opc.2]' … '[Opc.7]'");
  assert.deepEqual(old, sky.items, "ids and refs untouched");
  // a merged category: a pair that merges loses its markers; two copies kept apart (a ref too long to merge) keep them
  const tudn = list("premiumtv", ["TUDN [Opc.1]", "TUDN [Opc.2]"], { prefix: "t" });
  const far = list("premiumtv", ["L1 MAX [Opc.1]", "L1 MAX [Opc.2]"], { prefix: "l", len: 700 });
  const out = composeMerged([tudn, far], { merge: true, cc: "mx" });
  assert.deepEqual(out.map((c) => c.title), ["TUDN", "L1 MAX [Opc.1]", "L1 MAX [Opc.2]"]);
  assert.equal(new Set(out.map((c) => c.title)).size, out.length);
  // one copy alone in a merged category still loses its marker
  assert.deepEqual(composeMerged([list("premiumtv", ["Claro Sports HD (México) [Opc.3]"], { prefix: "c" })], { merge: true, cc: "mx" }).map((c) => c.title), ["Claro Sports HD (México)"]);
});

test("live events: a row with no start joins only the session that is on now, never tomorrow's of the same match", () => {
  // the kit's cricket series: dlv lists tomorrow's 04:30 while today's 04:30 is on; ak47 lists the live one with no start
  const T = Date.UTC(2026, 10, 17, 10, 30);
  const nuvio = { member: { src: "nuvio-sports", rawCat: "cricket" }, rank: 2, items: live.normalizeChannels("nuvio-sports", [
    { id: "dlv-pak-sl", title: "Pakistan vs Sri Lanka", start: Date.UTC(2026, 10, 18, 4, 30), origin: "dlv" },
    { id: "ak47-pak-sl", title: "LIVE: Pakistan vs Sri Lanka", origin: "ak47" },
  ]) };
  const cnc = { member: { src: "cncverse", rawCat: "cnc_SKTechLiveEvents_tv" }, rank: 3, items: live.normalizeChannels("cncverse", [
    { id: "sktech-pak-sl", title: "Pakistan vs Sri Lanka", start: Date.UTC(2026, 10, 17, 4, 30), end: Date.UTC(2026, 10, 17, 13, 0), origin: "SKTech" },
  ]) };
  const out = composeMerged([nuvio, cnc], { merge: false, events: true, now: T });
  const refsOf = (c) => (c.ref.startsWith("M:") ? decodeRef(c.ref).members.map((m) => m.ref) : [c.ref]);
  assert.deepEqual(out.map(refsOf), [["L:nuvio-sports:dlv-pak-sl"], ["L:nuvio-sports:ak47-pak-sl", "L:cncverse:sktech-pak-sl"]], "today's match: ak47 (no start) + SKTech; tomorrow's alone");
  // tomorrow's session alone: the start-less row never joins it
  const alone = composeMerged([{ ...nuvio }], { merge: false, events: true, now: T });
  assert.equal(alone.length, 2);
  // two sessions on: the start-less row joins the one that started closest to now
  const two = { member: { src: "cncverse", rawCat: "cnc_PlayFyLiveEvents_tv" }, rank: 3, items: live.normalizeChannels("cncverse", [
    { id: "playfy-early", title: "Pakistan vs Sri Lanka", start: T - 9 * 3600000, origin: "PlayFy" },
    { id: "playfy-late", title: "Pakistan vs Sri Lanka", start: T - 3600000, origin: "PlayFy" },
  ]) };
  const near = composeMerged([{ ...nuvio, items: nuvio.items.slice(1) }, two], { merge: false, events: true, now: T });
  assert.deepEqual(near.map(refsOf), [["L:nuvio-sports:ak47-pak-sl", "L:cncverse:playfy-late"], ["L:cncverse:playfy-early"]]);
});

test("live events: one stays listed while any of its copies is on (the latest stored end), and a start-only one for 14 h (a day of tennis, a cricket day)", () => {
  const T0 = Date.UTC(2026, 10, 17, 10, 30);
  const H = 3600000;
  // nuvio dlv's whole-day ATP rows (no end) and cncverse's 10:30→22:30 'ATP'; futbollibre's evening session at 19:30
  const nuvio = { member: { src: "nuvio-sports", rawCat: "tennis" }, rank: 2, items: live.normalizeChannels("nuvio-sports", [
    { id: "dlv-atp-d3", title: "LIVE: 2026 Nitto ATP Finals Round Robin, Day 3", start: T0, origin: "dlv" },
    { id: "dlv-pak-sl", title: "Pakistan vs Sri Lanka", start: Date.UTC(2026, 10, 17, 4, 30), origin: "dlv" },
  ]) };
  const cnc = { member: { src: "cncverse", rawCat: "cnc_PlayFyLiveEvents_tv" }, rank: 3, items: live.normalizeChannels("cncverse", [
    { id: "playfy-pak-sl", title: "Pakistan vs Sri Lanka", start: Date.UTC(2026, 10, 17, 4, 30), end: Date.UTC(2026, 10, 17, 13, 0), origin: "PlayFy" },
  ]) };
  const at = (iso) => composeMerged([nuvio, cnc], { merge: false, events: true, now: Date.parse(iso) });
  const titles = (out) => out.map((c) => c.title);
  assert.deepEqual(titles(at("2026-11-17T18:45:00Z")), ["LIVE: 2026 Nitto ATP Finals Round Robin, Day 3"], "8 h 15 min after its start: still on (the evening singles)");
  // the cricket match: dlv's copy (start only) stays inside the merged channel until cncverse's own end + 30 min
  const cricket = at("2026-11-17T12:45:00Z").find((c) => /Pakistan/.test(c.title));
  assert.deepEqual(decodeRef(cricket.ref).members.map((m) => m.ref), ["L:nuvio-sports:dlv-pak-sl", "L:cncverse:playfy-pak-sl"], "8 h 15 min after its start: both copies");
  assert.equal(at("2026-11-17T13:31:00Z").filter((c) => /Pakistan/.test(c.title)).length, 0, "over once its latest stored end passed");
  assert.equal(titles(at(new Date(T0 + 13.9 * H).toISOString())).length, 1, "a start-only event: 13.9 h, listed");
  assert.equal(titles(at(new Date(T0 + 14.1 * H).toISOString())).length, 0, "14.1 h: over");
});
