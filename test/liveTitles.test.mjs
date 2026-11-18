// src/liveTitles.js: the title a live channel is shown with, without the panels' decorations (pure), and how it reaches
// Kino (src/liveMerge.js, src/live.js). Fixtures: real titles of the stored lists and device scrapes of 2026-11-16/17
// (supertv's zee-ott / znn8 / fv99 panels, premiumtv, deportv, the phone's "Deportes · España" and "Deportes" grids).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installKino } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", log() {}, config: {} };
const { shownTitles } = await import("../src/liveTitles.js");
const { composeMerged } = await import("../src/liveMerge.js");
const { decodeRef } = await import("../src/refs.js");
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");

/** One title shown alone in a list of country `cc` (null: a mixed list). */
const shown = (title, cc = null, en = false) => shownTitles([{ id: "a", title, ref: "L:x:1" }], { cc, en })[0].title;
/** A list's shown titles. */
const shownAll = (titles, opts = {}) => shownTitles(titles.map((title, i) => ({ id: "i" + i, title, ref: "L:x:" + i })), opts).map((c) => c.title);

// ── must strip (real titles) ──

const MUST_STRIP = [
  // supertv's znn8 panel, the phone's "Deportes · España" (2026-11-16)
  ["┃ES┃ M+ DEPORTES FHD HEVC", "es", "M+ DEPORTES FHD HEVC"],
  ["┃ES┃M+ REF FEDERACION FHD", "es", "M+ REF FEDERACION FHD"],
  ["┃ES┃ La liga TV HYPERMOTION 3 FHD", "es", "La liga TV HYPERMOTION 3 FHD"],
  ["┃ES┃ LA LIGA+ 7 (EVENTOS)", "es", "LA LIGA+ 7 (EVENTOS)"],
  ["┃ES┃ DAZN 1 FHD", "es", "DAZN 1 FHD"],
  ["┃UCL┃ CHAMPIONS LEAGUE", null, "CHAMPIONS LEAGUE"],
  // supertv's zee-ott panel
  ["ES ▎DAZN LALIGA FHD", "es", "DAZN LALIGA FHD"],
  ["ES ▎DAZN ACB 9", "es", "DAZN ACB 9"],
  ["ES ▎DAZN 1 FHD", null, "DAZN 1 FHD"],
  ["UK ▎SKY SPORTS PREMIER LEAGUE FHD", "gb", "SKY SPORTS PREMIER LEAGUE FHD"],
  ["MULTI  ▎ VIAPLAY", null, "VIAPLAY"],
  ["BEIN ▎BEIN SPORTS 1 HD S2", null, "BEIN SPORTS 1 HD S2"],
  ["BEIN ▎BEIN SPORTS 7 FHD ᴿᴬᵂ", null, "BEIN SPORTS 7 FHD ᴿᴬᵂ"],
  ["UEFA ▎ZIGGO SPORT HD [NL]", null, "ZIGGO SPORT HD"],
  ["UEFA ▎M+ L.CAMPEONES 2 SD [ES]", null, "M+ L.CAMPEONES 2 SD"],
  ["UEFA ▎BEIN SPORTS XTRA 1 HD  [AR]", null, "BEIN SPORTS XTRA 1 HD"],
  ["F1 ▎F1 TV 4k", null, "F1 TV 4k"],
  ["F1 ▎ SKY SPORTS F1 HD (UK)", null, "SKY SPORTS F1 HD"],
  ["F1 ▎ DAZN F1 FHD (ES)", "es", "DAZN F1 FHD"],
  ["MGP ▎MGP TV ON BOARD CAMERA 1 HD", null, "MGP TV ON BOARD CAMERA 1 HD"],
  ["EXYU ▎SPORT KLUB 1(HR)", null, "SPORT KLUB 1"],
  ["EXYU ▎ARENA SPORT PREMIUM 1 (SR) ◉ rec", null, "ARENA SPORT PREMIUM 1 ◉ rec"],
  ["SPORTS ▎STAR SPORTS 1 HD ENGLISH", null, "STAR SPORTS 1 HD ENGLISH"],
  ["SPORT ▎SUPERSPORT LA LIGA HD", null, "SUPERSPORT LA LIGA HD"],
  ["VIA ▎PREMIER LEAGUE 03:", null, "PREMIER LEAGUE 03:"],
  ["AR ▎SHAHID SPORT 1 FHD", null, "SHAHID SPORT 1 FHD"],
  ["CA ▎TSN 1 HD", null, "TSN 1 HD"],
  ["USA ▎RED BULL TV", null, "RED BULL TV"],
  // supertv's fv99 panel (the kit run of 2026-11-17): a code and a bracketed quality, both at the start
  ["ES: (FHD) M+ LALIGA TV 2", "es", "M+ LALIGA TV 2"],
  ["ES: LALIGA TV HYPERMOTION", "es", "LALIGA TV HYPERMOTION"],
  // Xuper's columns
  ["CO | Locales", null, "Locales"],
  ["[PE] Regionales", "pe", "Regionales"],
  ["MX: Regionales", "mx", "Regionales"],
  // premiumtv
  ["SBT (BR)", null, "SBT"],
  ["CazéTV (BR) [Geo-Blocked]", null, "CazéTV [Geo-Blocked]"],
  ["DSports (ECU)", null, "DSports"],
  ["TyC Sports Internacional (USA)", null, "TyC Sports Internacional"],
  ["UFC (EE.UU.) [EN]", null, "UFC [EN]"],
  ["FIFA+ (ES) (Internacional)", null, "FIFA+ (Internacional)"],
  ["MyTime Movie Network (México)(ES)", null, "MyTime Movie Network (México)"],
  ["Telemundo Deportes Ahora (Internacional)[1080p]", null, "Telemundo Deportes Ahora (Internacional)"],
  ["RT Noticias (HD)", null, "RT Noticias"],
  ["TVE Star HD (Auto)", null, "TVE Star HD"],
  ["TOP Barça [ES]", null, "TOP Barça"],
  // deportv's agenda
  ["Chile vs. Colombia · Caracol (720p) · 23:00 UTC", null, "Chile vs. Colombia · Caracol · 23:00 UTC"],
  // every other way the owner named (bars of every kind, "!", a code at the end, a code before a dash or a dot)
  ["|MX| ESPN", null, "ESPN"],
  ["│UK│ SKY SPORTS", null, "SKY SPORTS"],
  ["!ES! DAZN 1", null, "DAZN 1"],
  ["ESPN ┃MX┃", null, "ESPN"],
  ["ESPN ┃MX┃ HD", null, "ESPN HD"],
  ["ESPN | MX", null, "ESPN"],
  ["ES - DAZN 1", null, "DAZN 1"],
  ["CO • Caracol", null, "Caracol"],
  ["4K ▎ M+ LALIGA", null, "M+ LALIGA"],
  ["┃ES┃ ┃HD┃ DAZN 2", null, "DAZN 2"],
  ["ES ▎ ES ▎ DAZN 1", null, "DAZN 1"],
  ["[ES] ▎ DAZN 1", "es", "DAZN 1"],
];

