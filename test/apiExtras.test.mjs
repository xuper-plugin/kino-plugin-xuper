// 2.2.15: what the Kino API offers that Xuper had left unused: row and live genres, 18+ search hits,
// the theme and the store categories, the section's hero, live countries, card ids learned from
// episodes(), and English through kino.lang. (Labels, expiresInSeconds and kino.tmdb: resolve.test.mjs
// and episodes.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkOutput, validateManifest } from "../sdk/contract.mjs";
import { contrast, resolvePalette } from "../sdk/palette.mjs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeCatalog, projectRows, ADULT_REF } from "../src/catalog.js";
import { classify, genreOfRow, localizedRowTitle } from "../src/homeClassifier.js";
import { makeSection, heroOf } from "../src/section.js";
import { makeCategories } from "../src/categories.js";
import { makeLiveCatalog, countryOfCategory } from "../src/liveCatalog.js";
import { makeIdsStore } from "../src/idsStore.js";
import { makeSettings } from "../src/settings.js";
import { mapPortalError, slowPortal } from "../src/portal.js";
import { TEXTS, say, sayAll, isEnglish } from "../src/i18n.js";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
const english = (k = fakeKino()) => Object.freeze({ ...k, lang: "en-US" });

const asset = (id, extra = {}) => ({ contentId: id, name: "T " + id, programType: "movie", tags: "Drama", score: 7, ...extra });
const assets = (prefix, n, extra = {}) => Array.from({ length: n }, (_, i) => asset(`${prefix}${i + 1}`, extra));
const column = (name, list, columnId = 1) => ({ columnId, name, assetList: list });
const answer = (...columns) => ({ recommendList: columns });
const withArt = (id, extra = {}) => asset(id, {
  posterList: [{ fileType: "icon", fileUrl: `https://img.example.com/${id}.jpg` }, { fileType: "poster", fileUrl: `https://img.example.com/${id}-wide.jpg` }],
  description: `La historia de ${id}.`, ...extra,
});

const roots = () => ({
  masnew_movies: answer(
    column("2026", [withArt("n1"), ...assets("n", 2)]),
    column("All", [...assets("pd", 6, { tags: "Drama" }), ...assets("doc", 6, { tags: "Documentary" })]),
  ),
  masnew_series: answer(column("All", assets("sd", 6, { programType: "teleplay" }))),
  masnew_anime: answer(column("All", assets("ac", 6, { programType: "series", tags: "Comedy" }))),
  masnew_kids: answer(column("All", assets("kf", 6, { tags: "Family" }))),
  masnew_adult: answer(column("All", [withArt("ad1"), ...assets("ad", 5, { programType: "movie" }), asset("ads1", { programType: "teleplay" })])),
});

// A portal that answers by path: the roots by columnCode, searches by query, details by contentId.
function world({ searches = {}, details = {}, kino = fakeKino() } = {}) {
  const calls = [];
  const byCode = roots();
  const portal = {
    calls,
    async call(path, bean) {
      calls.push({ path, bean });
      await Promise.resolve();
      if (path === "getNextColumns") return byCode[bean.columnCode];
      if (path === "v3/searchByName") return { searchItemList: [{ itemList: searches[bean.value] ?? [] }] };
      if (path === "v4/getItemData") {
        if (!details[bean.contentId]) throw new Error("unscripted detail " + bean.contentId);
        return details[bean.contentId];
      }
      throw new Error("unscripted " + path);
    },
  };
  const session = { ensure: async () => {}, withValidSession: async (block) => block({ userId: "u1", userToken: "tok1" }) };
  const clock = { t: NOW, now() { return this.t; } };
  const catalog = makeCatalog({ kino, portal, session, clock });
  return { kino, portal, calls, clock, catalog, section: makeSection({ kino, catalog, clock }), categories: makeCategories({ catalog, kino }) };
}

// ---- 3. genre on rows ---------------------------------------------------------------------------

test("genre: every classified row carries its root's genre; a documentary genre row is documentales; any other id none", () => {
  assert.equal(genreOfRow("magis_recent_peliculas"), "peliculas");
  assert.equal(genreOfRow("magis_new_series"), "series");
  assert.equal(genreOfRow("magis_top_series"), "series");
  assert.equal(genreOfRow("magis_g_anime_comedy"), "anime");
  assert.equal(genreOfRow("magis_g_infantil_family"), "infantil");
  assert.equal(genreOfRow("magis_g_peliculas_documentary"), "documentales");
  for (const id of ["live-country", "magis_adultos", "x", null]) assert.equal(genreOfRow(id), null);
});

