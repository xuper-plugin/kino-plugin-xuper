// End to end: every public export of src/plugin.js through the REAL wiring (makePortal, makeCrypto,
// makeSession, catalog, resolve, live...), over a scripted portal that lives at the HTTP level: it
// receives the encrypted request body, decrypts it with the stand-in key through the kit's crypto,
// checks the URL and the headers, and answers an encrypted JSON like the real portal.
//
// Module state: wiring.js memoizes its deps (and plugin.js its settings), so each test needs a
// fresh module graph. Instead of a reset hook in the production surface, the test bundles
// src/plugin.js with esbuild (the same call `npm run build` makes; the only difference is that the
// three config values that are empty until the owner supplies them are filled in) and imports the
// bundle with a unique `?t=` query: a brand new copy of every module, per test.
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput, checkSettingsOutput, migrateAnswer, validateManifest } from "../sdk/contract.mjs";
import { signingLane } from "../sdk/kino-shim.mjs";
import { SHARED_EMAIL, SHARED_PASSWORD, APK_VER_HEADER, SPKG_VER, USER_AGENT, CONTENT_TYPE, RATE_LIMIT_MS, PORTAL_CODE, LIVE_APP, LIVE_APP_VERSION } from "../src/config.js";

const ROOT = new URL("../", import.meta.url);
const checked = validateManifest(readFileSync(new URL("kino-plugin.json", ROOT), "utf8"));
assert.ok(checked.ok, checked.message);
const manifest = checked.manifest;

const HOST = "portal-a.test";
const APP = "app-id.test";
const APK = "9.9.9-test";
const TOKEN = "t".repeat(32);
const USER = "user-1";
const SN = "0123456789abcdef0123456789abcdef";
const SHARED_EMAIL_FAKE = "compartida@stand-in.test";
const SHARED_PASSWORD_FAKE = "shared-stand-in-pw";
const SEEDS_URL_PART = "raw.githubusercontent.com";

// ---- the module under test ---------------------------------------------------------------------

// config.js with its deployment values (and the shared pair) replaced by synthetic ones (whatever they hold: empty or real); each replacement must actually happen.
const FILL = [
  [/export const hosts = \[[^\]]*\];/, `export const hosts = ["${HOST}"];`, /var hosts = \[[^\]]*\];/, `var hosts = ["${HOST}"];`],
  [/export const APP_ID = "[^"]*";/, `export const APP_ID = "${APP}";`, /var APP_ID = "[^"]*";/, `var APP_ID = "${APP}";`],
  [/export const APK_VERSION = "[^"]*";/, `export const APK_VERSION = "${APK}";`, /var APK_VERSION = "[^"]*";/, `var APK_VERSION = "${APK}";`],
  [/export const SHARED_EMAIL = "[^"]*";/, `export const SHARED_EMAIL = "${SHARED_EMAIL_FAKE}";`, /var SHARED_EMAIL = "[^"]*";/, `var SHARED_EMAIL = "${SHARED_EMAIL_FAKE}";`],
  [/export const SHARED_PASSWORD = "[^"]*";/, `export const SHARED_PASSWORD = "${SHARED_PASSWORD_FAKE}";`, /var SHARED_PASSWORD = "[^"]*";/, `var SHARED_PASSWORD = "${SHARED_PASSWORD_FAKE}";`],
];
function fill(text, which) {
  let out = text;
  for (const row of FILL) {
    const [re, to] = which === "src" ? [row[0], row[1]] : [row[2], row[3]];
    assert.ok(re.test(out), "config value to fill not found: " + re);
    out = out.replace(re, to);
  }
  return out;
}

const BUILD = { bundle: true, format: "esm", target: "es2020", write: false, logLevel: "silent" };
const patchConfig = { name: "fill-config", setup(b) {
  b.onLoad({ filter: /src[\\/]config\.js$/ }, (args) => ({ contents: fill(readFileSync(args.path, "utf8"), "src"), loader: "js" }));
} };

const dir = mkdtempSync(join(tmpdir(), "e2e-"));
// The bundles read `kino` as a global, as the app provides it: whatever was there comes back after
// each test, and the temp dir with the bundles goes away with the file.
const priorKino = Object.getOwnPropertyDescriptor(globalThis, "kino");
const restoreKino = () => { if (priorKino) Object.defineProperty(globalThis, "kino", priorKino); else delete globalThis.kino; };
afterEach(restoreKino);
after(() => { restoreKino(); rmSync(dir, { recursive: true, force: true }); });
const srcBundle = (await build({ ...BUILD, entryPoints: [new URL("src/plugin.js", ROOT).pathname], plugins: [patchConfig] })).outputFiles[0].text;
writeFileSync(join(dir, "src-bundle.mjs"), srcBundle);
writeFileSync(join(dir, "built-bundle.mjs"), fill(readFileSync(new URL("plugin.js", ROOT), "utf8"), "built"));