test("must strip: the panels' decorations go from the shown title (real titles, every combination)", () => {
  assert.ok(MUST_STRIP.length >= 30);
  for (const [title, cc, want] of MUST_STRIP) assert.equal(shown(title, cc), want, JSON.stringify(title) + " in " + cc);
});

test("a tag wrapped in bars at the start, then a lead tag: both go (the SuperTV fixture's mixed decorations)", () => {
  assert.equal(shown("┃ES┃ ES: M+ DEPORTES", "es"), "M+ DEPORTES");
  assert.equal(shown("┃ES┃ ES: M+ DEPORTES", null), "M+ DEPORTES");
  assert.equal(shown("┃ES┃ MULTI ▎ VIAPLAY ┃ES┃", null), "VIAPLAY");
  assert.equal(shown("┃ES┃ ES ▎ DAZN 1", null), "DAZN 1");
  assert.equal(shown("!ES! ES - DAZN 1", null), "DAZN 1");
  // a name wrapped in bars is no tag: it stays
  assert.equal(shown("┃TV┃ NOTICIAS", null), "┃TV┃ NOTICIAS");
});

test("a name before a panel bar is no group: \"ESPN ▎MX\" is ESPN (the code after it goes), never \"MX\"", () => {
  assert.equal(shown("ESPN ▎MX", null), "ESPN");
  assert.equal(shown("ESPN ▎MX", "co"), "ESPN · México", "another country's code in a single-country list");
  assert.equal(shown("TUDN ▎MX", "mx"), "TUDN");
  assert.equal(shown("DAZN ▎ES", "es"), "DAZN");
  // a number after the bar: the word before it is the name, so nothing is taken
  assert.equal(shown("DAZN ▎ 2", null), "DAZN ▎ 2");
  // a group still goes when a name follows it
  assert.equal(shown("BEIN ▎BEIN SPORTS 1 HD S2", null), "BEIN SPORTS 1 HD S2");
  assert.equal(shown("SPORTS ▎STAR SPORTS TAMIL", null), "STAR SPORTS TAMIL");
});

