// A scripted Magis portal over the REAL makePortal + makeCrypto + makeSession, with an injected
// clock that moves only when a request "takes" time: a dead host spends its whole request timeout
// and throws (a black hole), an alive host spends `aliveMs` and answers its route. The modules the
// exports use (catalog, resolve, live) are built exactly as src/wiring.js builds them.
import assert from "node:assert/strict";
import { fakeKino } from "./fakeKino.mjs";
import { makePortal } from "../../src/portal.js";
import { makeCrypto } from "../../src/crypto.js";
import { makeSession } from "../../src/session.js";
import { makeCatalog } from "../../src/catalog.js";
import { makeResolve } from "../../src/resolve.js";
import { makeLiveCatalog } from "../../src/liveCatalog.js";
import { makeLive } from "../../src/live.js";
import { makeTmdb } from "../../src/tmdb.js";
import { makeCountryRow } from "../../src/countryRow.js";

export const START = 1_000_000;
export const STORED = { userId: "u-dev", userToken: "tok-dev", jwtToken: "", sn: "sn-dev", acct: "" };
export const SEEDS = [
  { sn: "seed-sn-1", userId: "seed-u1", userToken: "seedtok1" },
  { sn: "seed-sn-2", userId: "seed-u2", userToken: "seedtok2" },
];
const FAR = "9999999999";
const TOKEN = "0123456789abcdef0123456789abcdef";

// Answers every content path needs; a test overrides what it is about.
export const ANSWERS = {
  "v3/snToken": { snToken: "SNTOK" },
  "v8/active": { userId: "u-new", userToken: "tok-new", jwtToken: "" },
  "v8/login": { userId: "u-acct", userToken: "tok-acct", jwtToken: "" },
  "v3/searchByName": { searchItemList: [{ itemList: [{ contentId: "D1", name: "Dune Test", programType: "movie", releaseTime: "2021-10-22" }] }] },
  getNextColumns: (bean) => (bean.columnCode === "masnew_live"
    ? { recommendList: [{ columnId: 7, name: "Noticias" }] }
    : { recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 6 }, (_, i) => ({ contentId: `PEL${i + 1}`, name: "Titulo " + i, programType: "movie", tags: "Drama", score: 7 })) }] }),
  "v4/getItemData": { assetData: { keyWords: "", volumnCount: "1", sameSeasonSeriesList: [], simpleProgramList: [{ seriesNumber: "1", contentId: "EP1", name: "Capitulo 1" }] } },
  "v10/startPlayVOD": { episodeList: [{ totalMovieList: [{ movieList: [{ contentId: "M1", videoFormat: "mp4", encodeFormat: "h264", licenseList: [{ license: "LIC" }] }] }] }] },
  "v14/getSlbInfo": (bean) => (bean.liveCodeList && bean.liveCodeList[0] !== "masnew_live"
    ? { invalidTime: "14400", cdn_list: [{ tag: "live", main_addr: "live.cdn.test", url_list: [{ url: `sign_type=cfl&token=${TOKEN}&expired=${FAR}` }] }] }
    : { invalidTime: "14400", cdn_list: [{ tag: "vod", main_addr: "https://vod.cdn.test", url_list: [{ tag: "free", url: `cdn_type=1&sign_type=cfl&token=x&expired=${FAR}` }] }] }),
  "v4/startPlayLive": { liveAddressList: [{ playCode: "pc", license: "LIC-LIVE" }] },
  "v6/getLiveData": { channelList: [{ channelCode: "CH1", name: "Canal 1", channelNumber: 1 }] },
  "v5/loginOut": {},
};

/**
 * `dead`: hosts that never answer. `routes`: path -> answer | (bean) => answer; an answer with
 * `returnCode` is a portal error. `session`: what is stored (null = a fresh install). `seeds`: the
 * stored pool (null = none); `seedsText`: what the pool URL serves; `seedsDead`: it never answers.
 * `config`: plugin settings. `aliveMs`: what one answered request costs. `shared`: the shared pair.
 */