let loads = 0;
const load = (file) => import(pathToFileURL(join(dir, file)).href + "?t=" + ++loads);

// ---- the scripted portal -------------------------------------------------------------------------

const hexToText = (hex) => Buffer.from(hex, "hex").toString("utf8");
const textToHex = (text) => Buffer.from(text, "utf8").toString("hex");

/**
 * `routes`: path -> (bean, ctx) => { data } | { returnCode, errorMessage } | an Error to throw.
 * Everything the plugin sends over HTTP lands in `log`; the crypto here is the kit's, not src/crypto.js.
 */
function scriptedKino({ routes = {}, config = {}, seeds = null, seedsText = "[]" } = {}) {
  const base = fakeKino({ config });
  const log = { requests: [], sleeps: [], other: [] };
  const encrypt = (plain) => textToHex(base.crypto.encrypt("des-ede3-ecb", { key: base.secret("magisKey"), data: plain, padding: "pkcs7" }));
  const decrypt = (wire) => base.crypto.decrypt("des-ede3-ecb", { key: base.secret("magisKey"), data: hexToText(wire), padding: "pkcs7" });
  const reply = (obj) => ({ text: () => JSON.stringify(obj) });
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.host === SEEDS_URL_PART) { log.other.push(url); return { text: () => seedsText }; }
    const prefix = "/api/portalCore/";
    assert.equal(u.protocol, "https:");
    assert.equal(u.host, HOST, "the portal host");
    assert.ok(u.pathname.startsWith(prefix), "portal path " + u.pathname);
    const path = u.pathname.slice(prefix.length);
    assert.equal(opts.method, "POST");
    const bean = JSON.parse(decrypt(opts.body));
    const req = { path, headers: opts.headers, bean };
    log.requests.push(req);
    const route = routes[path];
    if (!route) throw new Error("unscripted portal path " + path);
    const out = typeof route === "function" ? route(bean, req) : route;
    if (out instanceof Error) throw out;
    if (out.returnCode !== undefined) return reply(out);
    return reply({ returnCode: "0", data: encrypt(JSON.stringify(out.data)) });
  };
  // Settings the app changes behind the plugin's back (what a sync from another device does).
  const overrides = {};
  const configView = Object.freeze({
    get: (k) => (k in overrides ? overrides[k] : base.config.get(k)),
    all: () => ({ ...base.config.all(), ...overrides }),
  });
  const kino = Object.freeze({ ...base, config: configView, fetch, sleep: async (ms) => { log.sleeps.push(ms); } });
  if (seeds) base.storage.set("seeds", JSON.stringify(seeds));
  return { kino, log, setConfig: (values) => Object.assign(overrides, values), paths: () => log.requests.map((r) => r.path) };
}

const mint = {
  "v3/snToken": { data: { snToken: "SNTOKEN-1", sn: SN } },
  "v8/active": (bean) => {
    assert.equal(bean.sn, SN, "the device dict carries the minted sn (snProvider is wired)");
    assert.equal(bean.appId, APP);
    return { data: { userId: USER, userToken: TOKEN, jwtToken: "jwt" } };
  },
};
// A getNextColumns/chapters/etc. request made with the session: the base fields carry the session.
const withSession = (bean) => {
  assert.equal(bean.portalCode, PORTAL_CODE);
  assert.equal(bean.userId, USER);
  assert.equal(bean.userToken, TOKEN);
  assert.equal(bean.apkVersion, APK);
};

// ---- synthetic payloads ----------------------------------------------------------------------------