test("genre: home rows carry it and the kit keeps it (only ids of the contract's closed list)", async () => {
  const w = world();
  const rows = await w.catalog.home();
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(["peliculas", "series", "anime", "infantil", "documentales"].includes(r.genre), r.id);
  assert.equal(rows.find((r) => r.id === "magis_g_peliculas_documentary").genre, "documentales");
  const checked = checkOutput("home", rows, manifest);
  assert.deepEqual(checked.value.map((r) => r.genre), rows.map((r) => r.genre));
  // Section rows are the same projection.
  const s = await w.section.section({ tab: "anime" });
  assert.ok(s.rows.every((r) => r.genre === "anime"));
});

// ---- 0. 18+ hits in search ---------------------------------------------------------------------

test("search: a hit the portal tags Adult (IMDb's adult genre) is adult: true; other tags are not", async () => {
  const w = world({ searches: {
    lust: [asset("S1", { name: "Lust One", tags: "Adult,Drama" }), asset("S2", { name: "Lust Two", tags: "Drama, adult " }), asset("S3", { name: "Lust Three", tags: "Drama,Adulthood" })],
  } });
  const out = await w.catalog.search({ q: "lust", type: "any" });
  assert.deepEqual(out.map((i) => [i.id, i.adult === true]), [["S1", true], ["S2", true], ["S3", false]]);
});

test("search: a hit the 18+ root lists (read in this sandbox) is adult: true, series included; before any read nothing is guessed", async () => {
  const w = world({ searches: { ad: [asset("ad1", { name: "Ad film" }), asset("ads1", { name: "Ad show", programType: "teleplay" }), asset("pd1", { name: "Ad drama" })] } });
  let out = await w.catalog.search({ q: "ad", type: "any" });
  assert.ok(out.every((i) => i.adult !== true), "the 18+ root was never read: no signal");
  await w.catalog.browse(ADULT_REF, null);
  // A new query (the first is cached, but the marks are applied at output time anyway).
  out = await w.catalog.search({ q: "ad", type: "any" });
  assert.deepEqual(out.map((i) => [i.id, i.adult === true]), [["ad1", true], ["ads1", true], ["pd1", false]]);
  assert.equal(w.calls.filter((c) => c.bean.columnCode === "masnew_adult").length, 1, "search never asks the 18+ root itself");
});

// ---- 6. theme, 8. store categories ---------------------------------------------------------------

test("theme: the icon's navy and blue, every color passes Kino's guardrails (none falls back)", () => {
  assert.deepEqual(manifest.theme, { accent: "#1E90F8", onAccent: "#050B2D", background: "#050B2D", surface: "#101A45", highlight: "#8FD0FF" });
  const palette = resolvePalette(manifest.theme);
  assert.deepEqual(palette.warnings, []);
  assert.deepEqual([...palette.kept].sort(), Object.keys(manifest.theme).sort());
  for (const token of Object.keys(manifest.theme)) assert.equal(palette[token], manifest.theme[token], token);
  assert.ok(contrast(manifest.theme.onAccent, manifest.theme.accent) >= 4.5);
  assert.ok(contrast(manifest.theme.accent, manifest.theme.background) >= 3);
  assert.ok(contrast(manifest.theme.highlight, manifest.theme.background) >= 4.5);
});

test("store categories: movies, series, anime and live, never adult; the manifest validates", () => {
  assert.deepEqual(manifest.categories, ["movies", "series", "anime", "live"]);
  assert.equal(manifest.apiVersion, 6);
  const v = validateManifest(JSON.stringify(manifest));
  assert.ok(v.ok !== false && !v.error, JSON.stringify(v).slice(0, 300));
});

// ---- 7. section hero -----------------------------------------------------------------------------

test("hero: the tab's first item with a backdrop and a synopsis, from rows already shown; no portal call of its own", async () => {
  const w = world();
  const s = await w.section.section({ tab: "peliculas" });
  assert.deepEqual(s.hero, { title: "T n1", text: "La historia de n1.", image: "https://img.example.com/n1-wide.jpg" });
  const before = w.calls.length;
  await w.section.section({ tab: "peliculas" });
  assert.equal(w.calls.length, before, "a warm section asks nothing, hero included");
  const checked = checkOutput("section", s, manifest);
  assert.equal(checked.value.hero.title, "T n1");
  // A tab with no item that has both: no hero.
  const anime = await w.section.section({ tab: "anime" });
  assert.equal("hero" in anime, false);
});

