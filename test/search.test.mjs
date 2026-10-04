import test from "node:test";
import { fixturesDir } from "./helpers/fixtures.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput } from "../sdk/contract.mjs";
import { makeCatalog } from "../src/catalog.js";
import { seasonFromName, sortSeasons } from "../src/search.js";
import { makeTmdb, parseTitleForms } from "../src/tmdb.js";
import { PortalError } from "../src/portal.js";
import { decode } from "../src/refs.js";

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));

// ---- fixtures ---------------------------------------------------------------------------------

// A portal search hit as v3/searchByName sends it.
const hit = (id, name, extra = {}) => ({ contentId: id, name, programType: "movie", ...extra });
const answer = (...hits) => ({ searchItemList: [{ itemList: hits }] });
const q = (text, extra = {}) => ({ q: text, type: "any", year: 0, season: 0, episode: 0, tmdbId: 0, originalTitle: "", altTitles: [], cursor: null, ...extra });

// Fake portal: a per-path FIFO queue (a value, an Error, or a function); records every call.
function fakePortal(queue = []) {
  const calls = [];
  const pending = [...queue];
  return {
    calls,
    values: () => calls.map((c) => c.bean.value),
    queue: (v) => pending.push(v),
    async call(path, bean, opts = {}) {
      calls.push({ path, bean, opts });
      await Promise.resolve();
      if (pending.length === 0) throw new Error("unscripted portal call " + JSON.stringify(bean.value));
      const a = pending.shift();
      const v = typeof a === "function" ? a(bean) : a;
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

function fakeSession({ ensureError = null } = {}) {
  const s = { ensures: 0, blocks: 0, order: [] };
  s.ensure = async () => { s.ensures++; s.order.push("ensure"); if (ensureError) throw ensureError; };
  s.withValidSession = async (block) => { s.blocks++; s.order.push("block"); return block({ userId: "u1", userToken: "tok1" }); };
  return s;
}

// kino over the kit's real storage, with spies (and an optional failure) on storage.set.
function spyKino({ failSet = false } = {}) {
  const base = fakeKino();
  const sets = [];
  const storage = Object.freeze({
    ...base.storage,
    set: (k, v, o) => {
      sets.push({ k, v, o });
      if (failSet) throw new Error("quota");
      return base.storage.set(k, v, o);
    },
  });
  return { kino: Object.freeze({ ...base, storage }), sets };
}

function setup({ queue = [], ensureError, tmdb = null, failSet = false, now = NOW } = {}) {
  const { kino, sets } = spyKino({ failSet });
  const portal = fakePortal(queue);
  const session = fakeSession({ ensureError });
  const clock = { t: now, now() { return this.t; } };
  const catalog = makeCatalog({ kino, portal, session, clock, tmdb });
  const cacheSets = () => sets.filter((s) => s.k === "search:v1");
  return { kino, portal, session, clock, catalog, sets, cacheSets };
}

const titles = (items) => items.map((i) => i.title);

// ---- kino.rank vs the native rule -------------------------------------------------------------
// The native MagisSearch rule, written out independently (MagisSearch.kt:15-118) to prove the SDK's
// `kino.rank` is equivalent for what search feeds it. DECISION: kino.rank is used as is.

const nativeTokens = (text) => {
  const plain = (text ?? "").toLowerCase().normalize("NFKD").replace(/\p{Mn}/gu, "");
  return new Set((plain.match(/[0-9a-z]+/g) ?? []).filter((w) => w.length > 2));
};
const nativeItemTokens = (it) => new Set([...nativeTokens(it.t), ...nativeTokens(it.a)]);
const inter = (a, b) => [...a].filter((x) => b.has(x)).length;
function nativeSort(items, forms) {
  const requested = forms.map(nativeTokens).filter((s) => s.size > 0);
  if (requested.length === 0) return items;
  const score = (it) => Math.max(...requested.map((r) => inter(r, nativeItemTokens(it))));
  return items.map((it, i) => ({ it, i, s: score(it) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.it);
}
function nativeFilter(items, forms) {
  const f = forms.map(nativeTokens).filter((s) => s.size > 0);
  if (f.length === 0) return items;
  return items.filter((it) => f.some((form) => inter(form, nativeItemTokens(it)) / form.size >= 0.6));
}
const nativeQuery = (text) => {
  const head = text.split(/[:,–—|]/)[0].trim();
  return head.length >= 3 ? head : text.trim();
};

test("kino.rank is the native rule: portalQuery, token sort and relevance filter agree on a seeded corpus", () => {
  const kino = fakeKino();
  for (const s of ["Avatar: Aang, El último Maestro Aire", "  Dune ", "El: algo más", "A, lo que sea", "Spider-Man: Un nuevo día",
    "Amor | Muerte", "Dune – Parte dos", "Dune — Parte dos", "", "   ", "Ñandú, el", "x", "Love, Death & Robots", "¿Corazón?"]) {
    assert.equal(kino.rank.shortQuery(s), nativeQuery(s), JSON.stringify(s));
  }
  const words = ["avatar", "último", "maestro", "aire", "Corazón", "El", "de", "la", "dune", "parte", "dos", "amor", "muerte", "ROBOTS",
    "Ñandú", "mañana", "spider-man", "2049", "ﬁnal", "Ångström", "nuit", "été", "x", ""];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const phrase = () => Array.from({ length: rnd(5) }, () => words[rnd(words.length)]).join(" ");
  const titlesOf = (it) => [it.t, it.a ?? ""];
  for (let round = 0; round < 300; round++) {
    const items = Array.from({ length: rnd(9) }, (_, i) => ({ c: "id" + i, t: phrase(), ...(rnd(2) ? { a: phrase() } : {}) }));
    const forms = Array.from({ length: 1 + rnd(3) }, phrase);
    const asNative = items.map((it) => ({ ...it, a: it.a ?? "" }));
    assert.deepEqual(kino.rank.sortBySimilarity(items, forms, titlesOf).map((x) => x.c), nativeSort(asNative, forms).map((x) => x.c), "sort " + round);
    assert.deepEqual(kino.rank.filterRelevant(items, forms, titlesOf).map((x) => x.c), nativeFilter(asNative, forms).map((x) => x.c), "filter " + round);
  }
});

// ---- the call pattern -------------------------------------------------------------------------

test("search asks v3/searchByName with the spec bean and the session credentials, ensure() first", async () => {
  const { catalog, portal, session } = setup({ queue: [answer(hit("M1", "Dune"))] });
  await catalog.search(q("Dune"));
  assert.equal(portal.calls.length, 1);
  const c = portal.calls[0];
  assert.equal(c.path, "v3/searchByName");
  assert.deepEqual(c.bean, { value: "Dune", type: "0", columnId: "", filter: "", pageNum: 1, pageSize: 20 });
  assert.deepEqual(c.opts, { baseFields: true, userId: "u1", userToken: "tok1" });
  assert.deepEqual(session.order, ["ensure", "block"]);
  assert.equal(session.ensures, 1);
});

test("the portal gets the title's head, split at the first of : , – — |; a head under 3 chars keeps the whole title", async () => {
  for (const [text, asked] of [
    ["Avatar: Aang, El ultimo Maestro Aire", "Avatar"], ["Spider-Man: Un nuevo dia", "Spider-Man"], ["  Bajo el mismo techo  ", "Bajo el mismo techo"],
    ["El: algo mas", "El: algo mas"], ["A, lo que sea", "A, lo que sea"], ["Dune – Parte dos", "Dune"], ["Dune | Parte dos", "Dune"],
  ]) {
    const { catalog, portal } = setup({ queue: [answer(), answer(), answer()] });
    await catalog.search(q(text));
    assert.equal(portal.values()[0], asked, text);
  }
});

test("an empty query answers [] with no portal call and no ensure", async () => {
  const { catalog, portal, session } = setup();
  assert.deepEqual(await catalog.search(q("   ")), []);
  assert.deepEqual(await catalog.search(null), []);
  assert.equal(portal.calls.length, 0);
  assert.equal(session.ensures, 0);
});

test("type is mapped like the native host: series -> tv, blank -> movie, null type and tmdbId read as a plain movie", async () => {
  const seasons = [hit("S1", "Naruto T1", { programType: "teleplay" }), hit("S2", "Naruto T2", { programType: "teleplay" })];
  // "series" behaves as tv: the season filter applies.
  let t = setup({ queue: [answer(...seasons)] });
  assert.deepEqual(titles(await t.catalog.search(q("Naruto", { type: "series", season: 2 }))), ["Naruto T2"]);
  // "movie" and blank do not filter seasons.
  t = setup({ queue: [answer(...seasons)] });
  assert.equal((await t.catalog.search(q("Naruto", { type: "movie", season: 2 }))).length, 2);
  t = setup({ queue: [answer(...seasons)] });
  assert.equal((await t.catalog.search(q("Naruto", { type: "", season: 2 }))).length, 2);
  t = setup({ queue: [answer(hit("D", "Dune"))] });
  const out = await t.catalog.search({ q: "Dune", type: null, tmdbId: null });
  assert.deepEqual(t.portal.values(), ["Dune"]);
  assert.equal(out.length, 1);
});

// ---- items ------------------------------------------------------------------------------------

test("item output: id, ref with the request's episode, kind, year, season, episodeCount, images; passes the SDK contract", async () => {
  const movie = hit("M1", "Dune", {
    releaseTime: "2021-10-22 00:00:00",
    posterList: [{ fileType: "stage", fileUrl: "https://img.test/stage" }, { fileType: "icon", fileUrl: "https://img.test/icon" },
      { fileType: "poster", fileUrl: "https://img.test/back" }, { fileType: "icon", fileUrl: "https://img.test/icon2" }],
  });
  const series = hit("S1", "Dragon Ball T3", { programType: "teleplay", volumnCount: "8" });
  const t = setup({ queue: [answer(movie), answer(series)] });
  const dune = (await t.catalog.search(q("Dune", { episode: 4 })))[0];
  assert.deepEqual(dune, {
    id: "M1", ref: "magis1:movie:4:M1", title: "Dune", kind: "movie", year: "2021", season: 0, episodeCount: 0,
    poster: "https://img.test/icon", backdrop: "https://img.test/back",
  });
  const out = await t.catalog.search(q("Dragon Ball", { episode: 4 }));
  assert.deepEqual(out[0], { id: "S1", ref: "magis1:teleplay:4:S1", title: "Dragon Ball T3", kind: "series", year: "", season: 3, episodeCount: 8 });
  const checked = checkOutput("search", [dune, ...out], manifest);
  assert.deepEqual(checked.drops, []);
  assert.equal(checked.value.items.length, 2);
});

test("a missing image type is not emitted; episodeCount falls back to updateCount, then 0; year needs 4 digits; title falls back to alias, then the id", async () => {
  const { catalog } = setup({ queue: [answer(
    { contentId: "A", name: "  ", alias: "Only alias", programType: "teleplay", updateCount: 5, volumnCount: null, releaseTime: "sin fecha" },
    { contentId: "B", name: "", viewPoint: "", alias: "" },
  )] });
  const out = await catalog.search(q("Only alias"));
  assert.deepEqual(out, [{ id: "A", ref: "magis1:teleplay:0:A", title: "Only alias", kind: "series", year: "", season: 1, episodeCount: 5 }]);
  // B has no title at all: it shares nothing with the query, so the relevance filter drops it.
});

test("an item with no contentId, or an id the SDK cannot take, is dropped without sinking the search", async () => {
  const { catalog } = setup({ queue: [answer({ name: "Dune" }, hit("bad id!", "Dune"), hit("M1", "Dune"))] });
  assert.deepEqual((await catalog.search(q("Dune"))).map((i) => i.id), ["M1"]);
});

test("the three portal shapes are flattened: searchItemList.itemList, else assetList, else list", async () => {
  const shapes = [
    { searchItemList: [{ itemList: [hit("A", "Dune")] }, { itemList: [hit("B", "Dune dos")] }] },
    { assetList: [hit("C", "Dune")] },
    { list: [hit("D", "Dune")] },
  ];
  const ids = [];
  for (const s of shapes) {
    const { catalog } = setup({ queue: [s] });
    ids.push((await catalog.search(q("Dune"))).map((i) => i.id));
  }
  assert.deepEqual(ids, [["A", "B"], ["C"], ["D"]]);
});

test("output is capped at 100 items", async () => {
  const batch = (p) => answer(...Array.from({ length: 20 }, (_, i) => hit(p + i, "Dune " + i)));
  const { catalog } = setup({ tmdb: { titleForms: async () => ({ title: "", originalTitle: "", englishTitle: "", spanishTitles: [] }) },
    queue: [batch("a"), batch("b"), batch("c"), batch("d"), batch("e"), batch("f")] });
  const out = await catalog.search(q("Dune", { tmdbId: 1, altTitles: ["Dune b", "Dune c", "Dune d", "Dune e", "Dune f"] }));
  assert.equal(out.length, 100);
});

// ---- rank, merge, fallback --------------------------------------------------------------------

test("relevance: look-alikes sharing one stray word are dropped, the best overlap goes first", async () => {
  const { catalog } = setup({ queue: [answer(
    hit("1", "El ultimo refugio"), hit("2", "Avatar: Aang, El ultimo Maestro Aire"), hit("3", "Amenaza en el aire"),
  )] });
  assert.deepEqual(titles(await catalog.search(q("Avatar: Aang, El ultimo Maestro Aire"))), ["Avatar: Aang, El ultimo Maestro Aire"]);
});

test("an item matches by its alias when the portal named it in Spanish", async () => {
  const { catalog } = setup({ queue: [answer(hit("1", "Antes del anochecer", { alias: "Before Midnight" }))] });
  assert.equal((await catalog.search(q("Before Midnight"))).length, 1);
});

test("pool merge: deduped by contentId, first seen wins, across queries", async () => {
  const { catalog, portal } = setup({
    tmdb: { titleForms: async () => ({ title: "Duna", originalTitle: "Dune", englishTitle: "", spanishTitles: [] }) },
    queue: [answer(hit("X", "Dune primera")), answer(hit("X", "Dune segunda"), hit("Y", "Duna"))],
  });
  const out = await catalog.search(q("Dune", { tmdbId: 5 }));
  assert.deepEqual(portal.values(), ["Dune", "Duna"]);
  assert.deepEqual(out.map((i) => [i.id, i.title]).sort(), [["X", "Dune primera"], ["Y", "Duna"]]);
});

test("the full-title query runs when the head found nothing relevant, and the seasons come back in order", async () => {
  const lookAlike = hit("L1", "Love");
  const s1 = hit("S1", "Love, Death & Robots T1", { programType: "teleplay" });
  const s2 = hit("S2", "Love, Death & Robots T2", { programType: "teleplay" });
  const { catalog, portal } = setup({ queue: [answer(lookAlike), answer(s2, s1)] });
  const out = await catalog.search(q("Love, Death & Robots", { type: "series" }));
  assert.deepEqual(portal.values(), ["Love", "Love, Death & Robots"]);
  assert.deepEqual(titles(out), ["Love, Death & Robots T1", "Love, Death & Robots T2"]);
});

test("a head that already finds the title makes no extra call; a one-word miss is not asked twice", async () => {
  let t = setup({ queue: [answer(hit("S1", "Avatar: Aang T1", { programType: "teleplay" }))] });
  await t.catalog.search(q("Avatar: Aang", { type: "series" }));
  assert.equal(t.portal.calls.length, 1);
  t = setup({ queue: [answer(hit("X", "Otra cosa"))] });
  assert.deepEqual(await t.catalog.search(q("Inexistente", { type: "movie" })), []);
  assert.equal(t.portal.calls.length, 1);
});

test("full-title fallback: whole forms not already asked, case-insensitive, deduped, at most 4", async () => {
  // Every head is under 3 chars, so each form is asked whole in the first pass: nothing is left to retry.
  const t = setup({ queue: Array.from({ length: 12 }, () => answer()) });
  await t.catalog.search(q("A, uno", { originalTitle: "B, dos", altTitles: ["a, UNO", "C, tres"] }));
  assert.deepEqual(t.portal.values(), ["A, uno", "B, dos", "C, tres"]);
  // Five distinct heads asked first; the fallback then asks the whole forms, capped at 4.
  const u = setup({ queue: Array.from({ length: 12 }, () => answer()) });
  await u.catalog.search(q("Love, uno", { altTitles: ["Amor, dos", "love, UNO", "Odio, tres", "Paz, cuatro", "Guerra, cinco"] }));
  assert.deepEqual(u.portal.values(), ["Love", "Amor", "Odio", "Paz", "Guerra", "Love, uno", "Amor, dos", "Odio, tres", "Paz, cuatro"]);
});

test("season filter: type tv/anime with season > 0 keeps the season asked, or everything when none matches", async () => {
  const s3 = hit("S3", "Naruto T3", { programType: "teleplay" });
  const s4 = hit("S4", "Naruto T4", { programType: "teleplay" });
  const film = hit("F", "Naruto La pelicula");
  let t = setup({ queue: [answer(s3, s4, film)] });
  assert.deepEqual(titles(await t.catalog.search(q("Naruto", { type: "tv", season: 4 }))), ["Naruto T4", "Naruto La pelicula"]);
  t = setup({ queue: [answer(s3, s4)] });
  assert.deepEqual(titles(await t.catalog.search(q("Naruto", { type: "anime", season: 9 }))), ["Naruto T3", "Naruto T4"]);
  t = setup({ queue: [answer(s3, s4)] });
  assert.equal((await t.catalog.search(q("Naruto", { type: "tv", season: 0 }))).length, 2);
});

test("seasonFromName reads T3, Temp.2, Temporada 4, S5; no suffix is season 1", () => {
  assert.equal(seasonFromName("Dragon Ball T3"), 3);
  assert.equal(seasonFromName("Dragon Ball Temp.2"), 2);
  assert.equal(seasonFromName("Dragon Ball Temporada 4"), 4);
  assert.equal(seasonFromName("Dragon Ball S5"), 5);
  assert.equal(seasonFromName("Dragon Ball"), 1);
  assert.equal(seasonFromName("Estoy T"), 1);
  assert.equal(seasonFromName("Test3"), 1, "no boundary inside a word");
  assert.equal(seasonFromName(null), 1);
});

test("sortSeasons: a series' seasons end up in order, movies do not shift, the first-seen series wins", () => {
  const it = (t, p) => ({ c: t, t, ...(p ? { p } : {}) });
  assert.deepEqual(
    sortSeasons([it("Pelicula A"), it("Dragon Ball T4", "teleplay"), it("Dragon Ball T2", "teleplay"), it("Pelicula B"), it("Dragon Ball T1", "teleplay")]).map((x) => x.t),
    ["Pelicula A", "Dragon Ball T1", "Dragon Ball T2", "Pelicula B", "Dragon Ball T4"],
  );
  assert.deepEqual(
    sortSeasons([it("Naruto T2", "teleplay"), it("Bleach T1", "teleplay"), it("Naruto T1", "teleplay")]).map((x) => x.t),
    ["Naruto T1", "Naruto T2", "Bleach T1"],
  );
});

// ---- errors -----------------------------------------------------------------------------------

test("a geo-blocked search is geo_blocked", async () => {
  const { catalog } = setup({ queue: [new PortalError("portal100024", "blocked"), new PortalError("portal100024", "blocked")] });
  await assert.rejects(() => catalog.search(q("Dune")), (e) => e.code === "geo_blocked");
});

test("a portal that never answers is unavailable (kino error or plain failure)", async () => {
  let t = setup({ queue: [new Error("timeout")] });
  await assert.rejects(() => t.catalog.search(q("Dune")), (e) => e.code === "unavailable");
  t = setup({ queue: [fakeKino().error("unavailable", "No se pudo contactar a Xuper")] });
  await assert.rejects(() => t.catalog.search(q("Dune")), (e) => e.code === "unavailable");
});

test("one failing query is not an error when another form answered; every query failing is", async () => {
  const tmdb = { titleForms: async () => ({ title: "Duna", originalTitle: "", englishTitle: "", spanishTitles: [] }) };
  let t = setup({ tmdb, queue: [new Error("down"), answer(hit("1", "Duna"))] });
  assert.deepEqual(titles(await t.catalog.search(q("Dune", { tmdbId: 3 }))), ["Duna"]);
  t = setup({ tmdb, queue: [new PortalError("aaa1", "no"), new PortalError("aaa1", "no")] });
  await assert.rejects(() => t.catalog.search(q("Dune", { tmdbId: 3 })), (e) => e.code === "unavailable");
});

test("a failing ensure() surfaces as its own error and no portal call is made", async () => {
  const { kino } = spyKino();
  const e = kino.error("auth_required", "Configura Xuper");
  const { catalog, portal } = setup({ ensureError: e, queue: [answer(hit("1", "Dune"))] });
  await assert.rejects(() => catalog.search(q("Dune")), (err) => err === e);
  assert.equal(portal.calls.length, 0);
});

test("an empty result is [] (no error)", async () => {
  const { catalog } = setup({ queue: [answer()] });
  assert.deepEqual(await catalog.search(q("zqxwv kino nada")), []);
});

// ---- title forms: TMDB and the SDK's own titles (R13) -----------------------------------------

test("TMDB-derived forms: localized, original, English and up to 3 Spanish ones are asked and ranked", async () => {
  const tmdb = { titleForms: async (type, id) => {
    assert.deepEqual([type, id], ["movie", 99]);
    return { title: "Sin camino a casa", originalTitle: "No Way Home", englishTitle: "Spider Home", spanishTitles: ["Uno", "Dos tres", "Cuatro cinco", "Seis siete"] };
  } };
  const { catalog, portal } = setup({ tmdb, queue: Array.from({ length: 8 }, () => answer(hit("A", "Spider-Man: La serie animada"), hit("B", "No Way Home"))) });
  const out = await catalog.search(q("Spider-Man Sin camino", { type: "movie", tmdbId: 99 }));
  assert.equal(out[0].title, "No Way Home", "the original form ranks the real one first");
  assert.deepEqual(portal.values().slice(0, 6), ["Spider-Man Sin camino", "Sin camino a casa", "No Way Home", "Spider Home", "Uno", "Dos tres"]);
  assert.ok(portal.values().includes("Cuatro cinco"), "the third Spanish form is still asked");
  assert.ok(!portal.values().includes("Seis siete"), "the fourth one is over the cap of 3");
});

test("TMDB type: movie only for movie, tv for anything else", async () => {
  const seen = [];
  const tmdb = { titleForms: async (type) => { seen.push(type); return null; } };
  for (const type of ["movie", "series", "anime", "any", ""]) {
    const { catalog } = setup({ tmdb, queue: [answer()] });
    await catalog.search(q("Dune", { type, tmdbId: 1 }));
  }
  assert.deepEqual(seen, ["movie", "tv", "tv", "tv", "movie"]);
});

test("R13: the SDK's originalTitle and altTitles (5 at most) feed the forms with NO TMDB at all, deduped case-insensitively", async () => {
  const { catalog, portal } = setup({ queue: Array.from({ length: 12 }, () => answer(hit("1", "Dune Original"))) });
  await catalog.search(q("Duna", { originalTitle: "Dune Original", altTitles: ["dune original", "Arrakis", "Uno 1", "Dos 2", "Tres 3", "Cuatro 4", "Cinco 5"] }));
  // forms: Duna, Dune Original, (dune original dup), Arrakis, Uno 1, Dos 2, Tres 3 (altTitles cut at 5)
  assert.deepEqual(portal.values().slice(0, 2), ["Duna", "Dune Original"]);
  const { catalog: c2, portal: p2 } = setup({ queue: [answer(hit("1", "Dune Original"))] });
  const out = await c2.search(q("Duna", { originalTitle: "Dune Original" }));
  assert.equal(out.length, 1, "found through the SDK's original title alone");
  assert.equal(p2.values()[0], "Duna");
});

test("R13: a failing TMDB (throwing, rejecting, null) is silent; the search still answers", async () => {
  for (const tmdb of [{ titleForms: async () => { throw new Error("boom"); } }, { titleForms: () => { throw new Error("sync"); } }, { titleForms: async () => null }, null]) {
    const { catalog } = setup({ tmdb, queue: [answer(hit("1", "Dune"))] });
    assert.equal((await catalog.search(q("Dune", { tmdbId: 7 }))).length, 1);
  }
});

// ---- src/tmdb.js ------------------------------------------------------------------------------

const tmdbBody = JSON.stringify({
  title: "Un mundo propio", original_title: "Own World",
  translations: { translations: [
    { iso_639_1: "es", iso_3166_1: "ES", data: { title: "Mi propio universo" } },
    { iso_639_1: "es", iso_3166_1: "MX", data: { title: "UN MUNDO PROPIO" } },
    { iso_639_1: "es", iso_3166_1: "AR", data: { title: "mi propio universo" } },
    { iso_639_1: "en", iso_3166_1: "US", data: { title: "Own World EN" } },
    { iso_639_1: "en", iso_3166_1: "GB", data: { title: "Second EN" } },
  ] },
});

test("parseTitleForms: movie vs tv fields, first English, distinct Spanish other than the localized title", () => {
  assert.deepEqual(parseTitleForms("movie", tmdbBody), {
    title: "Un mundo propio", originalTitle: "Own World", englishTitle: "Own World EN", spanishTitles: ["Mi propio universo"],
  });
  const tv = parseTitleForms("tv", JSON.stringify({ name: "Serie", original_name: "Show", translations: { translations: [{ iso_639_1: "en", data: { name: "Show EN" } }] } }));
  assert.deepEqual(tv, { title: "Serie", originalTitle: "Show", englishTitle: "Show EN", spanishTitles: [] });
  assert.equal(parseTitleForms("movie", "not json"), null);
  assert.equal(parseTitleForms("movie", "[]"), null);
});

function tmdbKino({ secret = () => "KEYMARKER", fetch }) {
  return { ...fakeKino(), secret, fetch };
}

test("makeTmdb: one GET to api.themoviedb.org with the secret MARKER in the query, never a key", async () => {
  const urls = [];
  const kino = tmdbKino({ fetch: async (url, opts) => { urls.push([url, opts]); return { ok: true, status: 200, text: () => tmdbBody }; } });
  const forms = await makeTmdb({ kino }).titleForms("movie", 438);
  assert.equal(forms.originalTitle, "Own World");
  const u = new URL(urls[0][0]);
  assert.equal(u.origin + u.pathname, "https://api.themoviedb.org/3/movie/438");
  assert.equal(u.searchParams.get("api_key"), "KEYMARKER");
  assert.equal(u.searchParams.get("language"), "es-MX");
  assert.equal(urls[0][1].cookies, false);
});

test("makeTmdb tolerates a missing key, a failing request and bad input: always null, never throws, no request without a key", async () => {
  let fetched = 0;
  const fetch = async () => { fetched++; return { ok: true, status: 200, text: () => tmdbBody }; };
  // kino.secret throws for an undeclared secret (the real SDK does):
  const noKey = tmdbKino({ secret: () => { throw new Error("este plugin no declara el secreto tmdbKey"); }, fetch });
  assert.equal(await makeTmdb({ kino: noKey }).titleForms("movie", 5), null);
  assert.equal(fetched, 0);
  // The stock fake kit does not declare tmdbKey either:
  assert.equal(await makeTmdb({ kino: { ...fakeKino(), fetch } }).titleForms("movie", 5), null);
  for (const bad of [
    tmdbKino({ fetch: async () => { throw new Error("net"); } }),
    tmdbKino({ fetch: async () => ({ ok: false, status: 404, text: () => "{}" }) }),
    tmdbKino({ fetch: async () => ({ ok: true, status: 200, text: () => "<html>" }) }),
  ]) assert.equal(await makeTmdb({ kino: bad }).titleForms("tv", 5), null);
  assert.equal(await makeTmdb({ kino: tmdbKino({ fetch }) }).titleForms("tv", 0), null);
  assert.equal(await makeTmdb({ kino: tmdbKino({ fetch }) }).titleForms("tv", "x"), null);
});

// ---- the cache (R14) --------------------------------------------------------------------------

const bytes = (s) => Buffer.byteLength(s, "utf8");

test("R14: a cache hit within 6 h makes no portal call (not even ensure); at 6 h it refetches", async () => {
  const t = setup({ queue: [answer(hit("1", "Dune")), answer(hit("1", "Dune"))] });
  const first = await t.catalog.search(q("Dune"));
  assert.equal(t.portal.calls.length, 1);
  t.clock.t += 6 * HOUR - 1;
  assert.deepEqual(await t.catalog.search(q("Dune")), first);
  assert.equal(t.portal.calls.length, 1, "fresh");
  assert.equal(t.session.ensures, 1);
  t.clock.t += 1; // exactly 6 h after the fetch (a hit does not renew the entry's age)
  await t.catalog.search(q("Dune"));
  assert.equal(t.portal.calls.length, 2, "stale after 6 h");
});

test("R14: one storage key, no ttlMs on it, keyed by the lowercased portal query (a different case hits)", async () => {
  const t = setup({ queue: [answer(hit("1", "Dune"))] });
  await t.catalog.search(q("Dune"));
  await t.catalog.search(q("DUNE"));
  assert.equal(t.portal.calls.length, 1);
  assert.ok(t.cacheSets().length >= 1);
  for (const s of t.cacheSets()) assert.equal(s.o, undefined);
  assert.deepEqual(t.kino.storage.keys().filter((k) => k.startsWith("search")), ["search:v1"]);
});

test("R14: an empty result is never cached", async () => {
  const t = setup({ queue: [answer(), answer()] });
  assert.deepEqual(await t.catalog.search(q("Inexistente")), []);
  assert.deepEqual(await t.catalog.search(q("Inexistente")), []);
  assert.equal(t.portal.calls.length, 2);
  assert.equal(t.cacheSets().length, 0);
});

test("R14: the key stays <= 24,000 bytes after 60 distinct queries, oldest evicted, newest kept", async () => {
  const t = setup({ queue: Array.from({ length: 60 }, (_, n) => answer(...Array.from({ length: 20 }, (_, k) => hit(
    `id${n}x${k}`, `Consulta numero ${n} elemento ${k} con un nombre bastante largo para pesar`,
    { alias: `Query ${n} item ${k} original-language alias`, programType: "teleplay", volumnCount: 12, releaseTime: "2019-01-01 00:00:00",
      posterList: [{ fileType: "icon", fileUrl: `https://img1.cdn.example/p/${n}/${k}/poster-icon-0123456789.jpg` },
        { fileType: "poster", fileUrl: `https://img1.cdn.example/p/${n}/${k}/poster-back-0123456789.jpg` }] },
  )))) });
  let max = 0;
  for (let n = 0; n < 60; n++) {
    await t.catalog.search(q(`Consulta numero ${n}`));
    t.clock.t += 1000;
    const stored = t.kino.storage.get("search:v1");
    max = Math.max(max, bytes(stored));
    assert.ok(bytes(stored) <= 24_000, `after query ${n}: ${bytes(stored)} bytes`);
  }
  const stored = JSON.parse(t.kino.storage.get("search:v1"));
  console.log(`# cache after 60 queries: ${bytes(t.kino.storage.get("search:v1"))} bytes, ${stored.e.length} entries, peak ${max}`);
  assert.ok(stored.e.length >= 2 && stored.e.length < 60);
  assert.equal(stored.e.at(-1).k, "consulta numero 59");
  assert.ok(!stored.e.some((e) => e.k === "consulta numero 0"), "the oldest was evicted");
  // The newest is a hit, the evicted one refetches.
  const calls = t.portal.calls.length;
  await t.catalog.search(q("Consulta numero 59"));
  assert.equal(t.portal.calls.length, calls);
});

test("R14: a hit moves the entry to the newest end (LRU), so a re-read entry outlives an untouched one", async () => {
  const t = setup({ queue: Array.from({ length: 3 }, (_, n) => answer(hit("i" + n, "Alfa " + n))) });
  await t.catalog.search(q("Alfa")); // key "alfa"
  t.clock.t += 10;
  t.portal.queue(answer(hit("b", "Beta uno")));
  await t.catalog.search(q("Beta"));
  t.clock.t += 10;
  await t.catalog.search(q("Alfa")); // hit: moves to the end
  assert.deepEqual(JSON.parse(t.kino.storage.get("search:v1")).e.map((e) => e.k), ["beta", "alfa"]);
});

test("R14: a storage that throws on set (quota) never fails the call", async () => {
  const t = setup({ failSet: true, queue: [answer(hit("1", "Dune"))] });
  assert.equal((await t.catalog.search(q("Dune"))).length, 1);
  assert.ok(t.cacheSets().length >= 1, "it did try to write");
});

test("R14: a corrupted or foreign stored value reads as an empty cache", async () => {
  for (const junk of ["not json", "{}", '{"v":2,"e":[]}', '{"v":1,"e":[{"k":1}]}', "[]"]) {
    const t = setup({ queue: [answer(hit("1", "Dune"))] });
    t.kino.storage.set("search:v1", junk);
    assert.equal((await t.catalog.search(q("Dune"))).length, 1);
    assert.equal(t.portal.calls.length, 1);
  }
});

// ---- the plugin export ------------------------------------------------------------------------

test("the cached search keeps a series' fields exactly (season, count, images) across a cache hit", async () => {
  const s = hit("S1", "Naruto T2", { programType: "teleplay", volumnCount: "20", releaseTime: "2005-01-01", posterList: [{ fileType: "icon", fileUrl: "https://img.test/i" }] });
  const t = setup({ queue: [answer(s)] });
  const a = await t.catalog.search(q("Naruto", { type: "tv", season: 2, episode: 3 }));
  const b = await t.catalog.search(q("Naruto", { type: "tv", season: 2, episode: 3 }));
  assert.deepEqual(a, b);
  assert.equal(t.portal.calls.length, 1);
});

// ---- the parity fixtures (git-excluded: read by absolute path, never copied) -------------------

const fixtureFiles = [1, 2, 3, 4].map((n) => `${fixturesDir}/search-${n}.json`);
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const canonical = (bean) => Object.keys(bean).sort().map((k) => `${k}=${bean[k]}`).join(",");

// What the retired device GatewayResult held, rebuilt from a plugin item plus the request (the
// Kotlin test's `rebuilt()`): nothing the device's result carried may be missing from the item.
function rebuilt(item, request) {
  const ref = decode(item.ref);
  const extra = { content_id: item.id, program_type: ref.programType, episode_count: String(item.episodeCount) };
  if (item.poster) extra.poster = item.poster;
  if (item.backdrop) extra.backdrop = item.backdrop;
  return {
    source: "magis", title: item.title, ref: item.ref, kind: request.type, lang: "", quality: "", sizeBytes: 0, seeders: 0,
    year: item.year, season: item.season, episode: ref.episode, extra,
  };
}

for (const [i, file] of fixtureFiles.entries()) {
  test(`parity: search-${i + 1}.json reproduces the device's captured results and portal calls`, async () => {
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    const request = fixture.request;
    const tmdbByPath = new Map(fixture.tmdb.map((c) => [c.path, c]));
    const tmdbCalls = [];
    const kino = tmdbKino({ fetch: async (url) => {
      const path = new URL(url).pathname;
      tmdbCalls.push(path);
      const c = tmdbByPath.get(path) ?? { code: 404, body: "{}" };
      return { ok: c.code >= 200 && c.code < 300, status: c.code, text: () => c.body };
    } });
    const portal = fakePortal(fixture.portal.map((c) => c.ok));
    const { kino: baseKino } = spyKino();
    const catalog = makeCatalog({ kino: { ...baseKino, secret: kino.secret, fetch: kino.fetch }, portal, session: fakeSession(), clock: { now: () => NOW }, tmdb: makeTmdb({ kino }) });
    const out = await catalog.search(q(request.q, { type: request.type, season: request.season, episode: request.episode, tmdbId: request.tmdbId }));

    assert.equal(fixture.expected.error, null);
    assert.deepEqual(sorted(out.map((item) => rebuilt(item, request))), sorted(fixture.expected.results));
    assert.deepEqual(
      portal.calls.map((c) => c.path + " " + canonical(c.bean)),
      fixture.portal.map((c) => c.path + " " + canonical(c.bean)),
    );
    const checked = checkOutput("search", out, manifest);
    assert.equal(checked.value.items.length, out.length, "the SDK contract keeps every item");
    for (const item of out) assert.equal(item.kind, decode(item.ref).isSeries ? "series" : "movie");
  });
}

test("parity: the four fixtures cover >3 results, a full-title fallback, an empty result and season > 0", () => {
  const all = fixtureFiles.map((f) => JSON.parse(readFileSync(f, "utf8")));
  assert.ok(all.some((f) => f.expected.results.length > 3));
  assert.ok(all.some((f) => f.portal.some((c) => c.bean.value.includes(",") || c.bean.value.includes(":")) && f.portal.length > 1));
  assert.ok(all.some((f) => f.expected.results.length === 0));
  assert.ok(all.some((f) => f.request.season > 0));
});