const asset = (id, extra = {}) => ({ contentId: id, name: "Titulo " + id, programType: "movie", tags: "Drama", score: 7, ...extra });
const tree = (prefix) => ({ recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 6 }, (_, i) => asset(`${prefix}${i + 1}`)) }] });
const homeRoutes = () => {
  const roots = { masnew_movies: "PEL", masnew_series: "SER", masnew_anime: "ANI", masnew_kids: "INF" };
  return {
    getNextColumns: (bean) => {
      withSession(bean);
      if (bean.columnCode === "masnew_live") {
        return { data: { recommendList: [
          { columnId: 11, name: "Noticias" }, { columnId: 12, name: "ChannelList" }, { columnId: 13, name: "Adultos" },
        ] } };
      }
      return { data: tree(roots[bean.columnCode]) };
    },
  };
};
const TOKEN_A = "0123456789abcdef0123456789abcdef";
const TOKEN_B = "fedcba9876543210fedcba9876543210";
const cflUrl = (token) => `cdn_type=1&sign_type=cfl&token=${token}&expired=1786300000`;
const liveRoutes = () => ({
  "v4/startPlayLive": (bean) => {
    withSession(bean);
    assert.equal(bean.channelCode, "CH1");
    return { data: { liveAddressList: [{ playCode: "pc-one", license: "LICENSE-ONE" }] } };
  },
  "v14/getSlbInfo": (bean) => {
    withSession(bean);
    return { data: { invalidTime: "14400", cdn_list: [
      { tag: "live", main_addr: "https://live1.test", url_list: [{ url: cflUrl(TOKEN_A) }] },
      { tag: "live", main_addr: "http://live2.test:8080/", url_list: [{ url: cflUrl(TOKEN_B) }] },
    ] } };
  },
  "v6/getLiveData": (bean) => {
    withSession(bean);
    assert.ok(bean.columnId === 11 || bean.columnId === 13, String(bean.columnId));
    if (bean.columnId === 13) return { data: { channelList: [{ channelCode: "AD1", name: "Canal Adulto", channelNumber: 90 }] } };
    return { data: { channelList: [{ channelCode: "CH1", name: "Canal Uno", channelNumber: 1 }, { channelCode: "CH2", name: "Canal Dos", channelNumber: 2 }] } };
  },
  ...homeRoutes(),
});
const vodRoutes = () => ({
  "v10/startPlayVOD": (bean) => {
    withSession(bean);
    return { data: { episodeList: [{ totalMovieList: [{ movieList: [{ contentId: "M1", videoFormat: "mp4", encodeFormat: "h264", licenseList: [{ license: "LIC-VOD" }] }] }] }] } };
  },
  "v14/getSlbInfo": (bean) => {
    withSession(bean);
    return { data: { invalidTime: "14400", cdn_list: [{ tag: "vod", main_addr: "https://vod.cdn.test", url_list: [{ tag: "free", url: cflUrl(TOKEN_A) }] }] } };
  },
  "v4/getItemData": (bean) => {
    withSession(bean);
    return { data: { assetData: { keyWords: "", volumnCount: "2", sameSeasonSeriesList: [], simpleProgramList: [
      { seriesNumber: "1", contentId: "EP1", name: "Capitulo 1" }, { seriesNumber: "2", contentId: "EP2", name: "Capitulo 2" },
    ] } } };
  },
  "v3/searchByName": (bean) => {
    withSession(bean);
    return { data: { searchItemList: [{ itemList: [asset("D1", { name: "Dune Test", releaseTime: "2021-10-22" })] }] } };
  },
});

// Starts a fresh plugin over a scripted kino; the bundle reads `kino` as a global, as the app does.
async function start(opts = {}, file = "src-bundle.mjs") {
  const s = scriptedKino({ ...opts, routes: { ...mint, ...(opts.routes || {}) } });
  globalThis.kino = s.kino;
  s.plugin = await load(file);
  return s;
}

const clean = (checkedOutput) => { assert.deepEqual(checkedOutput.drops, [], "the kit dropped something"); return checkedOutput.value; };
const kinoError = (code) => (e) => { assert.equal(e.name, "KinoError_" + code); return true; };

// ---- (1) + (4) every export is wired, answers pass the kit's checks with zero drops ----------------

test("search: through the real stack, kit check clean, and the portal request is the encrypted one", async () => {
  const s = await start({ routes: vodRoutes() });
  const out = await s.plugin.search({ q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 });
  assert.ok(out.length >= 1);
  assert.equal(out[0].id, "D1");
  clean(checkOutput("search", out, manifest));
  assert.deepEqual(s.paths(), ["v3/snToken", "v8/active", "v3/searchByName"]);
});

test("home and browse: four roots through getNextColumns, rows pass the kit, browse reads a row", async () => {
  const s = await start({ routes: homeRoutes() });
  const rows = await s.plugin.home();
  assert.ok(rows.length >= 1);
  clean(checkOutput("home", rows, manifest));
  assert.deepEqual([...new Set(s.log.requests.filter((r) => r.path === "getNextColumns").map((r) => r.bean.columnCode))].sort(),
    ["masnew_anime", "masnew_kids", "masnew_movies", "masnew_series"]);
  const page = await s.plugin.browse(rows[0].id, null);
  assert.ok(page.items.length >= 1);
  clean(checkOutput("browse", page, manifest));
});

test("episodes: a series ref lists its chapters", async () => {
  const s = await start({ routes: vodRoutes() });
  const out = await s.plugin.episodes("magis1:teleplay:0:SERIE");
  const kept = clean(checkOutput("episodes", out, manifest));
  assert.deepEqual(kept.episodes.map((e) => e.number), [1, 2]);
});