// ── Kino's engine ──

/** A "\-" (an even number of backslashes before it): QuickJS's libregexp of 2024-02-14 refuses it in a "u" pattern. */
const quickjsRefuses = (source) => /(?<!\\)(?:\\\\)*\\-/.test(source);
/** A regular-expression literal in the bundle: [whole, source, flags] (a rough scan; it only has to find the "u" ones). */
const LITERAL = /\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\/\\\n\[*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\/\\\n\[])*)\/([dgimsuvy]*)/g;

test("Kino's QuickJS can load the bundle: no \"u\" pattern holds \"\\-\" (QuickJS 2024-02-14 refuses it; Node accepts it)", async () => {
  // Kino builds QuickJS from bellard's 2024-02-14 (36911f0d): `new RegExp("[a\\-b]", "u")` throws "invalid escape
  // sequence in regular expression" there, so a pattern built at load time leaves the whole plugin dead on devices
  // while every Node test stays green. Every pattern the bundle builds while it loads, and every literal, is checked.
  assert.ok(quickjsRefuses("[!\\[(:\\-–]") && quickjsRefuses("\\-") && quickjsRefuses("[\\\\\\-]"));
  assert.ok(!quickjsRefuses("[!\\[(:–-]") && !quickjsRefuses("[\\\\-z]") && !quickjsRefuses("a-b"));
  const built = [];
  const Real = globalThis.RegExp;
  const note = ([p, f]) => built.push([p instanceof Real ? p.source : String(p), f === undefined ? (p instanceof Real ? p.flags : "") : String(f)]);
  globalThis.RegExp = new Proxy(Real, {
    construct(target, args) { note(args); return Reflect.construct(target, args); },
    apply(target, self, args) { note(args); return Reflect.apply(target, self, args); },
  });
  try { await import("../plugin.js?quickjs-patterns"); } finally { globalThis.RegExp = Real; }
  const u = built.filter(([, f]) => f.includes("u"));
  assert.ok(u.some(([s]) => s.includes("┃")), "the title patterns are built while the bundle loads");
  for (const [s] of u) assert.ok(!quickjsRefuses(s), "new RegExp(" + JSON.stringify(s) + ", \"u\")");
  const bundle = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
  let literals = 0;
  for (const [whole, source, flags] of bundle.matchAll(LITERAL)) {
    if (!flags.includes("u")) continue;
    literals++;
    assert.ok(!quickjsRefuses(source), whole);
  }
  assert.ok(literals >= 5, String(literals));
});

// ── must keep (real names) ──