test("hero: never an 18+ item, and a long synopsis is cut at 300 characters", () => {
  const item = (id, extra) => ({ id, title: id, backdrop: "https://img.example.com/b.jpg", overview: "x", ...extra });
  assert.equal(heroOf([{ items: [item("a", { adult: true })] }]), null);
  assert.equal(heroOf([{ items: [item("a", { adult: true }), item("b")] }]).title, "b");
  assert.equal(heroOf([{ items: [item("a", { backdrop: undefined }), item("c", { overview: "  " })] }]), null);
  const long = heroOf([{ items: [item("d", { overview: "palabra ".repeat(80) })] }]);
  assert.equal(long.text.length, 300);
  assert.ok(long.text.endsWith("…"));
});

// ---- 8. live category country ---------------------------------------------------------------------

test("live country: a category named after one country gets its ISO code; Centroamérica, Todos and the rest none", async () => {
  assert.equal(countryOfCategory("Colombia"), "CO");
  assert.equal(countryOfCategory(" méxico "), "MX");
  assert.equal(countryOfCategory("Estados Unidos"), "US");
  for (const n of ["Centroamérica", "Todos", "Deportes", "Colombia Deportes"]) assert.equal(countryOfCategory(n), null, n);
  const kino = fakeKino();
  const portal = { call: async () => ({ recommendList: [{ columnId: 1, name: "ChannelList" }, { columnId: 2, name: "Colombia" }, { columnId: 3, name: "Centroamérica" }, { columnId: 4, name: "18+" }] }) };
  const session = { ensure: async () => {}, withValidSession: async (b) => b({ userId: "u", userToken: "t" }) };
  const live = makeLiveCatalog({ kino, portal, session, clock: { now: () => 0 } });
  const cats = await live.liveCategories();
  assert.deepEqual(cats, [{ id: "1", title: "Todos" }, { id: "2", title: "Colombia", country: "CO" }, { id: "3", title: "Centroamérica" }, { id: "4", title: "18+", adult: true }]);
  assert.equal(checkOutput("liveCategories", cats, manifest).value.categories[1].country, "CO");
});

// ---- 9. ids on cards -------------------------------------------------------------------------------

test("ids store: remembers imdb (+ tmdb once known), never tmdb 0, never a bad imdb; a later answer without TMDB keeps it; an empty imdb needs a tmdb", () => {
  const kino = fakeKino();
  const clock = { now: () => NOW };
  const ids = makeIdsStore({ kino, clock });
  ids.remember("A", "tt0088509");
  ids.remember("B", "tt0142032", 19566);
  ids.remember("C", "tt12", 5);
  ids.remember("D", "", 5);
  ids.remember("E", "", 0);
  let of = ids.lookup();
  assert.deepEqual(of("A"), { imdb: "tt0088509" });
  assert.deepEqual(of("B"), { imdb: "tt0142032", tmdb: 19566 });
  assert.equal(of("C"), null);
  assert.deepEqual(of("D"), { tmdb: 5 }, "2.2.21: a series TMDB named from its title carries only the tmdb id");
  assert.equal(of("E"), null, "an empty imdb with no tmdb names nothing");
  assert.equal(of("Z"), null);
  ids.remember("B", "tt0142032", 0);
  ids.remember("A", "tt0088509", 12);
  of = ids.lookup();
  assert.deepEqual(of("B"), { imdb: "tt0142032", tmdb: 19566 }, "a known tmdb id is kept");
  assert.deepEqual(of("A"), { imdb: "tt0088509", tmdb: 12 });
  // Bounded: one storage key, never over its budget.
  for (let i = 0; i < 400; i++) ids.remember(`K${i}`, "tt1234567", 1000 + i);
  assert.ok(kino.storage.get("ids:v1").length <= 10_000);
  assert.deepEqual(ids.lookup()("K399"), { imdb: "tt1234567", tmdb: 1399 });
});