test("resolve (VOD movie): the CDN url and headers, kit check clean", async () => {
  const s = await start({ routes: vodRoutes() });
  const out = await s.plugin.resolve("magis1:movie:0:M1");
  assert.equal(out.url, "https://vod.cdn.test/vod/M1_media.mp4");
  assert.equal(out.headers["Content-License"], "LIC-VOD");
  assert.equal(out.headers.App, APP);
  assert.equal(out.headers["App-Version"], APK);
  clean(checkOutput("resolve", out, manifest));
});

test("resolve (VOD chapter): the chapter list feeds startPlayVOD with the chapter's own id", async () => {
  const s = await start({ routes: vodRoutes() });
  const out = await s.plugin.resolve("magis1:teleplay:2:SERIE");
  clean(checkOutput("resolve", out, manifest));
  const play = s.log.requests.find((r) => r.path === "v10/startPlayVOD");
  assert.equal(play.bean.contentId, "EP2");
  assert.equal(play.bean.seriesContentId, "SERIE");
});

test("resolve (live channel code) then sign: a request-signed stream whose signContext signs a CDN request", async () => {
  const s = await start({ routes: liveRoutes() });
  const out = await s.plugin.resolve("CH1", {});
  assert.equal(out.url, "http://live1.test/live/pc-one.m3u8");
  assert.equal(out.signing, "request");
  assert.deepEqual(out.alternateHosts, ["live2.test:8080"]);
  clean(checkOutput("resolve", out, manifest, [], { liveChannel: true }));
  const signed = await s.plugin.sign({ url: "http://live2.test:8080/live/pc-one/seg1.ts", context: out.signContext });
  const kept = clean(checkOutput("sign", signed, manifest));
  assert.equal(kept.headers["Content-License"], "LICENSE-ONE");
  assert.equal(kept.headers.App, LIVE_APP);
  assert.equal(kept.headers["App-Version"], LIVE_APP_VERSION);
  assert.ok(kept.headers["Content-Auth"].startsWith(cflUrl(TOKEN_B) + "&sign2_method=sign_o3"), "the second CDN's own token signs its host");
});

test("liveCategories and liveChannels: the adult category and its channels are marked adult (D3), all pass the kit", async () => {
  const s = await start({ routes: liveRoutes() });
  const cats = await s.plugin.liveCategories();
  assert.deepEqual(cats.map((c) => [c.title, c.adult === true]), [["Noticias", false], ["Todos", false], ["Adultos", true]]);
  clean(checkOutput("liveCategories", cats, manifest));
  const page = await s.plugin.liveChannels({ categoryId: "11" });
  assert.deepEqual(page.items.map((c) => c.id), ["CH1", "CH2"]);
  clean(checkOutput("liveChannels", page, manifest));
  const adult = await s.plugin.liveChannels({ categoryId: "13" });
  assert.deepEqual(adult.items.map((c) => [c.id, c.adult]), [["AD1", true]]);
  clean(checkOutput("liveChannels", adult, manifest));
});

test("migrate: claims a saved title, a chapter and a native live code, and leaves the rest alone", async () => {
  const s = await start();
  const inputs = [
    { kind: "title", ref: "magis1:movie:0:C100" },
    { kind: "chapter", ref: "magis1:teleplay:3:S9", season: 1 },
    { kind: "live", provider: "xuper", code: "CH1" },
    { kind: "title", ref: "https://example.com/x" },
    { kind: "live", provider: "legacy", code: "CH2" },
  ];
  const out = [];
  for (const input of inputs) {
    const v = await s.plugin.migrate(input);
    out.push(v);
    const r = migrateAnswer(v, input);
    assert.deepEqual(r.drops, [], JSON.stringify(v));
  }
  assert.deepEqual(out.map((v) => v && v.kind), ["movie", "episode", "live", undefined, "live"].map((k) => k ?? null));
  assert.equal(out[3], null);
  assert.deepEqual(s.log.requests, []);
});

test("settingsStatus: anonymous, no account saved", async () => {
  const s = await start();
  const out = await s.plugin.settingsStatus();
  assert.equal(out.status, "Sin cuenta: sesión anónima");
  assert.deepEqual(checkSettingsOutput("settingsStatus", out, manifest), out);
});

test("action login: one v8/login with the saved account, answer clean", async () => {
  const s = await start({ config: { email: "ana@x.test", password: "stand-in-pw" }, routes: {
    "v8/login": (bean) => {
      assert.equal(bean.userName, "ana@x.test");
      assert.notEqual(bean.password, "stand-in-pw", "the password never travels as typed");
      return { data: { userId: USER, userToken: TOKEN, jwtToken: "jwt" } };
    },
  } });
  const out = await s.plugin.action("login");
  assert.deepEqual(out, { message: "Sesión iniciada", refresh: true });
  const drops = [];
  checkSettingsOutput("action", out, manifest, (t) => t, (d) => drops.push(d));
  assert.deepEqual(drops, []);
});

