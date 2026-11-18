// What Xuper 2.x left in Kino, read by this version (src/legacy.js, src/catalog.js): library rows (magis1:… and the
// older gateway form) play and list on masnew with 2.x's numbering, live favourites (a bare channel code, xlive1:…)
// play the same masnew channel, `migrate` answers native values in 2.x's terms, and anything unreadable is not_found
// before any request. Written against the plugin's entry points (src/plugin.js) over a fake masnew portal speaking the
// real 3DES wire (test/helpers/seed-world.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { world, portalError, BEARER } from "./helpers/seed-world.mjs";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import("../src/plugin.js");
const { _resetUpgrade } = await import("../src/upgrade.js");
const { _resetLegacyMemory } = await import("../src/catalog.js");
const { decodeRef } = await import("../src/refs.js");
const { decodeMagis, encodeMagis, encodeChapter, legacyLiveCode, chaptersOf, findChapter, episodesAnswer, migrate } = await import("../src/legacy.js");
const { hashId, normalizeChannels, _setSources } = await import("../src/live.js");
const { clearBearer, notActivatedText } = await import("../src/api.js");
const xmod = await import("../src/sources/xuper.js");
const seeds = await import("../src/seeds.js");
const { fromLegacyHome, fromLegacyMatches, seal } = await import("../src/v2.js");
const { RELEASE_BASE, DATA_BASE } = await import("../src/config.js");

const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; _setSources(null); });

/** A device with the Bearer (unless `bearer: false`), a cold runtime, the masnew portal of seed-world. */
async function device(opts = {}) {
  const w = await world(opts);
  await clearBearer();
  if (opts.bearer !== false) w.kino.storage.set("o2:bearer", BEARER);
  else w.kino.storage.remove("o2:bearer");
  xmod._resetSession();
  seeds._newRuntime();
  _resetLegacyMemory();
  _resetUpgrade();
  return w;
}
const notFound = (e) => e.code === "not_found";
const notActivated = (lang) => (e) => e.code === "auth_required" && e.userMessage === notActivatedText(lang);

// A masnew season with two chapters and its sibling season.
const SEASON = {
  name: "Serie Uno T1", keyWords: "tt1234567", volumnCount: "2",
  simpleProgramList: [
    { seriesNumber: "1", contentId: "E1", name: "Serie Uno T1_1", duration: "00:42:00" },
    { seriesNumber: 2, contentId: "E2", name: "El regreso" },
  ],
  sameSeasonSeriesList: [{ contentId: "S1", seasonNumber: "1" }, { contentId: "S2", seasonNumber: "2" }],
};
const itemData = (data = SEASON) => ({ "v4/getItemData": () => ({ assetData: data }) });

// ═════════════ the refs ═════════════

test("decodeRef: 2.x's refs read as legacy (movie, chapter, gateway form) or legacyLive (bare, xlive1:); 3.x's are unchanged", () => {
  assert.deepEqual(decodeRef("magis1:movie:0:M42"), { kind: "legacy", contentId: "M42", programType: "movie", episode: 0, isSeries: false });
  assert.deepEqual(decodeRef("magis1:teleplay:3:S:1"), { kind: "legacy", contentId: "S:1", programType: "teleplay", episode: 3, isSeries: true }, "the contentId keeps its ':'");
  const gateway = Buffer.from(JSON.stringify({ s: "magis", p: { content_id: "777", program_type: "series", episode: 2 } }), "utf8").toString("base64url") + ".a1b2c3";
  assert.deepEqual(decodeRef(gateway), { kind: "legacy", contentId: "777", programType: "series", episode: 2, isSeries: true });
  assert.deepEqual(decodeRef("xlive1:odd code/1"), { kind: "legacyLive", code: "odd code/1" });
  assert.deepEqual(decodeRef("CH_123.hd"), { kind: "legacyLive", code: "CH_123.hd" });
  // this version's own refs (each has a ':')
  assert.equal(decodeRef("v:1:1").kind, "item");
  assert.deepEqual(decodeRef("v:1:1|720p"), { kind: "item", id: "1", type: "1", quality: "720p" });
  assert.equal(decodeRef("e:5:9").kind, "episode");
  assert.deepEqual(decodeRef("L:tvenvivo:https%3A%2F%2Fa.example%2Fx.m3u8"), { kind: "live", source: "tvenvivo", channel: "https://a.example/x.m3u8" });
  assert.equal(decodeRef("M:tvenvivo:a,caracol:b").members.length, 2);
  assert.equal(decodeRef("cat:pelicula").kind, "category");
  assert.equal(decodeRef("col:7").kind, "column");
  // neither
  for (const r of ["", "~x", "magis1:movie", "plg1:xuper:eyJhIjoxfQ", "a b", "x".repeat(129)]) assert.equal(decodeRef(r).kind, "unknown", JSON.stringify(r));
});