export function portalWorld({
  hosts = ["a.test", "b.test"], dead = [], routes = {}, session = STORED, seeds = null, seedsText = "[]",
  seedsDead = false, config = {}, aliveMs = 200, tmdbDead = false, withTmdb = false, shared,
} = {}) {
  const clock = { t: START, now() { return this.t; } };
  let alive = aliveMs; // what one answered request costs; `setAliveMs` changes it (a portal that turns slow)
  const requests = [];
  const seedDownloads = [];
  const tmdbRequests = [];
  let crypto = null;
  const all = { ...ANSWERS, ...routes };
  const reply = (obj) => ({ ok: true, status: 200, text: () => JSON.stringify(obj) });
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    assert.ok(opts.timeoutMs > 0, "every request carries a positive timeout");
    if (u.host === "raw.githubusercontent.com") {
      seedDownloads.push({ timeoutMs: opts.timeoutMs, at: clock.t });
      if (seedsDead) { clock.t += opts.timeoutMs; throw new Error("timeout"); }
      clock.t += alive;
      return { ok: true, status: 200, text: () => seedsText };
    }
    if (u.host === "api.themoviedb.org") {
      tmdbRequests.push({ timeoutMs: opts.timeoutMs, at: clock.t });
      if (tmdbDead) { clock.t += opts.timeoutMs; throw new Error("timeout"); }
      clock.t += alive;
      return { ok: false, status: 404, text: () => "{}" };
    }
    const path = u.pathname.slice("/api/portalCore/".length);
    const bean = JSON.parse(crypto.decryptBlob(opts.body));
    requests.push({ host: u.host, path, bean, timeoutMs: opts.timeoutMs, at: clock.t });
    if (dead.includes(u.host)) { clock.t += opts.timeoutMs; throw new Error("timeout"); }
    clock.t += Math.min(alive, opts.timeoutMs);
    if (alive > opts.timeoutMs) throw new Error("timeout");
    const route = all[path];
    if (route === undefined) throw new Error("unscripted portal path " + path);
    const out = typeof route === "function" ? route(bean) : route;
    if (out instanceof Error) throw out;
    if (out.returnCode !== undefined) return reply(out);
    return reply({ returnCode: "0", data: crypto.encryptBody(JSON.stringify(out)) });
  };
  const base = fakeKino({ config, fetch, secrets: { tmdbKey: "stand-in-tmdb" } });
  const logs = [];
  // kino.log.report (apiVersion 6): the line is a log line like any other, and also a degraded-result report.
  const reports = [];
  const log = Object.assign((...a) => logs.push(a.map(String).join(" ")), {
    report: (...a) => { const line = a.map(String).join(" "); logs.push(line); reports.push(line); },
  });
  const kino = Object.freeze({ ...base, log });
  crypto = makeCrypto(kino);
  if (session) kino.storage.set("session", JSON.stringify(session));
  if (seeds) kino.storage.set("seeds", JSON.stringify(seeds));
  const portalConfig = { hosts, appId: "app.test", apkVersion: "9.9.9" };
  let sess = null;
  const portal = makePortal({ kino, crypto, config: portalConfig, clock, snProvider: () => sess.current().sn });
  sess = makeSession({ kino, portal, clock, random: () => 0, shared });
  const live = makeLiveCatalog({ kino, portal, session: sess, clock });
  const catalog = makeCatalog({ kino, portal, session: sess, clock, tmdb: withTmdb ? makeTmdb({ kino, clock }) : null, countryRow: makeCountryRow({ kino, live }) });
  const liveStream = makeLive({ kino, portal, session: sess, clock, config: portalConfig, random: () => 0 });
  const resolve = makeResolve({ kino, portal, session: sess, clock, config: portalConfig, portalChapters: catalog.portalChapters, live: liveStream });
  return {
    kino, clock, requests, seedDownloads, tmdbRequests, logs, reports, portal, session: sess, catalog, resolve, live,
    elapsed: () => clock.t - START,
    setAliveMs: (ms) => { alive = ms; },
    stored: () => JSON.parse(kino.storage.get("session")),
    paths: () => requests.map((r) => r.path),
  };
}