test("ids on cards: after episodes() read a series' detail, home, browse, section and search carry its ids; no extra portal call per card", async () => {
  const series = "sd1";
  const detail = { assetData: { keyWords: "tt0088509", volumnCount: "1", sameSeasonSeriesList: [], simpleProgramList: [{ seriesNumber: "1", contentId: "E1", name: "Capítulo 1" }] } };
  const w = world({ details: { [series]: detail }, searches: { "T sd1": [asset("sd1", { name: "T sd1", programType: "teleplay" })] } });
  let rows = await w.catalog.home();
  const card = (list) => list.flatMap((r) => r.items).find((i) => i.id === series);
  assert.equal(card(rows).ids, undefined, "nothing known yet: no ids at all (never tmdb 0)");
  await w.catalog.episodes(`magis1:teleplay:0:${series}`);
  const before = w.calls.length;
  rows = await w.catalog.home();
  assert.deepEqual(card(rows).ids, { imdb: "tt0088509" }, "TMDB never matched: imdb only");
  const sec = await w.section.section({ tab: "series" });
  assert.deepEqual(card(sec.rows).ids, { imdb: "tt0088509" });
  const row = rows.find((r) => r.items.some((i) => i.id === series));
  const page = await w.catalog.browse(row.ref, null);
  assert.deepEqual(page.items.find((i) => i.id === series).ids, { imdb: "tt0088509" });
  assert.equal(w.calls.length, before, "home, section and browse asked the portal nothing for the ids");
  const hits = await w.catalog.search({ q: "T sd1", type: "any" });
  assert.deepEqual(hits.find((i) => i.id === series).ids, { imdb: "tt0088509" });
  assert.deepEqual(w.calls.slice(before).map((c) => c.path), ["v3/searchByName"], "search: its own query only");
  assert.equal(checkOutput("home", rows, manifest).drops.filter((d) => /ids|tmdb|imdb/.test(d)).length, 0);
});

// ---- 10. English through kino.lang --------------------------------------------------------------------

test("i18n: every text has Spanish and English, different, with the same placeholders; the language is read from kino.lang", () => {
  for (const [key, pair] of Object.entries(TEXTS)) {
    assert.equal(pair.length, 2, key);
    assert.ok(pair[0].trim() !== "" && pair[1].trim() !== "", key);
    const holes = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(holes(pair[0]), holes(pair[1]), key);
    if (!["settingsPlace", "statusShared"].includes(key) && !/^(Anime|Series)$/.test(pair[0])) assert.notEqual(pair[0], pair[1], key);
    assert.ok(!/\bvos\b|\bpodés\b|\btenés\b|\bquerés\b|\bhacé\b/i.test(pair[0]), `${key}: tuteo, never voseo`);
  }
  assert.equal(isEnglish({ lang: "en-US" }), true);
  assert.equal(isEnglish({ lang: "en" }), true);
  for (const lang of ["es-CO", "pt-BR", "", undefined, 5]) assert.equal(isEnglish({ lang }), false, String(lang));
  assert.equal(isEnglish(null), false);
  assert.equal(say({ lang: "en" }, "seasonN", { n: 2 }), "Season 2");
  assert.equal(say({ lang: "es-CO" }, "seasonN", { n: 2 }), "Temporada 2");
  assert.equal(say({ lang: "en" }, "fillEmail"), "Enter your email in Settings ▸ Xuper.");
  assert.deepEqual(sayAll("episodeGone"), ["Este capítulo ya no está disponible.", "This episode is no longer available."]);
});

test("i18n: home rows, section tabs, Categorías tiles and the NEW badge in English; Spanish stays as it was", async () => {
  const es = world();
  const en = world({ kino: english() });
  const esRows = await es.catalog.home();
  const enRows = await en.catalog.home();
  assert.deepEqual(enRows.map((r) => r.id), esRows.map((r) => r.id));
  const title = (rows, id) => rows.find((r) => r.id === id)?.title;
  assert.equal(title(esRows, "magis_recent_peliculas"), "Recién agregadas · Películas");
  assert.equal(title(enRows, "magis_recent_peliculas"), "Recently added · Movies");
  assert.equal(title(enRows, "magis_g_peliculas_documentary"), "Documentary · Movies");
  assert.equal(title(enRows, "magis_g_anime_comedy"), "Comedy · Anime");
  assert.equal(title(enRows, "magis_top_series"), "Top rated series");
  const s = await en.section.section(null);
  assert.deepEqual(s.tabs.map((t) => t.label), ["Movies", "Series", "Kids", "Anime"]);
  assert.deepEqual((await es.section.section(null)).tabs.map((t) => t.label), ["Películas", "Series", "Infantil", "Anime"]);
  const tiles = await en.categories.categories();
  assert.ok(tiles.some((t) => t.title === "Recently added · Movies"));
  assert.equal(tiles.at(-1).title, "18+");
  assert.equal(localizedRowTitle({ id: "unknown_row", title: "Lo que diga" }, true), "Lo que diga");
  // The new-upload badge.
  const fresh = { id: "f1", title: "F", type: "movie", poster: "", backdrop: "", description: "", genres: [], score: null, durationS: 0, shelvedAtMs: NOW - 1000 };
  const rowsOf = (english) => projectRows([{ id: "magis_recent_peliculas", title: "Recién agregadas · Películas", shown: [fresh] }], NOW, undefined, english);
  assert.deepEqual(rowsOf(true)[0].items[0].badges, ["NEW"]);
  assert.deepEqual(rowsOf(false)[0].items[0].badges, ["NUEVO"]);
});