test("legacy refs as 2.x wrote them: encodeMagis/encodeChapter round-trip, findChapter by seriesNumber (<= 0 is the first)", () => {
  assert.equal(encodeMagis({ contentId: "S1", programType: "teleplay", episode: 0 }), "magis1:teleplay:0:S1");
  assert.equal(encodeChapter(7, "S1"), "magis1:teleplay:7:S1");
  assert.deepEqual(decodeMagis(encodeChapter(7, "S1")), { contentId: "S1", programType: "teleplay", episode: 7, isSeries: true });
  const raw = chaptersOf(SEASON, "S1");
  assert.equal(findChapter(raw.items, 2).contentId, "E2", "a numeric seriesNumber reads as its text");
  assert.equal(findChapter(raw.items, 0).contentId, "E1");
  assert.equal(findChapter(raw.items, 9), undefined);
  assert.equal(legacyLiveCode("magis1:movie:0:1"), null, "a VOD ref is never a channel");
});

// ═════════════ nothing to play: not_found before any request ═════════════

test("resolve and episodes of a ref that names nothing: not_found with 0 requests, activated or not", async () => {
  for (const bearer of [true, false]) {
    const w = await device({ bearer });
    for (const ref of ["~nope", "cat:pelicula", "col:7", "v::1", "plg1:xuper:eyJhIjoxfQ"]) {
      await assert.rejects(P.resolve(ref), notFound, "resolve " + ref);
    }
    for (const ref of ["~nope", "v::0", "magis1:movie:0:M42", "cat:series", "CH31"]) {
      await assert.rejects(P.episodes(ref), notFound, "episodes " + ref);
    }
    assert.equal(w.portal.length, 0, "no portal call");
  }
});

test("a 2.x title, chapter list or channel without activation: auth_required with the way in, 0 requests", async () => {
  const w = await device({ bearer: false, handlers: itemData() });
  for (const ref of ["magis1:movie:0:M42", "magis1:teleplay:2:S1", "CH31", "xlive1:odd code"]) {
    await assert.rejects(P.resolve(ref), notActivated("es"), ref);
  }
  await assert.rejects(P.episodes("magis1:teleplay:0:S1"), notActivated("es"));
  assert.equal(w.portal.length, 0);
});

// ═════════════ a 2.x library row plays and lists on masnew ═════════════

test("a 2.x movie plays by its own masnew id: v10/startPlayVOD (no series) + v14/getSlbInfo, never the backend's relay", async () => {
  const w = await device();
  const s = await P.resolve("magis1:movie:0:M42");
  const play = w.beans("v10/startPlayVOD");
  assert.equal(play.length, 1);
  assert.equal(play[0].contentId, "M42");
  assert.equal(play[0].seriesContentId, "");
  assert.equal(s.url, "https://vod.test/vod/t1_media.mp4");
  assert.equal(s.headers["Content-License"], "VLIC");
  assert.equal(s.mime, "video/mp4");
  assert.ok(!w.events.some((e) => /resolve/.test(e)), "no /resolve relay");
});

test("a 2.x chapter plays through its season's list (2.x's chapter path); its list is read once for episodes + play", async () => {
  const w = await device({ handlers: itemData() });
  const eps = await P.episodes("magis1:teleplay:0:S1");
  assert.equal(eps.episodes.length, 2);
  const s = await P.resolve(eps.episodes[1].ref);
  assert.equal(w.count("v4/getItemData"), 1, "the list episodes read serves the play");
  assert.equal(w.beans("v4/getItemData")[0].contentId, "S1");
  const play = w.beans("v10/startPlayVOD")[0];
  assert.equal(play.contentId, "E2");
  assert.equal(play.seriesContentId, "S1");
  assert.ok(s.url.endsWith("/vod/t1_media.mp4"));
  // a chapter the list no longer has
  await assert.rejects(P.resolve("magis1:teleplay:9:S1"), notFound);
  // the gateway form of the same season (a row from before the plugin) plays its first chapter
  const gateway = Buffer.from(JSON.stringify({ s: "magis", p: { content_id: "S1", program_type: "teleplay", episode: 0 } }), "utf8").toString("base64url") + ".ff";
  await P.resolve(gateway);
  assert.equal(w.beans("v10/startPlayVOD")[1].contentId, "E1");
});

