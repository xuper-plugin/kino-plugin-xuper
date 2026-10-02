import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput, validateManifest } from "../sdk/contract.mjs";
import { makeResolve } from "../src/resolve.js";
import { makePortalChapters } from "../src/episodes.js";
import { PortalError } from "../src/portal.js";
import { UA_CDN } from "../src/config.js";

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const NOW_S = NOW / 1000;
// The kit's own reading of the manifest (it derives streamHostsAny and the rest), as the app does.
const checkedManifest = validateManifest(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
assert.ok(checkedManifest.ok, checkedManifest.message);
const manifest = checkedManifest.manifest;
const FAR = "9999999999";

// ---- fixtures ---------------------------------------------------------------------------------

const media = (contentId = "M1", videoFormat = "mp4", encodeFormat = "h264", extra = {}) =>
  ({ contentId, videoFormat, encodeFormat, licenseList: [{ license: "LIC123" }], ...extra });
// A v10/startPlayVOD answer as the portal sends it.
const play = (movies = [media()], subtitleList = undefined) =>
  ({ episodeList: [{ totalMovieList: [{ movieList: movies }], ...(subtitleList ? { subtitleList } : {}) }] });
// A v14/getSlbInfo answer: `url` is a loose querystring, `main_addr` hangs off the cdn.
const slb = ({ auth = `cdn_type=1&sign_type=cfl&token=ABC&expired=${FAR}`, tag = "free", mainAddr = "https://cdn.example.com", invalidTime = "14400" } = {}) =>
  ({ invalidTime, cdn_list: [{ tag: "vod", main_addr: mainAddr, url_list: [{ tag, url: auth }] }] });
const chapter = (n, extra = {}) => ({ seriesNumber: String(n), contentId: `EP${n}`, name: `Capitulo ${n}`, ...extra });
const detail = (chapters) => ({ assetData: { keyWords: "", volumnCount: String(chapters.length), sameSeasonSeriesList: [], simpleProgramList: chapters } });

const MOVIE = "magis1:movie:0:M1";
const SERIE = "magis1:teleplay:0:SERIE";

// Fake portal: per-path FIFO queue of answers (a value, an Error, or a function of the bean).
function fakePortal(queues = {}, events = []) {
  const calls = [];
  return {
    calls,
    queue(path, v) { (queues[path] ??= []).push(v); },
    times: (path) => calls.filter((c) => c.path === path).length,
    async call(path, bean, opts = {}) {
      events.push("portal:" + path);
      calls.push({ path, bean, opts });
      await Promise.resolve();
      const q = queues[path];
      if (!q || q.length === 0) throw new Error("unscripted portal call " + path);
      const a = q.shift();
      const v = typeof a === "function" ? a(bean) : a;
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

function setup({ queues = {}, config = { appId: "app.id", apkVersion: "49902" }, now = NOW, ensureError = null, token = "tok1" } = {}) {
  const kino = fakeKino();
  const events = [];
  const portal = fakePortal(queues, events);
  const session = {
    token,
    ensures: 0,
    ensure: async () => { session.ensures++; events.push("ensure"); if (ensureError) throw ensureError; },
    // The real one reads the token inside the block (a retry runs with the renewed one) and lets portal errors out.
    withValidSession: async (block) => block({ userId: "u1", userToken: session.token }),
  };
  const clock = { t: now, now() { return this.t; } };
  const portalChapters = makePortalChapters({ kino, portal, session, clock });
  const resolver = makeResolve({ kino, portal, session, clock, config, portalChapters });
  return { kino, portal, session, clock, events, resolve: resolver.resolve };
}

// A movie answered with `movies` and the given slb.
const movieQueues = (movies = [media()], slbAnswer = slb()) => ({ "v10/startPlayVOD": [play(movies)], "v14/getSlbInfo": [slbAnswer] });

const rejectsWith = (promise, code, message) => assert.rejects(promise, (e) => {
  assert.equal(e.code, code);
  if (message !== undefined) assert.equal(e.message, message);
  return true;
});

// ---- the stream a movie resolves to -----------------------------------------------------------

test("a movie: final url, mime and the five CDN headers (returned in the stream), no durationMs surprise", async () => {
  const t = setup({ queues: movieQueues([media()], slb({ mainAddr: "cdn.example.com" })) });
  const out = await t.resolve(MOVIE);
  assert.equal(out.url, "https://cdn.example.com/vod/M1_media.mp4");
  assert.equal(out.mime, "video/mp4");
  assert.deepEqual(out.headers, {
    "Content-Auth": `cdn_type=1&sign_type=cfl&token=ABC&expired=${FAR}`,
    "Content-License": "LIC123",
    "User-Agent": UA_CDN,
    App: "app.id",
    "App-Version": "49902",
  });
  assert.equal(UA_CDN, "Ranger/4.9.4-17294ac0");
  assert.deepEqual(out.subtitles, []);
  assert.equal(out.durationMs, 0);
  for (const dropped of ["videoCodec", "container", "expiresInSeconds", "drm", "signing"]) assert.equal(dropped in out, false, dropped);
});

test("v10/startPlayVOD gets the movie's id, no series id, the fixed fields and the session's credentials", async () => {
  const t = setup({ queues: movieQueues() });
  await t.resolve(MOVIE);
  const [call] = t.portal.calls;
  assert.equal(call.path, "v10/startPlayVOD");
  assert.deepEqual(call.bean, { contentId: "M1", seriesContentId: "", startTime: 0, type: "1", columnId: 0, authType: "" });
  assert.deepEqual(call.opts, { baseFields: true, userId: "u1", userToken: "tok1" });
});

test("ensure() runs before the first portal call", async () => {
  const t = setup({ queues: movieQueues() });
  await t.resolve(MOVIE);
  assert.deepEqual(t.events.slice(0, 2), ["ensure", "portal:v10/startPlayVOD"]);
});

test("main_addr: a trailing slash is trimmed, a path and http are kept, a bare host gets https", async () => {
  const cases = [
    ["https://cdn.example.com/", "https://cdn.example.com/vod/M1_media.mp4"],
    ["http://cdn.example.com/v3/youshi/", "http://cdn.example.com/v3/youshi/vod/M1_media.mp4"],
    ["cdn.example.com", "https://cdn.example.com/vod/M1_media.mp4"],
  ];
  for (const [mainAddr, url] of cases) {
    const t = setup({ queues: movieQueues([media()], slb({ mainAddr })) });
    assert.equal((await t.resolve(MOVIE)).url, url, mainAddr);
  }
});

test("a ts is served as .ts and declared video/mp2t; anything else is .mp4", async () => {
  const ts = await setup({ queues: movieQueues([media("T9", "ts")]) }).resolve(MOVIE);
  assert.equal(ts.url, "https://cdn.example.com/vod/T9_media.ts");
  assert.equal(ts.mime, "video/mp2t");
  const odd = await setup({ queues: movieQueues([media("X1", "mkv")]) }).resolve(MOVIE);
  assert.equal(odd.url, "https://cdn.example.com/vod/X1_media.mp4");
  assert.equal(odd.mime, "video/mp4");
});

// ---- bestMedia --------------------------------------------------------------------------------

test("h264 beats mp4: an h264 ts wins over an h265 mp4, and its license is the one sent", async () => {
  const movies = [media("HEVC", "mp4", "h265", { licenseList: [{ license: "L-HEVC" }] }), media("AVC", "ts", "h264", { licenseList: [{ license: "L-AVC" }] })];
  const out = await setup({ queues: movieQueues(movies) }).resolve(MOVIE);
  assert.equal(out.url, "https://cdn.example.com/vod/AVC_media.ts");
  assert.equal(out.headers["Content-License"], "L-AVC");
});

test("bestMedia is stable (the first of equals wins) and looks over every totalMovieList", async () => {
  const equal = [media("PRIMERA", "ts"), media("SEGUNDA", "ts")];
  assert.equal((await setup({ queues: movieQueues(equal) }).resolve(MOVIE)).url, "https://cdn.example.com/vod/PRIMERA_media.ts");
  const split = { episodeList: [{ totalMovieList: [{ movieList: [media("A", "ts", "h265")] }, { movieList: [media("B", "mp4", "h264")] }] }] };
  const t = setup({ queues: { "v10/startPlayVOD": [split], "v14/getSlbInfo": [slb()] } });
  assert.equal((await t.resolve(MOVIE)).url, "https://cdn.example.com/vod/B_media.mp4");
  // Case-insensitive formats, as native lowercases them.
  const upper = await setup({ queues: movieQueues([media("U", "TS", "H264")]) }).resolve(MOVIE);
  assert.equal(upper.url, "https://cdn.example.com/vod/U_media.ts");
});

// ---- synthetic failures -----------------------------------------------------------------------

test("no episodeList / no media: unavailable with the native text, no getSlbInfo", async () => {
  for (const answer of [{ returnCode: "0" }, { episodeList: [] }, { episodeList: [{ totalMovieList: [] }] }]) {
    const t = setup({ queues: { "v10/startPlayVOD": [answer] } });
    await rejectsWith(t.resolve(MOVIE), "unavailable", "Xuper devolvió sin media reproducible");
    assert.equal(t.portal.times("v14/getSlbInfo"), 0);
  }
});

test("no licenseList (or a blank license): unavailable, getSlbInfo never asked", async () => {
  for (const m of [{ contentId: "M1", videoFormat: "mp4", encodeFormat: "h264" }, media("M1", "mp4", "h264", { licenseList: [{ license: "  " }] })]) {
    const t = setup({ queues: { "v10/startPlayVOD": [play([m])] } });
    await rejectsWith(t.resolve(MOVIE), "unavailable", "Xuper devolvió sin licenseList");
    assert.equal(t.portal.times("v14/getSlbInfo"), 0);
  }
});

test("a similar-looking sign_type (cflx) and a non-free tier are not a usable vod CDN", async () => {
  for (const answer of [slb({ auth: "sign_type=cflx&token=ABC" }), slb({ tag: "pay" })]) {
    await rejectsWith(setup({ queues: movieQueues([media()], answer) }).resolve(MOVIE), "unavailable", "Xuper no expuso CDN de vod con token libre");
  }
  // Only a `vod` cdn counts, and the sign_type field alone is enough when the querystring lacks it.
  const live = { cdn_list: [{ tag: "live", main_addr: "cdn.example.com", url_list: [{ tag: "free", url: "sign_type=cfl&token=ABC" }] }] };
  await rejectsWith(setup({ queues: movieQueues([media()], live) }).resolve(MOVIE), "unavailable");
  const bySignType = { cdn_list: [{ tag: "vod", main_addr: "cdn.example.com", url_list: [{ tag: "free", sign_type: "cfl", url: "token=ABC" }] }] };
  assert.equal((await setup({ queues: movieQueues([media()], bySignType) }).resolve(MOVIE)).headers["Content-Auth"], "token=ABC");
});

test("the first vod cdn with a free cfl entry wins, even when an earlier cdn or entry does not qualify", async () => {
  const answer = { cdn_list: [
    { tag: "vod", main_addr: "https://bad.example.com", url_list: [{ tag: "free", url: "sign_type=other" }, { tag: "pay", url: "sign_type=cfl&token=PAY" }] },
    { tag: "vod", main_addr: "https://good.example.com", url_list: [{ tag: "free", url: "a=1&sign_type=cfl&token=GOOD" }] },
  ] };
  const out = await setup({ queues: movieQueues([media()], answer) }).resolve(MOVIE);
  assert.equal(out.url, "https://good.example.com/vod/M1_media.mp4");
  assert.equal(out.headers["Content-Auth"], "a=1&sign_type=cfl&token=GOOD");
});

// ---- subtitles and duration -------------------------------------------------------------------

test("subtitles: language, url and format (srt by default); a language with no file is dropped", async () => {
  const subs = [
    { language: "es", file: [{ url: "https://s.example.com/es.srt", fileType: "srt" }] },
    { language: "pt", file: [] },
    { language: "en", file: [{ url: "  ", fileType: "vtt" }] },
    { language: "fr", file: [{ url: "https://s.example.com/fr", fileType: "" }] },
    { language: "de", file: [{ url: "https://s.example.com/de.vtt", fileType: "vtt" }] },
    { language: "it" },
  ];
  const t = setup({ queues: { "v10/startPlayVOD": [play([media()], subs)], "v14/getSlbInfo": [slb()] } });
  assert.deepEqual((await t.resolve(MOVIE)).subtitles, [
    { lang: "es", url: "https://s.example.com/es.srt", format: "srt" },
    { lang: "fr", url: "https://s.example.com/fr", format: "srt" },
    { lang: "de", url: "https://s.example.com/de.vtt", format: "vtt" },
  ]);
});

test("duration: number = seconds, HH:MM:SS, MM:SS and bare digits; anything else is 0", async () => {
  const cases = [
    ['"01:02:03"', 3723_000], ['"02:03"', 123_000], ['"7010"', 7_010_000], [7010, 7_010_000], [90.5, 90_500],
    ['"un rato"', 0], ['"1:2:3:4"', 0], ['"1::3"', 0], ['""', 0], ['"  "', 0], ['"-5"', 0], [null, 0], [[5], 0], [true, 0],
  ];
  for (const [raw, expected] of cases) {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const t = setup({ queues: movieQueues([media("M1", "mp4", "h264", { duration: value })]) });
    assert.equal((await t.resolve(MOVIE)).durationMs, expected, `duration ${raw}`);
  }
  assert.equal((await setup({ queues: movieQueues([media("M1", "mp4", "h264", { duration: "  01:00  " })]) }).resolve(MOVIE)).durationMs, 60_000);
});

// ---- series -----------------------------------------------------------------------------------

const seriesQueues = (chapters, extra = {}) => ({
  "v4/getItemData": [detail(chapters)],
  "v10/startPlayVOD": [play([media("EPMEDIA")])],
  "v14/getSlbInfo": [slb()],
  ...extra,
});

test("a chapter asked by number: its contentId plays, the series id travels, its duration wins", async () => {
  const t = setup({ queues: seriesQueues([chapter(1), chapter(2, { duration: "00:45:00" }), chapter(3)]) });
  const out = await t.resolve("magis1:teleplay:2:SERIE");
  assert.equal(out.url, "https://cdn.example.com/vod/EPMEDIA_media.mp4");
  assert.equal(out.durationMs, 2_700_000);
  assert.deepEqual(t.portal.calls.map((c) => c.path), ["v4/getItemData", "v10/startPlayVOD", "v14/getSlbInfo"]);
  const bean = t.portal.calls[1].bean;
  assert.equal(bean.contentId, "EP2");
  assert.equal(bean.seriesContentId, "SERIE");
});

test("episode 0 is the first chapter; the chapter's own duration wins even when it is absent (the media's is ignored)", async () => {
  const queues = seriesQueues([chapter(5), chapter(6)]);
  queues["v10/startPlayVOD"] = [play([media("EPMEDIA", "mp4", "h264", { duration: 5400 })])];
  const t = setup({ queues });
  const out = await t.resolve(SERIE);
  assert.equal(t.portal.calls[1].bean.contentId, "EP5");
  assert.equal(out.durationMs, 0);
});

test("the chapter is found by trimmed seriesNumber text; blank chapter contentId falls back to the series id", async () => {
  const t = setup({ queues: seriesQueues([{ seriesNumber: " 7 ", contentId: "  ", name: "x" }]) });
  await t.resolve("magis1:variety:7:SERIE");
  assert.equal(t.portal.calls[1].bean.contentId, "SERIE");
  assert.equal(t.portal.calls[1].bean.seriesContentId, "SERIE");
});

test("a series without the asked chapter, or with no chapters, is unavailable with the native text", async () => {
  const t = setup({ queues: { "v4/getItemData": [detail([chapter(1), chapter(2)])] } });
  await rejectsWith(t.resolve("magis1:teleplay:999:SERIE"), "unavailable", "la serie no tiene el capítulo 999");
  assert.equal(t.portal.times("v10/startPlayVOD"), 0);
  const empty = setup({ queues: { "v4/getItemData": [detail([])] } });
  await rejectsWith(empty.resolve("magis1:series:0:ABC"), "unavailable", "la serie ABC vino sin capítulos");
});

test("a second resolve of the same series reuses the cached chapter list", async () => {
  const queues = seriesQueues([chapter(1), chapter(2)]);
  queues["v10/startPlayVOD"] = [play([media("A")]), play([media("B")])];
  const t = setup({ queues });
  await t.resolve("magis1:teleplay:1:SERIE");
  const second = await t.resolve("magis1:teleplay:2:SERIE");
  assert.equal(t.portal.times("v4/getItemData"), 1);
  assert.equal(second.url, "https://cdn.example.com/vod/B_media.mp4");
  assert.equal(t.portal.calls.filter((c) => c.path === "v10/startPlayVOD")[1].bean.contentId, "EP2");
});

test("a chapter ref (programType teleplay, episode N) and a legacy gateway ref both resolve", async () => {
  // The legacy form the library may still hold: base64url(json).<hmac>, signature and expiry ignored.
  const legacy = (p) => Buffer.from(JSON.stringify({ s: "magis", p })).toString("base64url") + ".deadbeef";
  const movie = setup({ queues: movieQueues([media("L1")]) });
  assert.equal((await movie.resolve(legacy({ content_id: "L1", program_type: "movie", episode: 0 }))).url, "https://cdn.example.com/vod/L1_media.mp4");
  assert.equal(movie.portal.calls[0].bean.contentId, "L1");
  const series = setup({ queues: seriesQueues([chapter(1), chapter(2)]) });
  await series.resolve(legacy({ content_id: "SER", program_type: "teleplay", episode: 2 }));
  assert.equal(series.portal.calls[0].bean.contentId, "SER");
  assert.equal(series.portal.calls[1].bean.contentId, "EP2");
  assert.equal(series.portal.calls[1].bean.seriesContentId, "SER");
});

test("a ref that is not Xuper's is unavailable with the native text, and nothing is asked", async () => {
  for (const ref of ["https://example.com/video.mp4", "", "magis1:movie", null, undefined]) {
    const t = setup();
    await rejectsWith(t.resolve(ref), "unavailable", "ese ref no es de Xuper: no se puede reproducir");
    assert.equal(t.portal.calls.length, 0);
  }
});

// ---- SLB cache --------------------------------------------------------------------------------

test("getSlbInfo asks with the live code list as a REAL array and the app's version", async () => {
  const t = setup({ queues: movieQueues() });
  await t.resolve(MOVIE);
  const call = t.portal.calls.find((c) => c.path === "v14/getSlbInfo");
  assert.deepEqual(call.bean, {
    hasPay: "0", userIdentity: "1", type: "merge", appVer: "49902", lang: "es", encMediaSupported: 1,
    liveCodeList: ["masnew_live"], appParams: "", reserve1: "02:00:00:00:00:00", pipFlag: "0",
  });
  assert.ok(Array.isArray(call.bean.liveCodeList));
  assert.deepEqual(call.opts, { baseFields: true, userId: "u1", userToken: "tok1" });
});

test("getSlbInfo is asked once for two titles of the same token", async () => {
  const queues = { "v10/startPlayVOD": [play([media("A")]), play([media("B")])], "v14/getSlbInfo": [slb()] };
  const t = setup({ queues });
  await t.resolve(MOVIE);
  const second = await t.resolve(MOVIE);
  assert.equal(t.portal.times("v14/getSlbInfo"), 1);
  assert.equal(second.url, "https://cdn.example.com/vod/B_media.mp4");
  assert.equal(second.headers["Content-Auth"], `cdn_type=1&sign_type=cfl&token=ABC&expired=${FAR}`);
});

test("a new userToken asks getSlbInfo again", async () => {
  const queues = { "v10/startPlayVOD": [play([media("A")]), play([media("B")])], "v14/getSlbInfo": [slb(), slb()] };
  const t = setup({ queues });
  await t.resolve(MOVIE);
  t.session.token = "tok-new";
  await t.resolve(MOVIE);
  assert.equal(t.portal.times("v14/getSlbInfo"), 2);
  assert.equal(t.portal.calls.at(-1).opts.userToken, "tok-new");
});

test("a Content-Auth about to expire is served but not cached (lifetime <= 0)", async () => {
  const almost = `sign_type=cfl&token=ABC&expired=${NOW_S + 60}`; // 60 s - 300 s margin < 0
  const queues = { "v10/startPlayVOD": [play([media("A")]), play([media("B")])], "v14/getSlbInfo": [slb({ auth: almost }), slb()] };
  const t = setup({ queues });
  const first = await t.resolve(MOVIE);
  assert.equal(first.headers["Content-Auth"], almost);
  await t.resolve(MOVIE);
  assert.equal(t.portal.times("v14/getSlbInfo"), 2);
  // Exactly at the margin is also not cached (lifetime 0).
  const edge = setup({ queues: { "v10/startPlayVOD": [play(), play()], "v14/getSlbInfo": [slb({ auth: `sign_type=cfl&expired=${NOW_S + 300}` }), slb()] } });
  await edge.resolve(MOVIE);
  await edge.resolve(MOVIE);
  assert.equal(edge.portal.times("v14/getSlbInfo"), 2);
});

test("the cache lives min(invalidTime, expired - now - 300 s)", async () => {
  // expired = now + 400 s -> 100 s of life, whatever the 4 h invalidTime says.
  const q = () => ({ "v10/startPlayVOD": [play(), play(), play()], "v14/getSlbInfo": [slb({ auth: `sign_type=cfl&expired=${NOW_S + 400}` }), slb({ auth: `sign_type=cfl&expired=${NOW_S + 99_999}` })] });
  const t = setup({ queues: q() });
  await t.resolve(MOVIE);
  t.clock.t = NOW + 99_000;
  await t.resolve(MOVIE);
  assert.equal(t.portal.times("v14/getSlbInfo"), 1, "still cached at 99 s");
  t.clock.t = NOW + 100_000;
  await t.resolve(MOVIE);
  assert.equal(t.portal.times("v14/getSlbInfo"), 2, "expired at 100 s");

  // The declared invalidTime wins when it is shorter (60 s), and 300 s is the default when it is absent or odd.
  const declared = setup({ queues: { "v10/startPlayVOD": [play(), play(), play()], "v14/getSlbInfo": [slb({ invalidTime: "60" }), slb({ invalidTime: "60" })] } });
  await declared.resolve(MOVIE);
  declared.clock.t = NOW + 59_000;
  await declared.resolve(MOVIE);
  assert.equal(declared.portal.times("v14/getSlbInfo"), 1);
  declared.clock.t = NOW + 61_000;
  await declared.resolve(MOVIE);
  assert.equal(declared.portal.times("v14/getSlbInfo"), 2);

  for (const invalidTime of [undefined, "abc", "0", "-5"]) {
    const answer = slb(); if (invalidTime === undefined) delete answer.invalidTime; else answer.invalidTime = invalidTime;
    const d = setup({ queues: { "v10/startPlayVOD": [play(), play(), play()], "v14/getSlbInfo": [answer, slb()] } });
    await d.resolve(MOVIE);
    d.clock.t = NOW + 299_000;
    await d.resolve(MOVIE);
    assert.equal(d.portal.times("v14/getSlbInfo"), 1, `${invalidTime} cached 299 s`);
    d.clock.t = NOW + 301_000;
    await d.resolve(MOVIE);
    assert.equal(d.portal.times("v14/getSlbInfo"), 2, `${invalidTime} expired 301 s`);
  }
});

test("a numeric invalidTime counts like its text", async () => {
  const t = setup({ queues: { "v10/startPlayVOD": [play(), play(), play()], "v14/getSlbInfo": [slb({ invalidTime: 60 }), slb({ invalidTime: 60 })] } });
  await t.resolve(MOVIE);
  t.clock.t = NOW + 61_000;
  await t.resolve(MOVIE);
  assert.equal(t.portal.times("v14/getSlbInfo"), 2);
});

test("an slb with no usable vod cdn is never cached", async () => {
  const none = { invalidTime: "14400", cdn_list: [] };
  const t = setup({ queues: { "v10/startPlayVOD": [play(), play()], "v14/getSlbInfo": [none, slb()] } });
  await rejectsWith(t.resolve(MOVIE), "unavailable");
  assert.equal((await t.resolve(MOVIE)).url, "https://cdn.example.com/vod/M1_media.mp4");
  assert.equal(t.portal.times("v14/getSlbInfo"), 2);
});

// ---- errors -----------------------------------------------------------------------------------

test("geo-blocked on startPlayVOD (movie and chapter) is geo_blocked", async () => {
  const blocked = () => new PortalError("portal100024", "blocked");
  for (const ref of [MOVIE, "magis1:teleplay:2:SERIE"]) {
    const t = setup({ queues: { "v4/getItemData": [detail([chapter(1), chapter(2)])], "v10/startPlayVOD": [blocked()] } });
    await rejectsWith(t.resolve(ref), "geo_blocked", "Este contenido no está disponible en tu región");
  }
});

test("a title the portal does not have (portal error, reactivation blocked) is not_found", async () => {
  const t = setup({ queues: { "v10/startPlayVOD": [new PortalError("portal100008", "剧集不存在")] } });
  await rejectsWith(t.resolve(MOVIE), "not_found");
  assert.equal(t.portal.times("v14/getSlbInfo"), 0);
});

test("a dead session (aaa100028) is auth_required; a portal error on getSlbInfo is mapped too", async () => {
  const dead = setup({ queues: { "v10/startPlayVOD": [new PortalError("aaa100028", "未登录！")] } });
  await rejectsWith(dead.resolve(MOVIE), "auth_required", "Configura Xuper en Ajustes ▸ Plugins");
  const slbDead = setup({ queues: { "v10/startPlayVOD": [play()], "v14/getSlbInfo": [new PortalError("aaa100027", "")] } });
  await rejectsWith(slbDead.resolve(MOVIE), "auth_required");
});

test("a failing ensure() surfaces as the mapped error, before any portal call", async () => {
  const mapped = setup({ ensureError: new PortalError("aaa100028", "x"), queues: movieQueues() });
  await rejectsWith(mapped.resolve(MOVIE), "auth_required");
  assert.equal(mapped.portal.calls.length, 0);
  const own = setup({ ensureError: Object.assign(new Error("boom"), { name: "KinoError_unavailable", code: "unavailable" }), queues: movieQueues() });
  await rejects(own.resolve(MOVIE));
  const plain = setup({ ensureError: new TypeError("x is undefined"), queues: movieQueues() });
  await rejectsWith(plain.resolve(MOVIE), "unavailable", "Xuper no está disponible ahora");
  assert.equal(plain.portal.calls.length, 0);
});

async function rejects(promise) { await assert.rejects(promise, (e) => e.code === "unavailable"); }

test("kino errors (transport failures) pass through untouched; anything else is a Spanish unavailable", async () => {
  const kino = fakeKino();
  const mine = kino.error("unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento");
  const t = setup({ queues: { "v10/startPlayVOD": [mine] } });
  await assert.rejects(t.resolve(MOVIE), (e) => e === mine);
  const odd = setup({ queues: { "v10/startPlayVOD": [new TypeError("x is undefined")] } });
  await rejectsWith(odd.resolve(MOVIE), "unavailable", "Xuper no está disponible ahora");
});

test("a malformed portal answer is unavailable, never a crash", async () => {
  for (const answer of [null, [], "x", { episodeList: "no" }, { episodeList: [null] }]) {
    await rejectsWith(setup({ queues: { "v10/startPlayVOD": [answer] } }).resolve(MOVIE), "unavailable");
  }
});

// ---- what the kit and the app make of it ------------------------------------------------------

test("the kit accepts the stream; it has a downloadable shape (progressive file, <= 20 headers, no signing, no drm)", async () => {
  for (const format of ["mp4", "ts"]) {
    const subs = [{ language: "es", file: [{ url: "http://203.0.113.9/s/es.srt", fileType: "srt" }] }];
    const t = setup({ queues: { "v10/startPlayVOD": [play([media("M1", format)], subs)], "v14/getSlbInfo": [slb({ mainAddr: "http://203.0.113.9/v3/youshi/" })] } });
    const out = await t.resolve(MOVIE);
    const checked = checkOutput("resolve", out, manifest);
    assert.deepEqual(checked.drops, []);
    const s = checked.value;
    assert.ok(["video/mp4", "video/mp2t"].includes(s.mime));
    assert.ok(s.url.endsWith(`.${format}`) && !s.url.includes(".m3u8"));
    assert.ok(["http:", "https:"].includes(new URL(s.url).protocol));
    assert.ok(Object.keys(s.headers).length <= 20 && Object.keys(s.headers).length === 5);
    assert.deepEqual(Object.keys(s.headers).sort(), ["App", "App-Version", "Content-Auth", "Content-License", "User-Agent"]);
    assert.equal(s.drm, null);
    assert.equal(s.signing, false);
    assert.equal("signing" in out, false, "the plugin itself asks for no signing");
    assert.equal(s.subtitles.length, 1, "the plain-http subtitle host passes streamHosts any");
    assert.ok(manifest.capabilities.includes("download") && manifest.streamHosts === "any");
  }
});

// ---- parity with the device's captured resolutions --------------------------------------------
// resolve-1..6 were captured on a real device with the native implementation; they are git-excluded
// (real titles, hosts and tokens) and read by absolute path, never copied here. The device's
// `playable` is compared field by field; the headers the native bridge kept aside are the stream's
// own `headers` here. appId/apkVersion come from each fixture, at run time.

const FIXTURE_DIR = "/Users/cristian/kino-light/.claude/worktrees/xuper-plain-plugin/app/src/test/resources/xuper-parity";
const fixtureFiles = Array.from({ length: 6 }, (_, i) => `${FIXTURE_DIR}/resolve-${i + 1}.json`);
const haveFixtures = fixtureFiles.every(existsSync);

const sorted = (v) => {
  if (Array.isArray(v)) return `[${v.map(sorted).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sorted(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};

const answerOf = (c) => {
  if (c.ok) return c.ok;
  if (c.portalError) return new PortalError(c.portalError.code, c.portalError.msg ?? "");
  return new Error(c.redError);
};

// What the device's playable holds that a plugin Stream can carry (videoCodec, container, expiresAt,
// fallbackUrl, drmLicenseUrl have no SDK field).
const fromStream = (s) => ({ url: s.url, headers: s.headers, mime: s.mime, durationMs: s.durationMs, subtitles: s.subtitles });
const fromPlayable = (p) => ({ url: p.url, headers: p.headers, mime: p.mime, durationMs: p.durationMs, subtitles: p.subtitles });

for (const [i, file] of fixtureFiles.entries()) {
  test(`parity: resolve-${i + 1}.json reproduces the device's captured resolution and portal calls`, {
    skip: haveFixtures ? false : "resolve fixtures are git-excluded and absent here: nothing to compare against",
  }, async () => {
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    // The harness refused every call that would (re)activate or log in a device: the fake session never makes those.
    const live = fixture.portal.filter((c) => !c.blockedByHarness);
    const queues = {};
    for (const c of live) (queues[c.path] ??= []).push(answerOf(c));
    const t = setup({ queues, config: { appId: fixture.appId, apkVersion: fixture.apkVersion } });
    const ref = fixture.request.ref;
    if (fixture.expected.playable) {
      const out = await t.resolve(ref);
      assert.equal(sorted(fromStream(out)), sorted(fromPlayable(fixture.expected.playable)));
      assert.deepEqual(checkOutput("resolve", out, manifest).drops, []);
    } else {
      // The code comes from the portal answer that ended the resolution; any other error is the device's own text.
      const last = live.at(-1);
      const code = last.portalError
        ? ({ portal100004: "not_found", portal100024: "geo_blocked", aaa100027: "auth_required", aaa100028: "auth_required" }[last.portalError.code]
          ?? (last.portalError.msg?.includes("不存在") ? "not_found" : "unavailable"))
        : "unavailable";
      await assert.rejects(() => t.resolve(ref), (e) => {
        assert.equal(e.code, code);
        if (!last.portalError) assert.equal(e.message, fixture.expected.error.message);
        return true;
      });
    }
    assert.deepEqual(
      t.portal.calls.map((c) => `${c.path} ${sorted(c.bean)}`),
      live.map((c) => `${c.path} ${sorted(c.bean)}`),
    );
  });
}