test("action logout: loginOut with the session, then clearSettings survives the kit with no drops", async () => {
  const s = await start({ config: { email: "ana@x.test", password: "stand-in-pw" }, routes: {
    "v8/login": { data: { userId: USER, userToken: TOKEN, jwtToken: "jwt" } },
    "v5/loginOut": (bean) => { assert.equal(bean.userToken, TOKEN); return { data: {} }; },
  } });
  await s.plugin.action("login");
  const out = await s.plugin.action("logout");
  assert.ok(s.paths().includes("v5/loginOut"));
  const drops = [];
  const kept = checkSettingsOutput("action", out, manifest, (t) => t, (d) => drops.push(d));
  assert.deepEqual(drops, []);
  assert.deepEqual(kept.clearSettings, ["email", "password", "useSharedAccount"]);
});

test("validateSettings with the shared toggle: one v8/login with the (stand-in) shared pair, then the status line and a relogin follow it; the real pair never travels", async () => {
  const md5 = (t) => createHash("md5").update(t).digest("hex");
  let logins = 0;
  const s = await start({ routes: {
    "v8/login": (bean) => {
      logins++;
      assert.equal(bean.userName, SHARED_EMAIL_FAKE);
      assert.equal(bean.password, md5(SHARED_PASSWORD_FAKE + "cloudstream"));
      return { data: { userId: USER, userToken: TOKEN, jwtToken: "jwt" } };
    },
  } });
  await s.plugin.action("login").then(() => assert.fail("no own account saved"), kinoError("auth_required"));
  assert.equal(await s.plugin.validateSettings({ useSharedAccount: true }), null);
  assert.equal(logins, 1);
  assert.deepEqual(await s.plugin.validateSettings({ useSharedAccount: true, email: "ana@x.test", password: "pw" }),
    { useSharedAccount: "Quita tu cuenta o apaga la cuenta compartida" });
  s.setConfig({ useSharedAccount: true }); // the person saved it
  const st = await s.plugin.settingsStatus();
  assert.equal(st.status, "Cuenta compartida");
  assert.deepEqual(checkSettingsOutput("settingsStatus", st, manifest), st);
  assert.equal(await s.plugin.action("useShared"), null, "the action is gone");
  const lo = await s.plugin.action("logout");
  assert.deepEqual(lo.clearSettings, ["email", "password", "useSharedAccount"]);
  const all = JSON.stringify(s.log) + JSON.stringify(s.kino.storage.get("session"));
  assert.ok(!all.includes(SHARED_EMAIL) && !all.includes(SHARED_PASSWORD), "the real shared pair travelled");
});

test("credentials appear in config by sync: the next call logs in on the SAME sn (no new snToken) and the status follows", async () => {
  const md5 = (t) => createHash("md5").update(t).digest("hex");
  const s = await start({ routes: { ...vodRoutes(), "v8/login": (bean) => {
    assert.equal(bean.sn, SN, "the login bean carries this device's own sn");
    assert.equal(bean.userName, "ana@x.test");
    assert.equal(bean.password, md5("stand-in-pw" + "cloudstream"));
    return { data: { userId: USER, userToken: TOKEN, jwtToken: "jwt" } };
  } } });
  await s.plugin.search({ q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 });
  assert.deepEqual(s.paths(), ["v3/snToken", "v8/active", "v3/searchByName"]);
  assert.equal((await s.plugin.settingsStatus()).status, "Sin cuenta: sesión anónima");
  s.setConfig({ email: "ana@x.test", password: "stand-in-pw" }); // no validateSettings: the sandbox is just reopened
  assert.equal((await s.plugin.settingsStatus()).status, "Conectando con tu cuenta… Mientras tanto, sesión anónima");
  await s.plugin.search({ q: "Arrival", type: "any", season: 0, episode: 0, tmdbId: 0 });
  assert.deepEqual(s.paths().slice(3), ["v8/login", "v3/searchByName"]);
  assert.equal(s.paths().filter((p) => p === "v3/snToken").length, 1, "no device minted by a config change");
  assert.equal((await s.plugin.settingsStatus()).status, "Conectado como ana@x.test");
  const stored = JSON.parse(s.kino.storage.get("session"));
  assert.equal(stored.sn, SN);
  assert.ok(!JSON.stringify(s.kino.storage.get("session")).includes("stand-in-pw"));
});

