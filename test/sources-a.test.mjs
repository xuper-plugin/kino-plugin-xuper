// Connector group A (spec §5.1 / Step 2): tvenvivo, caracol, cablevisionhd and premiumtv (src/sources/m3u.js), run
// through src/live.js with a fake Kino (same runtime across calls) and recorded payloads in test/fixtures/sources-a/:
//   caracol-livechannels.json  TRAY/LIVECHANNELS of 2026-11-16, reduced to the fields the connector reads
//   cablevisionhd-parrilla.html the 75 channel-card anchors of the 2026-11-16 grid (the page is about 680 KB)
//   premiumtv-sample.m3u        50 real entries of IPTVSV.m3u (2026-11-16), with EXTVLCOPT / KODIPROP lines
//   tvenvivo-core.html          www.tvenvivo.org/live/core.php?canal=azteca7 of 2026-11-17, reduced to its markup (the
//                               anti-iframe script and styles are gone; the signature is a same-shape fake)
//   tvenvivo-player.html        that iframe's player page (~660 KB of obfuscated script, kept: its first line and the
//                               tail that names the playlist; the token is a same-shape fake)
//   tvenvivo-refused.txt        what the same player page answered (200) to a request without the site's Referer
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const live = await import("../src/live.js");
const { hexEnc } = await import("../src/liveMap.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { liveRef } = await import("../src/refs.js");
const { sourceById } = await import("../src/sources/index.js");
const tvMod = await import("../src/sources/tvenvivo.js");
const tvenvivo = tvMod.default;
const caracol = (await import("../src/sources/caracol.js")).default;
const cvMod = await import("../src/sources/cablevisionhd.js");
const cablevisionhd = cvMod.default;
const m3u = await import("../src/sources/m3u.js");
const premiumtv = sourceById("premiumtv");

const fixture = (name) => readFileSync(new URL("./fixtures/sources-a/" + name, import.meta.url), "utf8");
const CARACOL_JSON = fixture("caracol-livechannels.json");
const PARRILLA = fixture("cablevisionhd-parrilla.html");
const M3U = fixture("premiumtv-sample.m3u");
const M3U_URL = "https://raw.githubusercontent.com/JMigue85/IPTV-SV/refs/heads/main/IPTVSV.m3u";

const M = 60_000, H = 60 * M, D = 24 * H;
const sha16 = (t) => createHash("sha1").update(t, "utf8").digest("hex").slice(0, 16);
const hostOf = (u) => { try { return new URL(u).host; } catch (_) { return ""; } };

/** A device: a fresh fake Kino with a Bearer, a cold live memory, and a new call. */
async function device(opts = {}) {
  const storage = { ...(opts.storage || {}), "o2:bearer": "bearer-token" };
  const k = installKino({ ...opts, storage });
  k.kino.cookies = { get: (url, name) => (name === "playback_token" ? "tok-123" : "") };
  await clearBearer();                       // drops api.js's memo AND the stored session: put it back
  k.kino.storage.set("o2:bearer", "bearer-token");
  k.writes.length = 0;
  ls._resetMemory();
  beginCall();
  return k;
}

/** A new plugin call in the same runtime (L0 kept) or, with `cold`, a fresh runtime over the same storage. */
function nextCall(k, { cold = false } = {}) {
  if (cold) ls._resetMemory();
  k.requests.length = 0;
  k.writes.length = 0;
  beginCall();
}

/** Runs `fn(clock)` with Date.now on a clock the test moves, then restores it. */
function onClock(fn) {
  const real = Date.now;
  const clock = { now: real() };
  Date.now = () => clock.now;
  return Promise.resolve().then(() => fn(clock)).finally(() => { Date.now = real; });
}

test.afterEach(() => live._setSources(null));

// ── tvenvivo: code categories and lists; resolve asks the player page as the site's iframe and remembers it per
// channel; only a re-resolve checks the playlist (off air: the first 404 ends it) ──

const TV_CORE = (canal, dir) => `<html><iframe src="https://p.example/${dir}/stream.php?canal=${canal}&amp;sig=abc"></iframe></html>`;
const TV_PLAYER_URL = (canal, dir = "live") => `https://p.example/${dir}/stream.php?canal=${canal}&sig=abc`;
const AS_IFRAME = { Referer: "https://www.tvenvivo.org/", "Sec-Fetch-Dest": "iframe" };
const TOKEN = "a".repeat(40) + "-" + "b".repeat(32) + "-1794897855-1794876255";
const TV_PLAYER = (n) => `<script>var src = "https:\\/\\/deportes.example\\/playlist\\/${n}\\/index.m3u8?token=${TOKEN}";</script>`;
const manifestOf = (n) => `https://deportes.example/playlist/${n}/index.m3u8?token=${TOKEN}`;

function tvRoutes({ manifest = 200, brokenSkins = [] } = {}) {
  return [(url) => {
    const core = /tvenvivo\.org\/(live\d?)\/core\.php\?canal=([^&]+)/.exec(url);
    if (core) return brokenSkins.includes(core[1]) ? res(200, "<html>no player here</html>") : res(200, TV_CORE(core[2], core[1]));
    if (/p\.example\/live\d?\/stream\.php/.test(url)) return res(200, TV_PLAYER(7));
    if (url === manifestOf(7)) return res(manifest, manifest === 200 ? "#EXTM3U" : "not found");
    return undefined;
  }];
}

test("tvenvivo: categories and lists are code (0 requests), ids are 1.0.43's, titles in ES and EN", async () => {
  live._setSources([tvenvivo]);
  const k = await device({ noFetch: true });
  const raw = await tvenvivo.categories();
  assert.equal(raw.length, 11);
  assert.deepEqual(raw[0], { id: "deportes", title: "Deportes" });
  // through the mapping (src/liveMap.js): each of its 11 groups is one virtual category
  const cats = await live.liveCategories();
  assert.deepEqual(cats.map((c) => c.id), ["v.co", "v.sports", "v.mx", "v.ar", "v.pe", "v.us", "v.intl", "v.news", "v.novelas", "v.movies", "v.kids", "v.docs"].filter((id) => id !== "v.news"));
  assert.deepEqual(cats[1], { id: "v.sports", title: "Deportes", genre: "deportes" });
  const page = await live.liveChannels({ categoryId: "v.sports", cursor: null });
  assert.equal(page.items[0].id, "tvenvivo_" + live.hashId("liga-1"));
  assert.equal(page.items[0].ref, liveRef("tvenvivo", "liga-1"));
  const old = await live.liveChannels({ categoryId: "tvenvivo.6465706f72746573", cursor: null });
  assert.equal(old.items[0].ref, liveRef("tvenvivo", "liga-1"), "the 1.0.45 id still answers");
  assert.equal(k.requests.length, 0);
  k.kino.lang = "en";
  nextCall(k);
  assert.equal((await tvenvivo.categories())[0].title, "Sports");
  assert.equal((await tvenvivo.categories()).find((c) => c.id === "cine").title, "Movies and series");
  const en = await live.liveCategories();
  assert.deepEqual(en.map((c) => c.id), cats.map((c) => c.id), "ids never change with the language");
  assert.equal(en[1].title, "Sports");
  assert.equal(en.find((c) => c.id === "v.movies").title, "Movies and series");
});

// Changed deliberately (2026-11-17): a first open no longer GETs the playlist to tell "off air" (3 → 2 requests; the
// player's own request tells the same and its 404 starts Kino's reopen), and the player page is remembered (then 1).
test("tvenvivo: a first open → 2 requests (core.php, its player page asked as the site's iframe), no off-air GET; then 1 (the remembered page), also cold once written", async () => {
  const k = await device({ routes: tvRoutes() });
  live._setSources([tvenvivo]);
  const out = await live.resolveLive(liveRef("tvenvivo", "liga-1"));
  assert.equal(out.url, manifestOf(7));
  assert.equal(out.mime, "application/vnd.apple.mpegurl");
  assert.deepEqual(k.requests.map((r) => r.url), ["https://www.tvenvivo.org/live/core.php?canal=liga1", TV_PLAYER_URL("liga1")]);
  assert.deepEqual(k.requests[0].headers, { Referer: "https://www.tvenvivo.org/" });
  assert.deepEqual(k.requests[1].headers, AS_IFRAME, "the player page as the site's iframe asks it");
  assert.deepEqual(k.writes, [], "a resolve writes nothing before its answer");
  // the next open: the remembered player page only
  nextCall(k);
  assert.equal((await live.resolveLive(liveRef("tvenvivo", "liga-1"))).url, manifestOf(7));
  assert.deepEqual(k.requests.map((r) => r.url), [TV_PLAYER_URL("liga1")]);
  // Kino's next live call that is not a resolve writes it; a cold runtime then asks that page at once
  nextCall(k);
  await live.liveCategories();
  assert.deepEqual(JSON.parse(k.store.get(tvMod.TVP_KEY)), { "liga-1": TV_PLAYER_URL("liga1") });
  nextCall(k, { cold: true });
  assert.equal((await live.resolveLive(liveRef("tvenvivo", "liga-1"))).url, manifestOf(7));
  assert.deepEqual(k.requests.map((r) => r.url), [TV_PLAYER_URL("liga1")]);
});

// Changed deliberately (2026-11-17): off air is told on Kino's reopen (a re-resolve right after the player's 404), not on
// the first open; still the first 404 ends it (was 9 requests over the skins: every skin is the same stream).
test("tvenvivo: off air → the first open answers the playlist; Kino's reopen checks it: 'no signal' at the first 404, no other skin", async () => {
  const k = await device({ routes: tvRoutes({ manifest: 404 }) });
  live._setSources([tvenvivo]);
  await onClock(async (clock) => {
    assert.equal((await live.resolveLive(liveRef("tvenvivo", "atv"))).url, manifestOf(7));
    assert.equal(k.requests.length, 2, "core.php and the player page: no off-air GET");
    clock.now += 3000; nextCall(k);   // the player's 404, then Kino's reopen 2 s after it
    await assert.rejects(() => live.resolveLive(liveRef("tvenvivo", "atv")), (e) => /sin señal ahora para atv/.test(e.message));
    assert.deepEqual(k.requests.map((r) => r.url), [TV_PLAYER_URL("atv"), manifestOf(7)], "the remembered page, then its playlist: 404");
    k.kino.lang = "en";
    clock.now += 4000; nextCall(k);
    await assert.rejects(() => live.resolveLive(liveRef("tvenvivo", "atv")), /no signal right now for atv/);
    assert.equal(k.requests.filter((r) => /core\.php/.test(r.url)).length, 0, "no other skin tried");
  });
});

test("tvenvivo: a skin whose page does not parse falls back to the next skin, which is remembered (then 1 request)", async () => {
  const k = await device({ routes: tvRoutes({ brokenSkins: ["live"] }) });
  live._setSources([tvenvivo]);
  const out = await live.resolveLive(liveRef("tvenvivo", "tudn"));
  assert.equal(out.url, manifestOf(7));
  assert.deepEqual(k.requests.map((r) => new URL(r.url).pathname.split("/")[1]), ["live", "live2", "live2"]);
  nextCall(k);
  assert.equal((await live.resolveLive(liveRef("tvenvivo", "tudn"))).url, manifestOf(7));
  assert.deepEqual(k.requests.map((r) => r.url), [TV_PLAYER_URL("tudn", "live2")]);
});

test("tvenvivo: a skin that fails on the network falls back too; past the call's deadline nothing else starts", async () => {
  const k = await device({ routes: [(url) => (/\/live\/core\.php/.test(url) ? Object.assign(new Error("timeout"), { code: "timeout" }) : undefined), ...tvRoutes()] });
  live._setSources([tvenvivo]);
  assert.equal((await live.resolveLive(liveRef("tvenvivo", "tudn"))).url, manifestOf(7));
  assert.equal(k.requests.length, 3);
  // deadline: the gate refuses to start the first request (the remembered page), and the connector stops there
  const gate = await import("../src/liveGate.js");
  nextCall(k);
  gate.tighten({ deadline: Date.now() - 1 });
  await assert.rejects(() => live.resolveLive(liveRef("tvenvivo", "tudn")), /no se pudo/);
  assert.equal(k.requests.length, 0);
});

test("tvenvivo: a remembered page that names no stream (a new signature) is forgotten and learned again from the core page", async () => {
  let sig = "abc";
  const k = await device({ routes: [(url) => {
    const core = /tvenvivo\.org\/(live\d?)\/core\.php\?canal=([^&]+)/.exec(url);
    if (core) return res(200, `<iframe src="https://p.example/${core[1]}/stream.php?canal=${core[2]}&amp;sig=${sig}"></iframe>`);
    if (/p\.example\/live\d?\/stream\.php/.test(url)) return res(200, url.endsWith("sig=" + sig) ? TV_PLAYER(7) : "invalid signature");
    return undefined;
  }] });
  live._setSources([tvenvivo]);
  await live.resolveLive(liveRef("tvenvivo", "tudn"));
  sig = "def";
  nextCall(k);
  assert.equal((await live.resolveLive(liveRef("tvenvivo", "tudn"))).url, manifestOf(7));
  assert.deepEqual(k.requests.map((r) => r.url.split("sig=")[1] || "core"), ["abc", "core", "def"]);
  nextCall(k);
  await live.liveCategories();
  assert.deepEqual(JSON.parse(k.store.get(tvMod.TVP_KEY)), { tudn: "https://p.example/live/stream.php?canal=tudn&sig=def" });
  // the same signature, but that skin's page stopped naming a stream: it is not asked twice, the next skin is
  const broken = new Set();
  const k2 = await device({ routes: [(url) => {
    const core = /tvenvivo\.org\/(live\d?)\/core\.php\?canal=([^&]+)/.exec(url);
    if (core) return res(200, TV_CORE(core[2], core[1]));
    const page = /p\.example\/(live\d?)\/stream\.php/.exec(url);
    if (page) return res(200, broken.has(page[1]) ? "Embedding domain not allowed" : TV_PLAYER(7));
    return undefined;
  }] });
  live._setSources([tvenvivo]);
  await live.resolveLive(liveRef("tvenvivo", "tudn"));
  broken.add("live");
  nextCall(k2);
  assert.equal((await live.resolveLive(liveRef("tvenvivo", "tudn"))).url, manifestOf(7));
  assert.deepEqual(k2.requests.map((r) => new URL(r.url).pathname), ["/live/stream.php", "/live/core.php", "/live2/core.php", "/live2/stream.php"]);
});

// The 2026-11-17 failure (Imagen TV, Azteca 7: "tvenvivo: no se pudo resolver" after 3 skins × 2 requests, all 200): the
// player host serves its page only to the site's iframe. The route answers as the host did, measured with curl.
const TV_CORE_REAL = fixture("tvenvivo-core.html");
const TV_PLAYER_REAL = fixture("tvenvivo-player.html");
const TV_REFUSED = fixture("tvenvivo-refused.txt");
const REAL_MANIFEST = "https://regionales.saohgdassregions.com/playlist/1/index.m3u8?token=0123456789abcdef0123456789abcdef01234567-fedcba9876543210fedcba9876543210-1795000000-1794978400";

function realTvRoutes() {
  return [(url, init) => {
    const core = /^https:\/\/www\.tvenvivo\.org\/(live\d?)\/core\.php\?canal=azteca7$/.exec(url);
    if (core) return res(200, TV_CORE_REAL.replace("target=1", "target=" + (core[1].slice(4) || "1")), { "content-type": "text/html; charset=UTF-8" });
    if (url.startsWith("https://regionales.saohgdassregions.com/stream.php?canal=azteca7&target=")) {
      const h = (init && init.headers) || {};
      if (h["Sec-Fetch-Dest"] === "document" || h["Sec-Fetch-Dest"] === "empty") return res(403, "Player must be loaded through an embed");
      return h.Referer === "https://www.tvenvivo.org/" ? res(200, TV_PLAYER_REAL, { "content-type": "text/html; charset=UTF-8" }) : res(200, TV_REFUSED);
    }
    if (url === REAL_MANIFEST) return res(200, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1110000,RESOLUTION=850x480\ntracks-v1a1/mono.m3u8\n");
    return undefined;
  }];
}

test("tvenvivo (2026-11-17 markup): Azteca 7 opens with 2 requests now that the player page is asked as the site's iframe", async () => {
  const k = await device({ routes: realTvRoutes() });
  live._setSources([tvenvivo]);
  const out = await live.resolveLive(liveRef("tvenvivo", "azteca-7"));
  assert.equal(out.url, REAL_MANIFEST);
  assert.deepEqual(k.requests.map((r) => r.url), [
    "https://www.tvenvivo.org/live/core.php?canal=azteca7",
    "https://regionales.saohgdassregions.com/stream.php?canal=azteca7&target=1&sig=7d1f0a9c3b5e2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f1a2c4e6b8d0f",
  ]);
  assert.deepEqual(k.requests[1].headers, AS_IFRAME);
  // what that host answers a request without the site's Referer (Kino's default): a 200 that names no stream
  assert.equal(tvMod.manifestIn(TV_REFUSED), null);
});

test("tvenvivo: manifestIn reads the escaped `var src` of a player page, ignores a mention with no token, and finds none in a refusal", () => {
  assert.equal(tvMod.manifestIn(TV_PLAYER_REAL), REAL_MANIFEST);
  assert.equal(tvMod.manifestIn(TV_PLAYER(7)), manifestOf(7));
  const noise = "<script>/* index.m3u8?token= is refreshed when the playlist comes back */</script>";
  assert.equal(tvMod.manifestIn(noise + TV_PLAYER(3) + noise), manifestOf(3), "a mention without a URL before the real one");
  assert.equal(tvMod.manifestIn("x".repeat(700_000) + TV_PLAYER(9)), manifestOf(9), "past ~660 KB of script");
  assert.equal(tvMod.manifestIn(""), null);
  assert.equal(tvMod.manifestIn(null), null);
});

// ── caracol: the list is stored with each channel's assetId; resolve from a cold runtime is 2 requests ──

const CARACOL_CAT = "caracol." + hexEnc("all");

function caracolRoutes(o = {}) {
  const seen = { videourl: [] };
  const routes = [(url) => {
    if (!/middleware\.ditu\.caracoltv\.com/.test(url)) return undefined;
    if (o.geo) return res(403, "forbidden");
    if (/\/TRAY\/LIVECHANNELS\?/.test(url)) return res(200, o.list || CARACOL_JSON, { "content-type": "application/json" });
    if (/\/CONTENT\/USERDATA\/LIVE\/\d+$/.test(url)) {
      return res(200, JSON.stringify({ resultObj: { containers: [{ entitlement: o.blocked ? { isGeoBlocked: true } : { isGeoBlocked: false } }] } }));
    }
    const v = /\/CONTENT\/VIDEOURL\/LIVE\/(\d+)\/(\d+)$/.exec(url);
    if (v) {
      seen.videourl.push(v[2]);
      if (o.goodAsset && v[2] !== String(o.goodAsset)) return res(404, "no such asset");
      return res(200, JSON.stringify({ resultObj: { src: `https://dai.google.com/linear/${v[1]}/${v[2]}/manifest.mpd` } }));
    }
    return undefined;
  }];
  return { routes, seen };
}

test("caracol: one request lists it; the stored list keeps assetId privately; ids are 1.0.43's", async () => {
  const { routes } = caracolRoutes();
  const k = await device({ routes });
  live._setSources([caracol]);
  assert.deepEqual(await caracol.categories(), [{ id: "all", title: "Canales en vivo" }]);
  const cats = await live.liveCategories();
  assert.deepEqual(cats, [{ id: "v.co", title: "Colombia", genre: "otros", country: "CO" }], "caracol's one category goes into Colombia");
  assert.equal(k.requests.length, 0, "categories are code");
  const page = await live.liveChannels({ categoryId: CARACOL_CAT, cursor: null });
  assert.equal(k.requests.length, 1);
  assert.equal(page.items.length, 21);
  assert.deepEqual(page.items[0], {
    id: "caracol_" + live.hashId("20"), title: "Caracol TV", ref: "L:caracol:20", categoryId: CARACOL_CAT,
    logo: "https://image-registry.avscaracoltv.com/logos/caracoltv-md.png",
  });
  assert.ok(page.items.every((c) => !("x" in c)), "x never reaches Kino");
  const stored = JSON.parse(k.store.get("o2:ll:" + CARACOL_CAT));
  assert.deepEqual(stored[0].x, { assetId: 10 });
  // within 24 h: 0 requests, also from a cold runtime
  nextCall(k, { cold: true });
  assert.equal((await live.liveChannels({ categoryId: CARACOL_CAT, cursor: null })).items.length, 21);
  assert.equal(k.requests.length, 0);
});

test("caracol: resolve from a cold runtime with the list stored = 2 requests (USERDATA + VIDEOURL), was 3", async () => {
  const { routes, seen } = caracolRoutes();
  const k = await device({ routes });
  live._setSources([caracol]);
  await live.loadList(CARACOL_CAT);
  nextCall(k, { cold: true });
  const out = await live.resolveLive(liveRef("caracol", "31"));
  assert.deepEqual(k.requests.map((r) => r.url.replace(/^.*\/ALL\//, "")), ["CONTENT/USERDATA/LIVE/31", "CONTENT/VIDEOURL/LIVE/31/10"]);
  assert.deepEqual(seen.videourl, ["10"]);
  assert.equal(out.url, "https://dai.google.com/linear/31/10/manifest.mpd");
  assert.equal(out.mime, "application/dash+xml");
  assert.deepEqual(out.drm, { type: "widevine", licenseUrl: "https://middleware.ditu.caracoltv.com/AGL/1.6/A/ENG/ANDROID/ALL/CONTENT/LICENSE", licenseHeaders: { Cookie: "playback_token=tok-123" } });
  assert.equal(out.headers.Cookie, "playback_token=tok-123");
  assert.equal(out.headers["User-Agent"], "okhttp/4.12.0");
});

// Changed deliberately (2026-11-17): a resolve writes nothing before its answer; the list it fetched is written (text and
// meta together) by the next live call that is not a resolve.
test("caracol: resolve with nothing stored lists once (3 requests); Kino's next live call stores the list for the next time", async () => {
  const { routes } = caracolRoutes();
  const k = await device({ routes });
  live._setSources([caracol]);
  const out = await live.resolveLive(liveRef("caracol", "20"));
  assert.equal(out.url, "https://dai.google.com/linear/20/10/manifest.mpd");
  assert.equal(k.requests.length, 3);
  assert.deepEqual(k.writes, [], "nothing written before the answer");
  // the same runtime serves the list it fetched (the text waits in memory)
  nextCall(k);
  await live.resolveLive(liveRef("caracol", "21"));
  assert.equal(k.requests.length, 2, "USERDATA + VIDEOURL: the list is there");
  nextCall(k);
  await live.liveCategories();
  assert.ok(k.store.get("o2:ll:" + CARACOL_CAT), "the list is stored");
  assert.ok(k.writes.indexOf("o2:ll:" + CARACOL_CAT) < k.writes.indexOf("o2:lm"), "its text before the meta that labels it");
  nextCall(k, { cold: true });
  await live.resolveLive(liveRef("caracol", "20"));
  assert.equal(k.requests.length, 2);
  await assert.rejects(() => live.resolveLive(liveRef("caracol", "999999")), /canal desconocido 999999/);
  // a runtime discarded before such a call loses the list and its meta together: the next one lists again
  const k2 = await device({ routes });
  live._setSources([caracol]);
  await live.resolveLive(liveRef("caracol", "20"));
  nextCall(k2, { cold: true });
  await live.resolveLive(liveRef("caracol", "20"));
  assert.equal(k2.requests.length, 3);
});

test("caracol: a stored assetId that no longer plays is re-listed once and retried with the new one", async () => {
  const { routes, seen } = caracolRoutes({ goodAsset: 10 });
  const old = JSON.parse(CARACOL_JSON);
  for (const c of old.resultObj.containers) c.assets[0].assetId = 7;
  const phase = { v: "old" };
  const k = await device({ routes: [(url) => (/TRAY\/LIVECHANNELS/.test(url) && phase.v === "old" ? res(200, JSON.stringify(old)) : undefined), ...routes] });
  live._setSources([caracol]);
  await live.loadList(CARACOL_CAT);
  assert.deepEqual(JSON.parse(k.store.get("o2:ll:" + CARACOL_CAT))[0].x, { assetId: 7 });
  phase.v = "new";
  nextCall(k, { cold: true });
  const out = await live.resolveLive(liveRef("caracol", "20"));
  assert.equal(out.url, "https://dai.google.com/linear/20/10/manifest.mpd");
  assert.deepEqual(seen.videourl, ["7", "10"]);
  // written behind (2026-11-17): by Kino's next live call that is not a resolve
  assert.deepEqual(JSON.parse(k.store.get("o2:ll:" + CARACOL_CAT))[0].x, { assetId: 7 }, "not yet: nothing written before the answer");
  nextCall(k);
  await live.liveCategories();
  assert.deepEqual(JSON.parse(k.store.get("o2:ll:" + CARACOL_CAT))[0].x, { assetId: 10 }, "the re-list was stored");
});

test("caracol: outside Colombia (403) the error says so in ES and EN; an empty answer keeps the stored list", async () => {
  const geo = caracolRoutes({ geo: true });
  const k = await device({ routes: geo.routes });
  live._setSources([caracol]);
  await assert.rejects(() => live.resolveLive(liveRef("caracol", "20")), /solo disponible en Colombia/);
  k.kino.lang = "en";
  nextCall(k);
  await assert.rejects(() => live.resolveLive(liveRef("caracol", "20")), /only available in Colombia/);
  // entitlement block (geo flag in USERDATA)
  const blocked = caracolRoutes({ blocked: true });
  const k2 = await device({ routes: blocked.routes });
  live._setSources([caracol]);
  await live.loadList(CARACOL_CAT);
  nextCall(k2, { cold: true });
  await assert.rejects(() => live.resolveLive(liveRef("caracol", "20")), /solo disponible en Colombia/);
  assert.equal(k2.requests.length, 1, "a blocked channel is not re-listed");
  // an empty list is a failure: the stored one stays
  const empty = caracolRoutes({ list: JSON.stringify({ resultObj: { containers: [] } }) });
  const k3 = await device({ routes: empty.routes, storage: Object.fromEntries(k2.store) });
  live._setSources([caracol]);
  await live.loadList(CARACOL_CAT, { force: true });
  assert.equal(JSON.parse(k3.store.get("o2:ll:" + CARACOL_CAT)).length, 21);
});

// ── cablevisionhd: 7 code categories, one scrape fills every list, resolve via the learned canal key ──

const cvCat = (id) => "cablevisionhd." + hexEnc(id);
const CV_CORE = (key, dir) => `<html><iframe src="https://deportes.example/${dir}/stream.php?canal=${key}&amp;sig=s1" allowfullscreen></iframe></html>`;
const CV_PLAYER = (n) => `<html><script>var src = "https:\\/\\/deportes.example\\/playlist\\/${n}\\/index.m3u8?token=${TOKEN}";</script></html>`;
const CV_CHANNEL_PAGE = (key) => `<div class="options">
  <a class="option active" href="https://www.cablevisionhd.com/stream/core.php?canal=${key}" target="player">Opción 1</a>
  <a class="option" href="https://www.cablevisionhd.com/stream2/core.php?canal=${key}" target="player">Opción 2</a>
  <a class="option" href="https://www.cablevisionhd.com/stream3/core.php?canal=${key}" target="player">Opción 3</a></div>`;

function cvRoutes(o = {}) {
  const keys = o.keys || { "tudn-ver": "tudn", "extrema-tv-ver": "extrematv" };
  return [(url, init) => {
    if (hostOf(url) === "www.cablevisionhd.com") return res(301, "", { location: url.replace("://www.", "://") });
    if (url === "https://cablevisionhd.com/parrilla-directo.php") return o.gridFails ? res(503, "busy") : res(200, PARRILLA, { "content-type": "text/html; charset=UTF-8" });
    const page = /^https:\/\/cablevisionhd\.com\/([a-z0-9-]+-ver)\.php$/.exec(url);
    if (page) return keys[page[1]] ? res(200, CV_CHANNEL_PAGE(keys[page[1]])) : res(404, "");
    const core = /^https:\/\/cablevisionhd\.com\/(stream\d?)\/core\.php\?canal=([^&]+)$/.exec(url);
    if (core) return Object.values(keys).includes(core[2]) ? res(200, CV_CORE(core[2], core[1])) : res(200, "<html>Canal no encontrado</html>");
    if (/deportes\.example\/stream\d?\/stream\.php/.test(url)) {
      // as the player host answered on 2026-11-17: its page only to the site's own www. origin
      const ref = ((init && init.headers) || {}).Referer || "VACIO";
      if (ref !== "https://www.cablevisionhd.com/") return res(200, "Embedding domain not allowed\nREFERER: " + ref);
      return res(200, CV_PLAYER(/canal=extrematv/.test(url) ? 73 : 1));
    }
    if (url === manifestOf(1)) return res(200, "#EXTM3U");
    if (url === manifestOf(73)) return res(404, "not found");
    return undefined;
  }];
}

test("cablevisionhd: 7 code categories (no 'Todos', no '24/7', new 'Otros'), ES and EN, 0 requests", async () => {
  live._setSources([cablevisionhd]);
  const k = await device({ noFetch: true });
  const raw = await cablevisionhd.categories();
  assert.deepEqual(raw.map((c) => c.id), ["sports", "entertainment", "news", "movies", "kids", "education", "other"]);
  assert.deepEqual(raw.map((c) => c.title), ["Deportes", "Entretenimiento", "Noticias", "Películas", "Infantil", "Educación", "Otros"]);
  assert.ok(!raw.some((c) => c.id === "all" || c.id === "always"));
  // through the mapping: "Otros" joins "Entretenimiento"
  const cats = await live.liveCategories();
  assert.deepEqual(cats.map((c) => c.id), ["v.sports", "v.news", "v.ent", "v.movies", "v.kids", "v.docs"]);
  assert.deepEqual((await live.categoryList()).find((e) => e.id === "v.ent").members.map((m) => m.rawCat), ["entertainment", "other"]);
  k.kino.lang = "en";
  nextCall(k);
  assert.deepEqual((await cablevisionhd.categories()).map((c) => c.title), ["Sports", "Entertainment", "News", "Movies", "Kids", "Education", "Other"]);
});

test("cablevisionhd: one grid request stores all 7 lists; the others then cost 0 requests (cold runtime too)", async () => {
  const k = await device({ routes: cvRoutes() });
  live._setSources([cablevisionhd]);
  const sports = await live.liveChannels({ categoryId: cvCat("sports"), cursor: null });
  assert.deepEqual(k.requests.map((r) => r.url), ["https://cablevisionhd.com/parrilla-directo.php"]);
  assert.equal(sports.items.length, 28);
  assert.deepEqual(sports.items[0], { id: "cablevisionhd_" + live.hashId("tudn-ver"), title: "TUDN", ref: "L:cablevisionhd:tudn-ver", categoryId: cvCat("sports"), logo: "https://cablevisionhd.com/imge/tudn.webp" });
  for (const id of ["entertainment", "news", "movies", "kids", "education", "other"]) assert.ok(k.store.get("o2:ll:" + cvCat(id)), id + " stored");
  nextCall(k, { cold: true });
  const other = await live.liveChannels({ categoryId: cvCat("other"), cursor: null });
  assert.deepEqual(other.items.map((c) => c.title), ["TLNOVELAS", "EXTREMA TV"]);
  const counts = {};
  for (const id of ["entertainment", "news", "movies", "kids", "education"]) counts[id] = (await live.liveChannels({ categoryId: cvCat(id), cursor: null })).items.length;
  assert.deepEqual(counts, { entertainment: 16, news: 1, movies: 20, kids: 3, education: 5 });
  assert.equal(k.requests.length, 0);
  // the legacy "Todos" id still answers the whole grid (a category Kino may remember)
  nextCall(k);
  assert.equal((await live.liveChannels({ categoryId: cvCat("all"), cursor: null })).items.length, 74);
});

test("cablevisionhd: a failed grid keeps serving the stored lists", async () => {
  const k = await device({ routes: cvRoutes() });
  live._setSources([cablevisionhd]);
  await live.loadList(cvCat("sports"));
  const failing = await device({ routes: cvRoutes({ gridFails: true }), storage: Object.fromEntries(k.store) });
  live._setSources([cablevisionhd]);
  await live.loadList(cvCat("kids"), { force: true });
  assert.equal(JSON.parse(failing.store.get("o2:ll:" + cvCat("kids"))).length, 3);
});

// Changed deliberately (2026-11-17): no off-air GET on a first open (4 → 3 requests, then 3 → 2); the player page goes
// with the site's www. origin as its Referer (the root host's is refused).
test("cablevisionhd: resolve learns the canal key (3 requests, root host, no 301), then 2; o2:cvk stores it; the player page as www.'s iframe", async () => {
  const k = await device({ routes: cvRoutes() });
  live._setSources([cablevisionhd]);
  const out = await live.resolveLive(liveRef("cablevisionhd", "tudn-ver"));
  assert.equal(out.url, manifestOf(1));
  assert.deepEqual(out.headers, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:101.0) Gecko/20100101 Firefox/101.0", Referer: "https://deportes.example/" });
  assert.deepEqual(k.requests.map((r) => r.url), [
    "https://cablevisionhd.com/tudn-ver.php",
    "https://cablevisionhd.com/stream/core.php?canal=tudn",
    "https://deportes.example/stream/stream.php?canal=tudn&sig=s1",
  ]);
  assert.deepEqual(k.requests[2].headers, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:101.0) Gecko/20100101 Firefox/101.0", Referer: "https://www.cablevisionhd.com/", "Sec-Fetch-Dest": "iframe" });
  assert.ok(!k.requests.some((r) => hostOf(r.url) === "www.cablevisionhd.com"), "no www. (no 301)");
  assert.deepEqual(JSON.parse(k.store.get(cvMod.CVK_KEY)), { "tudn-ver": "tudn" });
  nextCall(k, { cold: true });
  assert.equal((await live.resolveLive(liveRef("cablevisionhd", "tudn-ver"))).url, manifestOf(1));
  assert.deepEqual(k.requests.map((r) => r.url), [
    "https://cablevisionhd.com/stream/core.php?canal=tudn",
    "https://deportes.example/stream/stream.php?canal=tudn&sig=s1",
  ]);
  assert.ok(!k.writes.includes(cvMod.CVK_KEY), "an unchanged key is not rewritten");
});

// Changed deliberately (2026-11-17): off air is told on Kino's reopen right after the player's 404, not on the first open.
test("cablevisionhd: off air → the first open answers the playlist; Kino's reopen checks it: 'no signal' at the first 404, no other option", async () => {
  const k = await device({ routes: cvRoutes() });
  live._setSources([cablevisionhd]);
  await onClock(async (clock) => {
    assert.equal((await live.resolveLive(liveRef("cablevisionhd", "extrema-tv-ver"))).url, manifestOf(73));
    assert.equal(k.requests.length, 3, "channel page, core.php, player: no off-air GET");
    clock.now += 3000; nextCall(k);
    await assert.rejects(() => live.resolveLive(liveRef("cablevisionhd", "extrema-tv-ver")), (e) => /sin señal ahora para extrema-tv-ver/.test(e.message));
    assert.equal(k.requests.length, 3, "core.php, player, manifest: no other option tried");
  });
});

test("cablevisionhd: a learned key that stopped working is learned again from the channel page", async () => {
  const k = await device({ routes: cvRoutes({ keys: { "tudn-ver": "tudn2" } }), storage: { "o2:cvk": JSON.stringify({ "tudn-ver": "tudn" }) } });
  live._setSources([cablevisionhd]);
  const out = await live.resolveLive(liveRef("cablevisionhd", "tudn-ver"));
  assert.equal(out.url, manifestOf(1));
  assert.deepEqual(k.requests.map((r) => new URL(r.url).pathname + new URL(r.url).search), [
    "/stream/core.php?canal=tudn", "/tudn-ver.php", "/stream/core.php?canal=tudn2", "/stream/stream.php?canal=tudn2&sig=s1",
  ]);
  assert.deepEqual(JSON.parse(k.store.get(cvMod.CVK_KEY)), { "tudn-ver": "tudn2" });
  await assert.rejects(() => live.resolveLive(liveRef("cablevisionhd", "../etc")), /ref desconocida/);
});

test("cablevisionhd: helpers (root host, canal key, grouping)", () => {
  assert.equal(cvMod.rootHost("https://www.cablevisionhd.com/stream2/core.php?canal=x"), "https://cablevisionhd.com/stream2/core.php?canal=x");
  assert.equal(cvMod.canalOf("https://cablevisionhd.com/stream/core.php?canal=extrematv"), "extrematv");
  assert.deepEqual(cvMod.categoriesOf("TELEMUNDO 51"), ["entertainment", "news"]);
  assert.deepEqual(cvMod.categoriesOf("EXTREMA TV"), ["other"]);
  const all = cvMod.parseChannels(PARRILLA);
  assert.equal(all.length, 74, "the Mundo Latam card is not a channel page");
  assert.equal(all.filter((c) => c.title === "24/7").length, 0);
});

// ── premiumtv (src/sources/m3u.js): one download fills every group; conditional GET; headers kept; 18+ ──

const ptvCat = (g) => "premiumtv." + hexEnc(g);
const ETAG = '"d8796843f6dce4034885ae2cd885993d"';

function m3uRoutes(o = {}) {
  const body = () => (typeof o.body === "function" ? o.body() : o.body || M3U);
  return [(url, init) => {
    if (url !== M3U_URL) return undefined;
    if (o.fail) return res(503, "busy");
    const etag = o.etag || ETAG;
    const h = (init && init.headers) || {};
    if (h["If-None-Match"] === etag) return res(304, "", { etag });
    return res(200, body(), { etag, "content-type": "text/plain; charset=utf-8" });
  }];
}

test("m3u parser: 1.0.43's ids (the URL line) and groups; keeps User-Agent / Referer / Origin from EXTVLCOPT, KODIPROP, EXTHTTP, url|…", () => {
  const text = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-logo="https://l/a,b.png" group-title="Noticias",Canal A, Edición 1',
    "#EXTVLCOPT:http-user-agent=UA/1.0",
    "#EXTVLCOPT:http-referrer=https://ref.example/",
    "https://a.example/live.m3u8",
    '#EXTINF:-1 group-title="Noticias",Canal B',
    "#KODIPROP:inputstream.adaptive.stream_headers=User-Agent=UA%2F2.0&Referer=https%3A%2F%2Fb.example%2F&X-Other=1",
    "http://1.2.3.4:8000/play/b/index.m3u8",
    '#EXTINF:-1 tvg-name="C name" group-title="Deportes",',
    '#EXTHTTP:{"Origin":"https://c.example","Cookie":"k=v","Bad":"x"}',
    "https://c.example/c.m3u8",
    '#EXTINF:-1 group-title="Deportes",Canal D',
    "https://d.example/d.m3u8|User-Agent=UA%2F4&Referer=https://d.example/",
    "#EXTINF:-1,Sin grupo",
    "#EXTVLCOPT:http-user-agent=bad\u0007value",
    "https://e.example/e.ts",
  ].join("\n");
  const chans = m3u.parseM3U(text);
  assert.deepEqual(chans.map((c) => [c.url, c.group, c.name]), [
    ["https://a.example/live.m3u8", "Noticias", "Canal A, Edición 1"],
    ["http://1.2.3.4:8000/play/b/index.m3u8", "Noticias", "Canal B"],
    ["https://c.example/c.m3u8", "Deportes", "C name"],
    ["https://d.example/d.m3u8|User-Agent=UA%2F4&Referer=https://d.example/", "Deportes", "Canal D"],
    ["https://e.example/e.ts", "General", "Sin grupo"],
  ]);
  assert.deepEqual(chans[0].headers, { "User-Agent": "UA/1.0", Referer: "https://ref.example/" });
  assert.deepEqual(chans[1].headers, { "User-Agent": "UA/2.0", Referer: "https://b.example/" });
  assert.deepEqual(chans[2].headers, { Origin: "https://c.example", Cookie: "k=v" });
  assert.deepEqual(chans[3].headers, { "User-Agent": "UA/4", Referer: "https://d.example/" });
  assert.equal(chans[4].headers, undefined, "a header value with a control character is dropped");
});

test("m3u parser on the real sample: groups in first-seen order, teleon entries keep their UA and Referer", () => {
  const shaped = m3u.shape(m3u.parseM3U(M3U));
  assert.deepEqual(shaped.cats.map((c) => c.id), ["El Salvador - TCS", "Colombia", "Argentina", "Anime", "Deportes"]);
  assert.ok(shaped.cats.every((c) => !c.adult), "'Adult Swim' sits in Anime: no group is 18+");
  const teleon = Object.entries(shaped.hdr).find(([u]) => u.startsWith("https://signal.teleon.live/"));
  assert.deepEqual(Object.keys(teleon[1]), ["User-Agent", "Referer"]);
  assert.equal(teleon[1].Referer, "https://teleon.tv/");
  // Telefe: EXTVLCOPT user-agent + KODIPROP stream_headers (the same UA) + EXTVLCOPT referrer
  const telefe = Object.entries(shaped.hdr).find(([u]) => u.includes("telefe.argtelemax"));
  assert.match(telefe[1]["User-Agent"], /Pixel 2 XL/);
  assert.equal(telefe[1].Referer, "https://www.mitelefe.com/");
});

test("m3u: 18+ groups are marked adult (Kino gates them; the own screen's dropdown leaves them out)", async () => {
  for (const t of ["Adultos", "XXX", "+18", "18+", "Canales para adultos", "Porno", "For Adults", "Eróticos"]) assert.ok(m3u.isAdultGroup(t), t);
  for (const t of ["Anime", "Deportes", "Cine / Películas Premium", "Música", "Educación 2018"]) assert.ok(!m3u.isAdultGroup(t), t);
  const body = M3U + '\n#EXTINF:-1 group-title="XXX Adultos",Canal X\nhttps://x.example/x.m3u8\n';
  const k = await device({ routes: m3uRoutes({ body }) });
  live._setSources([premiumtv]);
  const cats = await live.liveCategories();
  assert.equal(JSON.parse(k.store.get("o2:lc")).src.premiumtv.cats.find((c) => c.id === "XXX Adultos").adult, true);
  assert.deepEqual(cats.find((c) => c.id === "v.adult"), { id: "v.adult", title: "Adultos", adult: true, genre: "otros" });
  assert.equal(k.requests.length, 1);
  const page = await live.liveChannels({ categoryId: "v.adult", cursor: null });
  assert.equal(page.items[0].adult, true);
  assert.equal((await live.liveChannels({ categoryId: ptvCat("XXX Adultos"), cursor: null })).items[0].adult, true, "its 1.0.45 id too");
  const { cats: screenCats } = await live.screenCategories("vivo");
  assert.ok(!screenCats.some((c) => c.id === "v.adult"));
  assert.ok(screenCats.some((c) => c.id === "v.co"));
});

test("premiumtv: the first fill is one bounded request that stores the categories, every group and the validators", async () => {
  const k = await device({ routes: m3uRoutes() });
  live._setSources([premiumtv]);
  const cats = await live.liveCategories();
  assert.deepEqual(JSON.parse(k.store.get("o2:lc")).src.premiumtv.cats.map((c) => c.title), ["El Salvador - TCS", "Colombia", "Argentina", "Anime", "Deportes"]);
  assert.deepEqual(cats.map((c) => c.id), ["v.co", "v.sports", "v.ar", "v.sv", "v.anime"], "each group in its country or theme");
  assert.equal(k.requests.length, 1);
  assert.ok(k.requests[0].timeoutMs <= live.FIRST_FILL.maxTimeoutMs, "first-fill bound: " + k.requests[0].timeoutMs);
  for (const g of ["El Salvador - TCS", "Colombia", "Argentina", "Anime", "Deportes"]) assert.ok(k.store.get("o2:ll:" + ptvCat(g)), g);
  const st = JSON.parse(k.store.get("o2:m3u:premiumtv"));
  assert.equal(st.etag, ETAG);
  assert.equal(st.cats.length, 5);
  // the lists are already stored: listing any group costs nothing, in this call or from a cold runtime
  const col = await live.liveChannels({ categoryId: ptvCat("Colombia"), cursor: null });
  assert.equal(col.items.length, 14);
  nextCall(k, { cold: true });
  const ar = await live.liveChannels({ categoryId: ptvCat("Argentina"), cursor: null });
  assert.equal(ar.items.length, 7);
  assert.equal(ar.items[0].id, "premiumtv_" + live.hashId(m3u.parseM3U(M3U).find((c) => c.group === "Argentina").url), "1.0.43's id");
  assert.equal(k.requests.length, 0);
});

test("premiumtv: past fresh, a conditional GET answering 304 keeps every list (no list rewritten) and refreshes the categories", async () => {
  const k = await device({ routes: m3uRoutes() });
  live._setSources([premiumtv]);
  await live.loadList(ptvCat("Colombia"));
  const before = JSON.parse(k.store.get("o2:lm"));
  // 7 h later
  const realNow = Date.now;
  Date.now = () => realNow() + 7 * H;
  try {
    nextCall(k, { cold: true });
    const page = await live.liveChannels({ categoryId: ptvCat("Colombia"), cursor: null });
    assert.equal(page.items.length, 14);
    assert.equal(k.requests.length, 1);
    assert.equal(k.requests[0].headers["If-None-Match"], ETAG);
    assert.ok(!k.writes.some((w) => w.startsWith("o2:ll:")), "no list rewritten: " + k.writes.join(","));
    assert.ok(!k.writes.includes("o2:m3u:premiumtv"));
    const meta = JSON.parse(k.store.get("o2:lm"));
    assert.ok(meta.l[ptvCat("Anime")].at > before.l[ptvCat("Anime")].at, "a 304 marks every group checked");
    assert.ok(meta.c.premiumtv.at > before.c.premiumtv.at, "the categories ride along the 304");
  } finally { Date.now = realNow; }
});

test("premiumtv: 304 after 304 renews the stored lists and the validators before their TTL ends (lists: max-stale 3 d, text 9 d; state 7 d)", async () => {
  const k = await device({ routes: m3uRoutes() });
  live._setSources([premiumtv]);
  await live.loadList(ptvCat("Colombia"));
  const realNow = Date.now;
  try {
    // 2 days later: a 304 rewrites nothing (the lists' text is renewed once a max-stale old, the state past half its 7 d)
    Date.now = () => realNow() + 2 * D;
    nextCall(k, { cold: true });
    await live.liveChannels({ categoryId: ptvCat("Colombia"), cursor: null });
    assert.equal(k.requests.length, 1);
    assert.deepEqual(k.writes.filter((w) => w.startsWith("o2:ll:") || w === "o2:m3u:premiumtv"), [], "nothing due yet");
    // 4 days after the download (past the lists' 3 d max-stale, past half of the state's 7 d): every stored list once,
    // and the state
    Date.now = () => realNow() + 4 * D;
    nextCall(k, { cold: true });
    await live.liveChannels({ categoryId: ptvCat("Colombia"), cursor: null });
    const lists = k.writes.filter((w) => w.startsWith("o2:ll:premiumtv."));
    assert.equal(new Set(lists).size, lists.length, "each list once");
    assert.ok(lists.length > 1 && lists.includes("o2:ll:" + ptvCat("Anime")), "every group renewed: " + lists.length);
    assert.ok(k.writes.includes("o2:m3u:premiumtv"), "validators and headers renewed: " + k.writes.join(","));
    assert.equal(JSON.parse(k.store.get("o2:m3u:premiumtv")).etag, ETAG);
  } finally { Date.now = realNow; }
});

test("premiumtv: validators are sent only when the 304 is usable (the list asked for is stored)", async () => {
  const k = await device({ routes: m3uRoutes() });
  live._setSources([premiumtv]);
  await live.loadList(ptvCat("Colombia"));
  // the Anime list vanished from storage (its ttl), the validators did not
  k.store.delete("o2:ll:" + ptvCat("Anime"));
  nextCall(k, { cold: true });
  const anime = await live.liveChannels({ categoryId: ptvCat("Anime"), cursor: null });
  assert.equal(anime.items.length, 12);
  assert.equal(k.requests.length, 1);
  assert.equal(k.requests[0].headers["If-None-Match"], undefined);
});

test("premiumtv: a changed list rewrites only the groups that changed; a failed download keeps the stored lists", async () => {
  let body = M3U;
  const k = await device({ routes: m3uRoutes({ body: () => body, etag: undefined }) });
  live._setSources([premiumtv]);
  await live.loadList(ptvCat("Colombia"));
  body = M3U.replace("Canal 4 TCS SD", "Canal 4 TCS");
  const k2 = await device({ routes: m3uRoutes({ body: () => body, etag: '"v2"' }), storage: Object.fromEntries(k.store) });
  live._setSources([premiumtv]);
  await live.loadList(ptvCat("Colombia"), { force: true });
  assert.deepEqual(k2.writes.filter((w) => w.startsWith("o2:ll:")), ["o2:ll:" + ptvCat("El Salvador - TCS")]);
  assert.equal(JSON.parse(k2.store.get("o2:m3u:premiumtv")).etag, '"v2"');
  const k3 = await device({ routes: m3uRoutes({ fail: true }), storage: Object.fromEntries(k2.store) });
  live._setSources([premiumtv]);
  await live.loadList(ptvCat("Anime"), { force: true });
  assert.equal(JSON.parse(k3.store.get("o2:ll:" + ptvCat("Anime"))).length, 12);
  assert.ok(!k3.writes.some((w) => w.startsWith("o2:ll:")));
});

test("premiumtv: resolve makes no request and sends the headers the list names (url|… split off)", async () => {
  const k = await device({ routes: m3uRoutes() });
  live._setSources([premiumtv]);
  await live.liveCategories();
  nextCall(k, { cold: true });
  const chans = m3u.parseM3U(M3U);
  const teleon = chans.find((c) => c.url.startsWith("https://signal.teleon.live/"));
  const out = await live.resolveLive(liveRef("premiumtv", teleon.url));
  assert.deepEqual(out, {
    url: teleon.url, mime: "application/vnd.apple.mpegurl",
    headers: { "User-Agent": teleon.headers["User-Agent"], Referer: "https://teleon.tv/" },
  });
  const plain = chans.find((c) => !c.headers);
  assert.deepEqual(await live.resolveLive(liveRef("premiumtv", plain.url)), { url: plain.url, mime: "application/vnd.apple.mpegurl" });
  const piped = await premiumtv.resolve("https://d.example/d.ts|User-Agent=UA%2F4&Referer=https://d.example/");
  assert.deepEqual(piped, { url: "https://d.example/d.ts", mime: "video/mp2t", headers: { "User-Agent": "UA/4", Referer: "https://d.example/" } });
  assert.equal(k.requests.length, 0);
});

test("premiumtv: one call never downloads the list twice (categories and a list share the response)", async () => {
  const k = await device({ routes: m3uRoutes() });
  live._setSources([premiumtv]);
  await live.liveCategories();
  await live.loadList(ptvCat("Deportes"), { force: true });
  assert.equal(k.requests.length, 1);
});

// ── no module memory in these connectors ──

test("connectors A keep no module-level memo or promise (once() + the live store only)", () => {
  for (const f of ["tvenvivo", "caracol", "cablevisionhd", "m3u"]) {
    const code = readFileSync(new URL(`../src/sources/${f}.js`, import.meta.url), "utf8");
    assert.ok(!/^(let|var)\s/m.test(code), f + ": a module-level let/var");
    assert.ok(!/^const\s+\w+\s*=\s*new (Map|Set)\(/m.test(code), f + ": a module-level Map/Set");
    assert.ok(!/\b_cache\b|\b_live\b|\bCACHE_MS\b|\bLIVE_TTL_MS\b/.test(code), f + ": an old memo is left");
    assert.ok(!/kino\.(fetch|storage)\s*[.(]/.test(code), f + ": kino.fetch / kino.storage");
  }
});