const MUST_KEEP = [
  // a code that is part of a name, or the whole title
  "ES", "UK Gold", "MX Prime", "ESPN CO", "FOX HN [Inestable]", "Tigo Sports HD BO [Inestable]", "FOX GUA",
  // a name with a number
  "TV3", "A3", "Canal 13", "24 Horas", "Deportes13 (Chile)",
  // a quality word inside the name (left as it is: the merge already picks the best copy)
  "DAZN 1 FHD", "M+ LA LIGA 4K UHD",
  // brackets that are no code or tag: a country written out, a language, a note, an institution
  "Claro Sports HD (México)", "Real Madrid TV (España)", "beIN Sports (EN)", "TOP Barça [EN]", "NEW K-MOVIES (SUB)",
  "FUEL TV (Internacional) [SUB]", "Canal Once HD (IPN) (Nacional)", "Mundo Deportivo [No 24/7]", "[spo] Emirates Dubai Racing 1",
  "MLB TEAMS : Seattle Mariners HD (SEA)", "Yu-Gi-Oh! (España)", "Multivisión Sports -Clasicos- (Guatemala) [No 24/7]",
  // a word before ":" that is no region code
  "RUN:TIME Cine y Series", "WWE: Raw", "LIVE: WWE NXT", "NHL : ANAHEIM DUCKS", "EPL : PROTIME EPL HIGHLIGHTS",
  // a bar between two names, events with their league and date
  "DANIEL RICCIARDO | RB", "Fútbol | Chile vs Colombia", "ESPN | Fútbol", "TV ▎ NOTICIAS",
  "SOCCER 18: Spain. LaLiga 2 | Albacete Balompie vs. RC Celta de Vigo B | Monday. 16 November 2026 19:30",
  "Davis Cup Finals – Final | Bologna, Italy | 29 November 2026",
  "ATP - Doubles: Harri Heliovaara / Henry Patten vs Marcelo Arevalo / Mate Pavic",
  // copy markers stay for src/liveMerge.js to decide
  "Caracol HD [Opc.1]", "Las Estrellas HD (Nacional)[V2](Opc.3)",
  // nothing would be left: the title as stored
  "┃ES┃", "ES ▎", "(HD)", "[ES]", "|MX|", "",
];

test("must keep: a real name is never touched, and a title is never emptied", () => {
  for (const title of MUST_KEEP) assert.equal(shown(title), title, JSON.stringify(title));
  for (const title of MUST_KEEP) assert.equal(shown(title, "es"), title, JSON.stringify(title) + " in Spain's list");
});

// ── countries ──

test("countries: the list's own goes; another country's stays in a single-country list; a mixed list drops it", () => {
  assert.equal(shown("┃ES┃ DAZN 1", "es"), "DAZN 1", "Spain's own tag in 'Deportes · España'");
  assert.equal(shown("[ES] DAZN 1", "es"), "DAZN 1");
  assert.equal(shown("LATAM | ESPN 2", "co"), "ESPN 2", "a neutral tag simply goes");
  assert.equal(shown("UEFA ▎TNT SPORTS 1 HD [UK]", null), "TNT SPORTS 1 HD");
  // a foreign feed in a single-country list says something
  assert.equal(shown("┃MX┃ ESPN", "co"), "ESPN · México", "a lead tag shows as a suffix");
  assert.equal(shown("┃MX┃ ESPN", "co", true), "ESPN · Mexico", "in English");
  assert.equal(shown("ESPN (MX)", "co"), "ESPN (MX)", "a bracketed one stays as written");
  // a mixed list: dropped while no other channel looks the same
  assert.equal(shown("┃MX┃ ESPN", null), "ESPN");
  assert.equal(shown("ESPN (MX)", null), "ESPN");
});