test("action switchSeed and refreshSeeds: probe a pool seed, then re-download the pool", async () => {
  const pool = [{ sn: "aa".repeat(16), userId: "u-a", userToken: "a".repeat(32) }, { sn: "bb".repeat(16), userId: "u-b", userToken: "b".repeat(32) }];
  const s = await start({ seeds: pool, seedsText: JSON.stringify([...pool, { sn: "cc".repeat(16), userId: "u-c", userToken: "c".repeat(32) }]),
    routes: { "v8/active": (bean) => ({ data: { userId: "u-" + bean.sn.slice(0, 2), userToken: "z".repeat(32), jwtToken: "" } }) } });
  const sw = await s.plugin.action("switchSeed");
  assert.match(sw.message, /^Semilla cambiada \(intento 1\)$/);
  checkSettingsOutput("action", sw, manifest);
  const rf = await s.plugin.action("refreshSeeds");
  assert.equal(rf.message, "3 semillas cargadas");
  assert.equal(s.log.other.length, 1);
  assert.equal(await s.plugin.action("unknown"), null);
});

test("registration: sendCode then register through src/plugin.js over the scripted portal, kit clean", async () => {
  const email = "persona@ejemplo.test", pw = "stand-in-pw", code = "482913";
  const PEND_TOKEN = "p".repeat(32), NEW_TOKEN = "n".repeat(32);
  const s = await start({ config: { email, password: pw, verifyCode: code }, routes: {
    "v3/snToken": { data: { snToken: "SNTOKEN-PEND" } },
    "v8/active": () => ({ data: { userId: "u-pend", userToken: PEND_TOKEN, jwtToken: "" } }),
    "v2/sendEmailVerifyCode": (bean) => { assert.equal(bean.email, email); assert.equal(bean.userToken, PEND_TOKEN); return { data: {} }; },
    "v2/validateVerifyCode": (bean) => { assert.equal(bean.verifyCode, code); assert.equal(bean.userToken, PEND_TOKEN); return { data: {} }; },
    "v2/bindEmail": (bean) => { assert.notEqual(bean.pwd, pw, "the password never travels as typed"); return { data: {} }; },
    "v8/login": () => ({ data: { userId: "u-new", userToken: NEW_TOKEN, jwtToken: "jwt" } }),
  } });
  const sent = await s.plugin.action("sendCode");
  assert.equal(sent.message, "Te enviamos un código a " + email);
  checkSettingsOutput("action", sent, manifest);
  const done = await s.plugin.action("register");
  assert.deepEqual(s.paths(), ["v3/snToken", "v8/active", "v2/sendEmailVerifyCode", "v2/validateVerifyCode", "v2/bindEmail", "v8/login"]);
  const drops = [];
  const kept = checkSettingsOutput("action", done, manifest, (t) => t, (d) => drops.push(d));
  assert.deepEqual(drops, []);
  assert.deepEqual(kept.clearSettings, ["verifyCode"]);
  assert.equal(kept.refresh, true);
  const stored = JSON.parse(s.kino.storage.get("session"));
  assert.equal(stored.userToken, NEW_TOKEN);
  assert.notEqual(stored.sn, "");
  assert.equal(s.kino.storage.get("pendingRegistration"), null);
});

test("validateSettings: a good login accepts, refused credentials are a field error, blanks are anonymous", async () => {
  const s = await start({ routes: { "v8/login": (bean) => (bean.userName === "ana@x.test"
    ? { data: { userId: USER, userToken: TOKEN, jwtToken: "j" } } : { returnCode: "aaa100001", errorMessage: "bad" }) } });
  assert.equal(await s.plugin.validateSettings({}), null);
  assert.equal(await s.plugin.validateSettings({ email: "ana@x.test", password: "pw" }), null);
  const refused = await s.plugin.validateSettings({ email: "otra@x.test", password: "pw" });
  assert.deepEqual(refused, { password: "Credenciales de Xuper inválidas" });
  const kept = checkSettingsOutput("validateSettings", refused, manifest);
  assert.deepEqual(kept.fieldErrors, { password: "Credenciales de Xuper inválidas" });
  assert.equal(kept.accepted, false);
  assert.deepEqual(checkSettingsOutput("validateSettings", null, manifest), { accepted: true });
});

// ---- (2) error mapping ---------------------------------------------------------------------------------

test("portal return codes map to kino errors, and the kino error passes the export unchanged", async () => {
  const cases = [
    ["aaa100028", "auth_required", "Configura Xuper en Ajustes ▸ Plugins"],
    ["portal100024", "geo_blocked", "Este contenido no está disponible en tu región"],
    ["portal100004", "not_found", "No se encontró en Xuper"],
  ];
  for (const [returnCode, code, message] of cases) {
    const s = await start({ routes: { "v10/startPlayVOD": { returnCode, errorMessage: "" }, "v4/getItemData": { returnCode, errorMessage: "" } } });
    await assert.rejects(s.plugin.resolve("magis1:movie:0:M1"), (e) => { assert.equal(e.name, "KinoError_" + code); assert.equal(e.message, message); return true; });
    await assert.rejects(s.plugin.episodes("magis1:teleplay:0:SERIE"), (e) => { assert.equal(e.name, "KinoError_" + code); return true; });
  }
});