test("2.x's episodes, numbered as 2.x numbered them (Kino keys progress by season and number), ES and EN", async () => {
  for (const lang of ["es", "en"]) {
    const w = await device({ handlers: itemData(), lang });
    const out = await P.episodes("magis1:teleplay:0:S1");
    assert.deepEqual(out.episodes, [
      { number: 1, title: lang === "en" ? "Episode 1" : "Capítulo 1", ref: "magis1:teleplay:1:S1", season: 1 },
      { number: 2, title: "El regreso", ref: "magis1:teleplay:2:S1", season: 1 },
    ], "a portal file name ('<series>_<n>') reads as the chapter's number");
    assert.deepEqual(out.seasons, [
      { id: "S1", ref: "magis1:teleplay:0:S1", title: lang === "en" ? "Season 1" : "Temporada 1", number: 1, current: true },
      { id: "S2", ref: "magis1:teleplay:0:S2", title: lang === "en" ? "Season 2" : "Temporada 2", number: 2, current: false },
    ]);
    assert.equal(w.portal.filter((r) => r.path === "v4/getItemData").length, 1);
  }
});

test("2.x's season numbering: a season the list does not name has no `season` (Kino reads 1); an empty list is season 1", () => {
  const m = decodeMagis("magis1:teleplay:0:S9");
  const notListed = episodesAnswer(m, chaptersOf({ ...SEASON, sameSeasonSeriesList: [{ contentId: "S1", seasonNumber: "1" }] }, "S9"), false);
  assert.ok(notListed.episodes.every((e) => !("season" in e)));
  const single = episodesAnswer(m, chaptersOf({ simpleProgramList: SEASON.simpleProgramList }, "S9"), false);
  assert.ok(single.episodes.every((e) => e.season === 1));
  assert.equal(single.seasons, undefined, "no sibling seasons: no chips");
  const third = episodesAnswer(m, chaptersOf({ ...SEASON, sameSeasonSeriesList: [{ contentId: "S9", seasonNumber: "3" }] }, "S9"), false);
  assert.ok(third.episodes.every((e) => e.season === 3), "a later season keeps its number: ::t3e<n>");
});

test("a 2.x title the portal no longer has (portal100006 / portal100004): not_found, Kino's 'ya no tiene este título'", async () => {
  let w = await device({ handlers: { "v4/getItemData": () => portalError("portal100006", "剧集不存在") } });
  await assert.rejects(P.episodes("magis1:teleplay:0:S1"), notFound);
  await assert.rejects(P.resolve("magis1:teleplay:1:S1"), notFound);
  w = await device({ handlers: { "v10/startPlayVOD": () => portalError("portal100004", "节目不存在") } });
  await assert.rejects(P.resolve("magis1:movie:0:M42"), notFound);
  assert.equal(w.count("v10/startPlayVOD"), 1);
});

// ═════════════ a 2.x live favourite plays the same masnew channel ═════════════

test("a 2.x channel (bare code, xlive1:) plays the same masnew channel through the live seam", async () => {
  const w = await device();
  const a = await P.resolve("ch31");
  assert.equal(w.beans("v4/startPlayLive")[0].channelCode, "ch31");
  assert.equal(a.url, "http://cdn1.test/live/pc1.m3u8");
  assert.equal(a.mime, "application/vnd.apple.mpegurl");
  await P.resolve("xlive1:odd code/1");
  assert.equal(w.beans("v4/startPlayLive")[1].channelCode, "odd code/1");
});

// ═════════════ migrate ═════════════