test("collisions: only the titles that would look the same get their country back, a step at a time", () => {
  // a lead tag comes back as a suffix, in the list's language
  assert.deepEqual(shownAll(["ESPN", "┃MX┃ ESPN", "┃AR┃ ESPN 2"]), ["ESPN", "ESPN · México", "ESPN 2"]);
  assert.deepEqual(shownAll(["ESPN", "┃MX┃ ESPN"], { en: true }), ["ESPN", "ESPN · Mexico"]);
  // every one that collided gets its own back: a lead tag as a suffix, a bracketed one as written
  assert.deepEqual(shownAll(["ES ▎DAZN F1 FHD", "F1 ▎ DAZN F1 FHD (ES)", "PT ▎DAZN F1 FHD"]),
    ["DAZN F1 FHD · España", "DAZN F1 FHD (ES)", "DAZN F1 FHD · Portugal"]);
  // case and accents aside: "FOX Sports 2" and "Fox Sports 2" look the same; a bracketed code comes back as written
  assert.deepEqual(shownAll(["Fox Sports 2", "FOX Sports 2 (USA)", "FOX Sports 3 (USA)"]), ["Fox Sports 2", "FOX Sports 2 (USA)", "FOX Sports 3"]);
  // Belgian DAZN's [NL] / [FR] are languages: never "· Países Bajos" — as written
  assert.deepEqual(shownAll(["BE ▎DAZN 1 FHD [NL]", "BE ▎DAZN 1 FHD [FR]", "BE ▎DAZN 2 FHD [NL]"]),
    ["DAZN 1 FHD [NL]", "DAZN 1 FHD [FR]", "DAZN 2 FHD"]);
  // FIFA+'s languages (premiumtv's "FIFA+" category, real)
  assert.deepEqual(shownAll(["FIFA+ (Internacional)", "FIFA+ (ES) (Internacional)", "FIFA+ (EN) (Internacional)", "FIFA+ (PT) (Internacional)"]),
    ["FIFA+ (Internacional)", "FIFA+ (ES) (Internacional)", "FIFA+ (EN) (Internacional)", "FIFA+ (PT) (Internacional)"]);
  // copies of one source that differ by a bracketed tag only stay told apart
  assert.deepEqual(shownAll(["RT Noticias (HD)", "RT Noticias (SD)", "RT Noticias (Auto)"]), ["RT Noticias (HD)", "RT Noticias (SD)", "RT Noticias (Auto)"]);
  // an unnamed code ("AR" is Arabic on supertv) comes back as written
  assert.deepEqual(shownAll(["SHAHID SPORT 1", "AR ▎SHAHID SPORT 1"]), ["SHAHID SPORT 1", "AR ▎SHAHID SPORT 1"]);
  // in a list of one country its own tag never comes back as a suffix
  assert.deepEqual(shownAll(["┃ES┃ DAZN 1", "ES ▎DAZN 1"], { cc: "es" }), ["┃ES┃ DAZN 1", "ES ▎DAZN 1"], "two copies kept apart: as stored");
  // never more titles that look the same than before
  const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const dups = (a) => a.length - new Set(a.map(fold)).size;
  const grid = JSON.parse(readFileSync(new URL("./fixtures/live-lists-sample.json", import.meta.url), "utf8")).lists;
  for (const l of grid) {
    const titles = l.titles;
    assert.ok(dups(shownAll(titles)) <= dups(titles), l.src + ":" + l.rawCat);
  }
});