test("a gone series (portal100006) says so through the bundle: the chapter on resolve, the series on episodes", async () => {
  const gone = { returnCode: "portal100006", errorMessage: "剧集不存在" };
  const s = await start({ routes: { "v10/startPlayVOD": gone, "v4/getItemData": gone } });
  const notFound = (text) => (e) => { assert.equal(e.name, "KinoError_not_found"); assert.equal(e.userMessage, text); return true; };
  await assert.rejects(s.plugin.resolve("magis1:movie:0:M1"), notFound("Este capítulo ya no está disponible."));
  await assert.rejects(s.plugin.episodes("magis1:teleplay:0:SERIE"), notFound("Esta serie ya no está disponible."));
});

test("a non-kino error thrown inside an export becomes the Spanish unavailable", async () => {
  const s = await start();
  const bomb = new Proxy({}, { get() { throw new TypeError("secret detail"); } });
  for (const run of [
    () => s.plugin.search(bomb), () => s.plugin.liveChannels(bomb), () => s.plugin.sign(bomb), () => s.plugin.validateSettings(bomb),
  ]) {
    await assert.rejects(run(), (e) => {
      assert.equal(e.name, "KinoError_unavailable");
      assert.ok(!e.message.includes("secret detail"));
      assert.match(e.message, /^(Xuper no está disponible ahora|No se pudo firmar la petición del canal)$/);
      return true;
    });
  }
  // home with the portal answering garbage (not an encrypted JSON): every root is asked, each
  // garbage answer is a failed root, the pass is retried once and home throws the Spanish unavailable.
  const t = await start({ routes: { getNextColumns: { returnCode: "0", data: "zz" } } });
  await assert.rejects(t.plugin.home(), (e) => { assert.equal(e.name, "KinoError_unavailable"); assert.ok(!e.message.includes("zz")); return true; });
  assert.deepEqual([...new Set(t.log.requests.filter((r) => r.path === "getNextColumns").map((r) => r.bean.columnCode))].sort(),
    ["masnew_anime", "masnew_kids", "masnew_movies", "masnew_series"]);
});

// ---- (3) await null: a throw before the first await would abort the whole call ------------------------

test("every export returns a promise even when its argument blows up on first touch", async () => {
  const s = await start();
  const bomb = new Proxy({}, { get() { throw new Error("bomb"); }, has() { throw new Error("bomb"); }, ownKeys() { throw new Error("bomb"); } });
  const garbage = [undefined, null, 42, "x", bomb];
  for (const name of ["search", "home", "browse", "episodes", "resolve", "sign", "liveCategories", "liveChannels", "migrate", "settingsStatus", "action", "validateSettings"]) {
    assert.equal(typeof s.plugin[name], "function", name);
    for (const g of garbage) {
      let p;
      assert.doesNotThrow(() => { p = s.plugin[name](g, g); }, `${name}(${String(typeof g)}) threw synchronously`);
      assert.ok(p instanceof Promise, name);
      // Every outcome is checked: a kino error, or a defined answer (null is a valid "nothing").
      const outcome = await p.then((value) => ({ value }), (error) => ({ error }));
      if ("error" in outcome) assert.match(String(outcome.error && outcome.error.name), /^KinoError_/, `${name}(${String(typeof g)}) rejected with a non-kino error`);
      else assert.notEqual(outcome.value, undefined, `${name}(${String(typeof g)}) resolved to undefined`);
    }
  }
});

test("garbage arguments that cannot work reject (with a kino error), they never throw synchronously", async () => {
  const s = await start();
  const must = [
    ["sign", [null]], ["resolve", [undefined]], ["episodes", [42]], ["browse", [null, null]],
    ["liveChannels", [null]], ["liveChannels", [{ categoryId: "abc" }]],
  ];
  for (const [name, args] of must) {
    let p;
    assert.doesNotThrow(() => { p = s.plugin[name](...args); }, name);
    await assert.rejects(p, (e) => (e.name || "").startsWith("KinoError_"), name);
  }
});

test("each export's body starts with `await null` (checked in the source text)", () => {
  const text = readFileSync(new URL("src/plugin.js", ROOT), "utf8");
  const exportsList = [...text.matchAll(/export async function (\w+)\(([^)]*)\)\s*\{\s*(await null;)?/g)];
  assert.equal(exportsList.length, 14); // + section, categories (apiVersion 6)
  for (const m of exportsList) assert.ok(m[3], m[1] + " must start with await null");
});

// ---- (5) sign is pure ------------------------------------------------------------------------------------