test("i18n: the sentences the person reads (userMessage) follow kino.lang", () => {
  const en = english();
  assert.equal(mapPortalError("aaa100027", "", en, { accountLinked: true }).userMessage,
    "Your Xuper session ended and we could not sign back in with your account. Link it again in Settings ▸ Xuper.");
  assert.equal(mapPortalError("aaa100083", "", en, { accountLinked: true }).userMessage.startsWith("Your Xuper account was opened on another device"), true);
  assert.equal(mapPortalError("portal100006", "", en).userMessage, "This episode is no longer available.");
  assert.equal(mapPortalError("portal100006", "", en, { goneMessage: sayAll("seriesGone")[0] }).userMessage, "This series is no longer available.");
  assert.equal(slowPortal(en, en.error("unavailable", "x")).userMessage, "Xuper is not responding right now; try again in a few minutes.");
  const es = fakeKino();
  assert.equal(mapPortalError("portal100006", "", es).userMessage, "Este capítulo ya no está disponible.");
  assert.equal(slowPortal(es, es.error("unavailable", "x")).userMessage, "Xuper no responde en este momento; intenta de nuevo en unos minutos.");
});

test("i18n: the settings form (field errors, action errors) in English", async () => {
  const base = fakeKino({ config: { email: "", password: "" } });
  const kino = english(base);
  const settings = makeSettings({ kino, session: {}, clock: { now: () => NOW }, registration: null });
  assert.deepEqual(await settings.validateSettings({ email: "", password: "x" }), { email: "Enter your email" });
  assert.deepEqual(await settings.validateSettings({ email: "nope", password: "x" }), { email: "Enter a valid email" });
  await assert.rejects(() => settings.action("login"), (e) => e.userMessage === "Your account details are missing: fill them in Settings ▸ Xuper.");
  const es = makeSettings({ kino: base, session: {}, clock: { now: () => NOW }, registration: null });
  assert.deepEqual(await es.validateSettings({ email: "", password: "x" }), { email: "Escribe tu correo" });
});

test("i18n: live 'All', the country row and chapter/season names in English", async () => {
  const kino = english();
  const portal = { call: async () => ({ recommendList: [{ columnId: 1, name: "ChannelList" }] }) };
  const session = { ensure: async () => {}, withValidSession: async (b) => b({ userId: "u", userToken: "t" }) };
  const live = makeLiveCatalog({ kino, portal, session, clock: { now: () => 0 } });
  assert.deepEqual(await live.liveCategories(), [{ id: "1", title: "All" }]);
  const detail = { assetData: { keyWords: "", volumnCount: "1", sameSeasonSeriesList: [{ contentId: "sd1", seasonNumber: 1 }, { contentId: "sd9", seasonNumber: 2 }], simpleProgramList: [{ seriesNumber: "1", contentId: "E1", name: "" }] } };
  const w = world({ kino, details: { sd1: detail } });
  const out = await w.catalog.episodes("magis1:teleplay:0:sd1");
  assert.equal(out.episodes[0].title, "Episode 1");
  assert.deepEqual(out.seasons.map((s) => s.title), ["Season 1", "Season 2"]);
});

test("i18n: every userMessage, in both languages, passes Kino's sentence filter (the person reads it, never Kino's fallback)", async () => {
  const { shownSentence } = await import("../sdk/kino-shim.mjs");
  const keys = ["accountSessionLost", "accountInUseElsewhere", "episodeGone", "seriesGone", "portalSlow", "liveNeedsAccount", "sendCodeFailed",
    "requestNotSaved", "codeRefused", "fillAccount", "accountRefused", "fillEmail", "badEmail", "fillCode", "askCodeAgain"];
  for (const key of keys) {
    for (const lang of ["es-CO", "en-US"]) {
      const userMessage = say({ lang }, key);
      assert.equal(shownSentence({ code: "unavailable", userMessage }), userMessage, `${key} (${lang})`);
    }
  }
});