test("copies stored alike never bring the decorations back: no step tells them apart (real supertv lists)", () => {
  // the panel lists some channels twice under one name: they once stepped back to the stored title, bar included
  assert.deepEqual(shownAll(["AL ▎SUPER SPORT 7 HD", "AL ▎SUPER SPORT 7 HD"]), ["SUPER SPORT 7 HD", "SUPER SPORT 7 HD"]);
  assert.deepEqual(shownAll(["SPORTS ▎STAR SPORTS TAMIL", "SPORTS ▎STAR SPORTS 3", "SPORTS ▎STAR SPORTS TAMIL"]),
    ["STAR SPORTS TAMIL", "STAR SPORTS 3", "STAR SPORTS TAMIL"]);
  // nor drag the item they collide with along: Portugal's feed gets its country, Spain's copies get theirs
  assert.deepEqual(shownAll(["ES ▎DAZN 1", "ES ▎DAZN 1", "PT ▎DAZN 1"]), ["DAZN 1 · España", "DAZN 1 · España", "DAZN 1 · Portugal"]);
  // supertv's zee-ott "AR ▎SHAHID SPORT" category as listed (2026-11-17): no bar left, no more duplicates than stored
  const shahid = ["AR ▎SHAHID SPORT 1 4K", "AR ▎SHAHID SPORT 1 HD", "AR ▎SHAHID SPORT 1 SD", "AR ▎SHAHID SPORT 2 4K", "AR ▎SHAHID SPORT 2 HD",
    "AR ▎SHAHID SPORT 2 SD", "AR ▎SHAHID SPORT 1 FHD", "AR ▎SHAHID SPORT 1 HD", "AR ▎SHAHID SPORT 2 FHD", "AR ▎SHAHID SPORT 2 HD",
    "AR ▎SHAHID SPORT 3 FHD", "AR ▎SHAHID SPORT 3 HD", "AR ▎SHAHID SPORT 4 FHD", "AR ▎SHAHID SPORT 4 HD", "AR ▎SHAHID SPORT 5 FHD",
    "AR ▎SHAHID SPORT 5 HD"];
  const out = shownAll(shahid);
  assert.deepEqual(out, shahid.map((t) => t.replace("AR ▎", "")));
  // copies told apart by something else still are: the stored titles differ
  assert.deepEqual(shownAll(["┃ES┃ DAZN 1", "ES ▎DAZN 1"], { cc: "es" }), ["┃ES┃ DAZN 1", "ES ▎DAZN 1"]);
});

test("only `title` changes: same ids, refs, logos, order, and the same object when nothing changes", () => {
  const items = [
    { id: "supertv_1", title: "ES ▎DAZN 1 FHD", ref: "L:supertv:1", logo: "https://l/1.png", adult: false },
    { id: "premiumtv_2", title: "Caracol", ref: "L:premiumtv:2" },
    { id: "supertv_3", title: "┃MX┃ ESPN", ref: "M:supertv:3,supertv2:9" },
  ];
  const out = shownTitles(items, { cc: null });
  assert.deepEqual(out.map((c) => ({ ...c, title: undefined })), items.map((c) => ({ ...c, title: undefined })));
  assert.equal(out[1], items[1], "unchanged: the very same object");
  assert.deepEqual(out.map((c) => c.title), ["DAZN 1 FHD", "Caracol", "ESPN"]);
  assert.equal(items[0].title, "ES ▎DAZN 1 FHD", "the input is never changed");
});

// ── through the merge: copy markers and decorations together ──

test("in a merging category: copy markers and decorations go together; copies kept apart keep their markers, not the tags", () => {
  const item = (src, raw, title) => ({ id: src + "_" + raw, title, ref: "L:" + src + ":" + raw });
  const one = composeMerged([{ member: { src: "supertv", rawCat: "1" }, rank: 0, items: [item("supertv", "1", "ES: (FHD REPUESTO) DAZN F1"), item("supertv", "2", "ES ▎DAZN F1 FHD")] }], { merge: true, cc: "es" });
  assert.equal(one.length, 1);
  assert.equal(one[0].title, "DAZN F1 FHD", "the primary (FHD, copy 1) without its tag");
  assert.equal(one[0].id, "supertv_2");
  assert.deepEqual(decodeRef(one[0].ref).members.map((m) => m.ref), ["L:supertv:2", "L:supertv:1"]);
  // two copies an adult flag keeps apart: their markers tell them apart, the region tag still goes
  const apart = composeMerged([{ member: { src: "premiumtv", rawCat: "c" }, rank: 0, items: [
    item("premiumtv", "a", "┃CO┃ Caracol HD [Opc.1]"), { ...item("premiumtv", "b", "┃CO┃ Caracol HD [Opc.2]"), adult: true }] }], { merge: true, cc: "co" });
  assert.deepEqual(apart.map((c) => c.title), ["Caracol HD [Opc.1]", "Caracol HD [Opc.2]"]);
  // a category that never merges keeps the copy markers, loses the tags
  const off = composeMerged([{ member: { src: "xuper", rawCat: "c" }, rank: 0, items: [item("xuper", "1", "CO | Caracol [Opc.1]"), item("xuper", "2", "CO | Caracol [Opc.2]")] }], { merge: false });
  assert.deepEqual(off.map((c) => c.title), ["Caracol [Opc.1]", "Caracol [Opc.2]"]);
  assert.deepEqual(off.map((c) => c.ref), ["L:xuper:1", "L:xuper:2"]);
});