test("migrate answers native Xuper values in 2.x's terms (which this version plays); anything else is null", async () => {
  const w = await device({ bearer: false });
  assert.deepEqual(await P.migrate({ kind: "title", ref: "magis1:teleplay:5:S9" }), { kind: "series", id: "S9", ref: "magis1:teleplay:0:S9" });
  assert.deepEqual(await P.migrate({ kind: "title", ref: "magis1:movie:0:M1" }), { kind: "movie", id: "M1", ref: "magis1:movie:0:M1" });
  assert.deepEqual(await P.migrate({ kind: "chapter", ref: "magis1:teleplay:0:S9", season: 2, episode: 7 }),
    { kind: "episode", ref: "magis1:teleplay:7:S9", number: 7, season: 2 }, "a 'first chapter' ref takes the saved number");
  assert.deepEqual(await P.migrate({ kind: "chapter", ref: "magis1:teleplay:4:S9", season: null, episode: 7 }),
    { kind: "episode", ref: "magis1:teleplay:4:S9", number: 4 }, "the ref's own number wins");
  const id = normalizeChannels("xuper", [{ id: "ch31", title: "Canal" }])[0].id;
  assert.equal(id, "xuper_" + hashId("ch31"));
  assert.deepEqual(await P.migrate({ kind: "live", provider: "xuper", code: "ch31" }), { kind: "live", code: id }, "the id liveChannels gives it");
  assert.deepEqual(await P.migrate({ kind: "live", provider: "legacy", code: "ch31" }), { kind: "live", code: id });
  for (const input of [{ kind: "title", ref: "plg1:xuper:x" }, { kind: "title", ref: "v:1:1" }, { kind: "live", provider: "other", code: "x" },
    { kind: "chapter", ref: "magis1:teleplay:0:bad id" }, { kind: "x" }, null, "x"]) {
    assert.equal(await P.migrate(input), null, JSON.stringify(input));
  }
  assert.equal(migrate({ kind: "live", provider: "xuper", code: "ch" }, () => { throw new Error("boom"); }), null, "never throws");
  assert.equal(w.portal.length, 0, "pure: no request");
});

// ═════════════ categories ═════════════

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const legacyHome = JSON.parse(readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8"));
function storedCatalog() {
  const cat = seal(fromLegacyHome(legacyHome, { poster: "recommended" }), 1794844780749, sha256);
  const now = Date.now();
  return {
    "o2:cat": JSON.stringify(cat),
    "o2:catm": JSON.stringify({ h: cat.hash, gen: cat.gen, etag: '"e1"', lm: "", src: "rel", checkedAt: now, failAt: 0, failN: 0 }),
    "o2:ixm": JSON.stringify({ checkedAt: now, missingUntil: now + 3600000 }),
  };
}

test("categories: a tile per section of the stored catalog, opening its 'Ver más' (browse pages it); 18+ flagged; 0 requests", async () => {
  const k = installKino({ storage: storedCatalog(), noFetch: true });
  (await import("../src/data.js"))._resetMemory();
  _resetUpgrade();
  const tiles = await P.categories();
  assert.deepEqual(tiles.map((t) => [t.id, t.title, t.ref, !!t.adult]), [
    ["sec-populares", "Populares", "cat:populares", false],
    ["sec-adultos", "Adultos", "cat:adultos", true],
  ]);
  assert.match(tiles[0].art, /^https:\/\//);
  assert.equal(tiles[1].art, undefined, "no picture on the 18+ tile");
  for (const t of tiles) assert.match(t.id, /^[A-Za-z0-9._~-]{1,128}$/);
  const page = await P.browse(tiles[0].ref, null);
  assert.ok(page.items.length > 0, "the tile's ref pages through browse");
  k.kino.lang = "en";
  assert.equal((await P.categories())[0].title, "Popular");
  assert.equal(k.requests.length, 0);
});

test("categories with nothing stored: one revalidation, and a throw (Kino keeps its tiles) when it fails", async () => {
  const k = installKino({ routes: [(url) => (url.startsWith(DATA_BASE) || url.startsWith(RELEASE_BASE) ? res(503, "") : undefined)] });
  const data = await import("../src/data.js");
  data._resetMemory();
  _resetUpgrade();
  await assert.rejects(P.categories(), (e) => e.code === "unavailable");
  assert.ok(k.requests.some((r) => r.url.startsWith(RELEASE_BASE)));
});

// ═════════════ the sentences pass Kino's rules ═════════════

const KIT_DIR = process.env.KINO_SCREEN_KIT ? dirname(process.env.KINO_SCREEN_KIT) : join(homedir(), "kino-app/plugins/sdk");
test("the not-activated sentence (ES and EN) is one Kino shows (the kit's copy of PluginErrors.safeShape)", { skip: !existsSync(join(KIT_DIR, "kino-shim.mjs")) && "Kino's kit is not on this machine" }, async () => {
  const { shownSentence } = await import(pathToFileURL(join(KIT_DIR, "kino-shim.mjs")).href);
  for (const lang of ["es", "en"]) {
    const s = notActivatedText(lang);
    assert.equal(shownSentence({ code: "auth_required", userMessage: s }), s, lang);
  }
});