test("sign never touches storage, fetch or sleep, and never builds the other deps", async () => {
  const touched = [];
  const spy = (name) => () => { touched.push(name); throw new Error(name + " must not be used by sign"); };
  const base = fakeKino();
  const recording = Object.freeze({
    ...base,
    fetch: spy("fetch"), sleep: spy("sleep"),
    storage: Object.freeze({ get: spy("storage.get"), set: spy("storage.set"), remove: spy("storage.remove"), keys: spy("storage.keys") }),
    config: Object.freeze({ get: spy("config.get") }),
    secret: spy("secret"),
  });
  globalThis.kino = recording;
  const plugin = await load("src-bundle.mjs");
  const context = JSON.stringify({ l: "LICENSE-ONE", c: [{ h: "live1.test", a: cflUrl(TOKEN_A) }] });
  const out = await plugin.sign({ url: "http://live1.test/live/x.m3u8", context });
  assert.ok(out.headers["Content-Auth"]);
  assert.deepEqual(touched, []);
  // the kit's own signing lane agrees
  globalThis.kino = signingLane(base);
  const lane = await (await load("src-bundle.mjs")).sign({ url: "http://live1.test/live/x.m3u8", context });
  assert.ok(lane.headers["Content-Auth"]);
});

// ---- (6) pacing and headers --------------------------------------------------------------------------------

test("the first portal request is not delayed, the next one waits out the 400 ms slot; headers are the exact set", async () => {
  const s = await start({ routes: homeRoutes() });
  // The bundle's clock is Date.now: frozen for the run, so the measure does not depend on how fast
  // this machine is (the scripted sleep is a no-op, so every later request sees the slot just taken).
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;
  try { await s.plugin.home(); } finally { Date.now = realNow; }
  const [first, second] = s.log.requests;
  assert.equal(first.path, "v3/snToken");
  assert.ok(s.log.sleeps.length >= 1, "later requests go through the pacing sleep");
  for (const ms of s.log.sleeps) assert.equal(ms, RATE_LIMIT_MS, "wait " + ms);
  assert.equal(s.log.requests.length, s.log.sleeps.length + 1, "exactly the first request skips the sleep");
  for (const r of s.log.requests) {
    assert.deepEqual(Object.keys(r.headers).sort(), ["Content-Type", "User-Agent", "apk", "apkVer", "spkgVer"]);
    assert.deepEqual(r.headers, { apk: APP, apkVer: APK_VER_HEADER, spkgVer: SPKG_VER, "User-Agent": USER_AGENT, "Content-Type": CONTENT_TYPE });
  }
  assert.equal(CONTENT_TYPE, "application/json;charset=utf-8");
  assert.ok(second);
});

// ---- the built bundle ----------------------------------------------------------------------------------------

test("plugin.js is what `npm run build` makes from src/ (not stale)", async () => {
  const fresh = (await build({ ...BUILD, entryPoints: [new URL("src/plugin.js", ROOT).pathname] })).outputFiles[0].text;
  assert.equal(readFileSync(new URL("plugin.js", ROOT), "utf8"), fresh, "run `npm run build`");
});

test("the BUILT bundle (what Kino loads) answers home and liveCategories over the scripted portal", async () => {
  const s = await start({ routes: homeRoutes() }, "built-bundle.mjs");
  const rows = await s.plugin.home();
  clean(checkOutput("home", rows, manifest));
  assert.ok(rows.length >= 1);
  const cats = await s.plugin.liveCategories();
  assert.deepEqual(cats.map((c) => [c.title, c.adult === true]), [["Noticias", false], ["Todos", false], ["Adultos", true]]);
  clean(checkOutput("liveCategories", cats, manifest));
});

// ---- breadcrumbs through the real bundle ----------------------------------------------------------

for (const file of ["src-bundle.mjs", "built-bundle.mjs"]) {
  test(`${file}: a failed export leaves its breadcrumbs (which export, code, ms) and none names a host, token, sn or the shared pair`, async () => {
    const s = await start({ routes: { "v3/searchByName": { returnCode: "portal100024", errorMessage: "geo" } } }, file);
    const lines = [];
    globalThis.kino = Object.freeze({ ...s.kino, log: (...a) => lines.push(a.map(String).join(" ")) });
    await assert.rejects(s.plugin.search({ q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 }), kinoError("geo_blocked"));
    assert.ok(lines.some((l) => /^xuper:call fail fn=search code=geo_blocked ms=\d+$/.test(l)), lines.join("\n"));
    assert.ok(lines.some((l) => /^xuper:session geo at=content mode=anon$/.test(l)), lines.join("\n"));
    const text = lines.join("\n");
    for (const secret of [HOST, APP, TOKEN, SN, USER, SHARED_EMAIL_FAKE, SHARED_PASSWORD_FAKE, SHARED_EMAIL, SHARED_PASSWORD].filter(Boolean)) {
      assert.ok(!text.includes(secret), "logged " + secret);
    }
    assert.deepEqual(lines.filter((l) => !l.startsWith("xuper:")), []);
  });
}