// ── favourites: Kino's LiveChannelIdentity (kino-app origin/main, app/src/main/java/com/arkiv/player/data/live/) ──

/** Kino's PluginRef.encode for a live item: `plg1:<plugin>:` + base64url of {"id","k","r"}. */
const wrapped = (id, ref) => "plg1:xuper:" + Buffer.from(JSON.stringify({ id, k: "live", r: ref }), "utf8").toString("base64url");
const unwrap = (w) => { const m = /^plg1:([^:]+):(.+)$/.exec(w); if (!m) return null; const j = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8")); return { pluginId: m[1], ref: j.r }; };
/** LiveChannelIdentity.normalizedName: accents dropped, case folded, spaces collapsed and trimmed (nothing else). */
const normalizedName = (n) => String(n).normalize("NFD").replace(/\p{Mn}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const sameName = (a, b) => { const x = normalizedName(a); return x !== "" && x === normalizedName(b); };
const sameRef = (a, b) => { const ra = unwrap(a), rb = unwrap(b); return !!ra && !!rb && ra.pluginId === rb.pluginId && ra.ref !== "" && ra.ref === rb.ref; };
/** LiveChannelIdentity.find → [channel, how]: the id when the names agree, else the saved ref, else the saved name. */
function find(saved, listed) {
  const atCode = listed.find((c) => c.code === saved.code);
  if (atCode && sameName(atCode.name, saved.name)) return [atCode, "id+name"];
  const byRef = saved.ref && listed.find((c) => sameRef(c.ref, saved.ref));
  if (byRef) return [byRef, "ref"];
  const byName = listed.find((c) => sameName(c.name, saved.name));
  return byName ? [byName, "name"] : [null, "none"];
}

test("favourites: a channel saved under its decorated title is found by its unchanged ref (Kino never strips tags from names)", () => {
  assert.notEqual(normalizedName("┃ES┃ DAZN 1 FHD"), normalizedName("DAZN 1 FHD"), "Kino's name check does not ignore the tag");
  const item = (src, raw, title) => ({ id: src + "_" + raw, title, ref: "L:" + src + ":" + raw });
  const lists = [
    { member: { src: "supertv", rawCat: "1" }, rank: 4, items: [item("supertv", "11", "┃ES┃ DAZN 1 FHD"), item("supertv", "12", "┃ES┃ DAZN 1 HD"), item("supertv", "13", "ES ▎M+ LALIGA TV UHD"), item("supertv", "14", "ES ▎BETIS TV")] },
    { member: { src: "supertv2", rawCat: "9" }, rank: 5, secondary: true, items: [item("supertv2", "91", "ES: (FHD) M+ LALIGA TV")] },
  ];
  // what 1.0.46 listed (decorations kept): the titles a favourite was saved with
  const before = new Map(lists.flatMap((l) => l.items.map((c) => [c.id, c.title])));
  const now = composeMerged(lists, { merge: true, cc: "es" });
  assert.deepEqual(now.map((c) => c.title), ["DAZN 1 FHD", "M+ LALIGA TV UHD", "BETIS TV"]);
  const listed = now.map((c) => ({ code: c.id, name: c.title, ref: wrapped(c.id, c.ref) }));
  for (const c of now) {
    const saved = { code: c.id, name: before.get(c.id), ref: wrapped(c.id, c.ref) };
    const [hit, how] = find(saved, listed);
    assert.equal(hit && hit.code, c.id, before.get(c.id));
    assert.equal(how, "ref", "the name changed; the same plugin and raw ref find it");
    assert.ok(wrapped(c.id, c.ref).length <= 2048, "Kino stores the ref with the favourite");
  }
  // the same channel under a shown title that did not change is still found by id and name
  const plain = composeMerged([{ member: { src: "caracol", rawCat: "all" }, rank: 1, items: [item("caracol", "c1", "Caracol TV")] }], { merge: true, cc: "co" });
  assert.deepEqual(find({ code: plain[0].id, name: "Caracol TV", ref: wrapped(plain[0].id, plain[0].ref) }, plain.map((c) => ({ code: c.id, name: c.title, ref: wrapped(c.id, c.ref) })))[1], "id+name");
});

// ── through Kino's liveChannels and the screen: the language is part of the composed page ──

function storedLive(registry, lists) {
  const now = Date.now();
  const st = {};
  const lc = { v: 1, src: {} }, lm = { v: 1, c: {}, l: {} };
  for (const [src, cats] of Object.entries(registry)) { lc.src[src] = { at: now, cats }; lm.c[src] = { at: now, failAt: 0, failN: 0 }; }
  for (const [key, items] of Object.entries(lists)) {
    const text = JSON.stringify(items);
    st["o2:ll:" + key] = text;
    lm.l[key] = { at: now, h: String(text.length), n: items.length, w: now, failAt: 0, failN: 0 };
  }
  st["o2:lc"] = JSON.stringify(lc);
  st["o2:lm"] = JSON.stringify(lm);
  return st;
}

test("Kino's liveChannels and the own screen show the same clean titles; a suffix follows a language switch; refs never change", async () => {
  const panel = { id: "supertv", name: "SuperTV", genre: "deportes", async categories() { return []; }, async channels() { return []; }, async resolve() { return { url: "http://x.test/a.m3u8" }; } };
  live._setSources([panel]);
  const cats = [{ id: "7", title: "UEFA ▎CHAMPIONS LEAGUE" }];
  const raw = [{ id: "1", title: "UEFA ▎M+ L.CAMPEONES HD [ES]" }, { id: "2", title: "UEFA ▎TNT SPORTS 1 HD [UK]" }, { id: "3", title: "┃ES┃ DAZN 1" }, { id: "4", title: "┃PT┃ DAZN 1" }];
  const k = installKino({ noFetch: true, storage: { "o2:bearer": "bearer-token", ...storedLive({ supertv: cats }, { [live.listKey("supertv", "7")]: live.normalizeChannels("supertv", raw) }) } });
  await clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  ls._resetMemory();
  beginCall();
  try {
    const exposed = await live.liveCategories();
    const cat = exposed.find((c) => c.id === "v.sp.eu");
    assert.ok(cat, "UEFA's category: " + exposed.map((c) => c.id).join(","));
    const page = await live.liveChannels({ categoryId: cat.id, cursor: null });
    assert.deepEqual(page.items.map((c) => c.title), ["M+ L.CAMPEONES HD", "TNT SPORTS 1 HD", "DAZN 1 · España", "DAZN 1 · Portugal"]);
    const refs = page.items.map((c) => [c.id, c.ref]);
    assert.deepEqual(refs.map(([, r]) => r), ["L:supertv:1", "L:supertv:2", "L:supertv:3", "L:supertv:4"]);
    const screen = await live.screenList(cat.id);
    assert.deepEqual(screen.items.map((c) => c.title), page.items.map((c) => c.title), "the own screen's tiles (Vivo, Fútbol ▸ Canales) are the same rows");
    k.kino.lang = "en";
    beginCall();
    const en = await live.screenList(cat.id);
    assert.deepEqual(en.items.map((c) => c.title), ["M+ L.CAMPEONES HD", "TNT SPORTS 1 HD", "DAZN 1 · Spain", "DAZN 1 · Portugal"]);
    assert.deepEqual(en.items.map((c) => [c.id, c.ref]), refs, "ids and refs as in Spanish");
  } finally {
    k.kino.lang = "es";
    live._setSources(null);
  }
});
