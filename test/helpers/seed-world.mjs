// A device for the seed tests (seed design §9): a fake Kino on a VIRTUAL clock (`Date.now` replaced; `kino.sleep`
// advances it; storage honours `ttlMs` as Kino does; `kino.log.report` recorded), the Xuper backend (/xuper/config,
// GET /seed that POPS: every seed is served once, with scripted statuses, and POST /seed, the contribution, recorded in
// `w.seeds`) and the masnew portal
// speaking the real 3DES wire, whose per-path handlers see the decrypted bean.
//
// Every secret value the world hands out carries "SECRET" (tokens, ids, jwt) so a test can scan everything the plugin
// writes to its logs, reports, errors and screens; `w.secrets()` also lists the device sns, the Bearer and the key.
import { installKino, res } from "./fake-kino.mjs";
import { encryptBody, decryptBlob } from "../../src/sources/xuper-crypto.js";

export const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";
export const BEARER = "bearer-SECRET-token";
export const SHARED = { email: "shared-SECRET@test.invalid", password: "pw-SECRET" };
/** 2026-11-17 10:05:00 UTC: 55 min left in the UTC hour. */
export const T0 = Date.UTC(2026, 10, 17, 10, 5, 0);
export const MIN = 60_000;
export const CONTENT = new Set(["getNextColumns", "v6/getLiveData", "v4/startPlayLive", "v14/getSlbInfo", "v3/searchByName", "v10/startPlayVOD"]);

const json = (o) => res(200, JSON.stringify(o));
const LIVE_TOKEN = "0123456789abcdef0123456789abcdef";

/** The portal's default answer for `path` (a working anonymous session). `n`: a per-path counter. */
function defaultAnswer(path, bean, n) {
  switch (path) {
    case "v3/snToken": return { snToken: "sntok-" + n, sn: "" };
    case "v8/active": return { userId: "OWNUID-SECRET-" + n, userToken: "OWNTOK-SECRET-" + n, jwtToken: "OWNJWT-SECRET-" + n, customer: "c1", activeTime: 1, availableTime: 2 };
    case "v8/login": return { userId: "SHAREDUID-SECRET", userToken: "SHAREDTOK-SECRET-" + n };
    case "getNextColumns": return bean.columnCode === "masnew_movies" ? { recommendList: [{ columnId: 77, name: "Peliculas" }] }
      : { recommendList: [{ columnId: 31, name: "Colombia" }, { columnId: 40, name: "Noticias" }] };
    case "v6/getLiveData": return { channelList: bean.pageNum === 1 ? [{ channelCode: "ch" + bean.columnId, name: "Canal " + bean.columnId }] : [] };
    case "v4/startPlayLive": return { liveAddressList: [{ playCode: "pc1", license: "LICENSE-1" }] };
    case "v14/getSlbInfo": return {
      invalidTime: 600,
      cdn_list: [
        { tag: "live", main_addr: "cdn1.test", url_list: [{ url: `http://cdn1.test/a?sign_type=cfl&token=${LIVE_TOKEN}&expired=9999999999`, sign_type: "cfl" }] },
        { tag: "vod", main_addr: "vod.test", url_list: [{ url: "http://vod.test/a?sign_type=cfl&expired=9999999999", sign_type: "cfl", tag: "free" }] },
      ],
    };
    case "v3/searchByName": return { searchItemList: [{ itemList: [{ contentId: "m1", name: "Pelicula Uno", programType: "movie" }] }] };
    case "v10/startPlayVOD": return { episodeList: [{ totalMovieList: [{ movieList: [{ contentId: "t1", encodeFormat: "h264", videoFormat: "mp4", licenseList: [{ license: "VLIC" }] }] }] }] };
    default: return {};
  }
}

export const portalError = (returnCode, errorMessage = "") => ({ returnCode, errorMessage });

/** A pool seed with `remaining_s` of life; `n` numbers it. `extra` merges into the seed object. */
export function poolSeed(n, remaining_s = 6 * 3600, extra = {}) {
  return {
    seed: { sn: "5eed" + String(n).padStart(28, "0"), userId: "SEEDUID-SECRET-" + n, userToken: "SEEDTOK-SECRET-" + n, jwtToken: "SEEDJWT-SECRET-" + n, mintedAt: Math.floor(T0 / 1000) - 3600, ...extra },
    remaining_s,
  };
}

/**
 * opts.handlers: { [path]: (bean, n, w) => answer | portalError(...) | Error | undefined (default) }.
 * opts.geo: "own" (content on any session but a seed's answers portal100024) | null.
 * opts.pool: seeds GET /seed pops (poolSeed()); opts.seedAnswer: (n, w) => a response | undefined (pop), for scripted statuses.
 * opts.storage: initial storage; opts.bearer: false = no Bearer; opts.sn: a stored device sn; opts.own: a stored own session token.
 * opts.routes: more routes after the backend's and the portal's (another source's world, e.g. test/helpers/stv-world.mjs).
 */
export async function world(opts = {}) {
  const clock = { now: opts.start ?? T0 };
  Date.now = () => clock.now;
  const pool = (opts.pool || []).slice();
  const portal = [];        // { path, bean, host }
  const events = [];        // "portal:<path>" | "seed:<status>", in order
  const counters = {};
  let gets = 0;
  const handlers = { ...(opts.handlers || {}) };
  const w = {
    clock, pool, portal, events, handlers,
    get gets() { return gets; },
    count: (path) => portal.filter((r) => r.path === path).length,
    paths: () => portal.map((r) => r.path),
    beans: (path) => portal.filter((r) => r.path === path).map((r) => r.bean),
    advance: (ms) => { clock.now += ms; },
    reports: [],
    seeds: [],      // what POST /seed received (the contribution)
    seedAuth: [],   // the Authorization header of each POST /seed
  };
  const routes = [async (url, init) => {
    if (/\/xuper\/config$/.test(url)) return json({ magisKey: KEY, email: SHARED.email, password: SHARED.password });
    if (/\/seed$/.test(url) && init && init.method === "POST") {
      // The contribution (src/api.js postSeed): recorded with the Bearer it carried; opts.postAnswer scripts a status.
      const scripted = opts.postAnswer ? opts.postAnswer(w) : undefined;
      if (scripted) { events.push("contrib:" + scripted.status); return scripted; }
      w.seeds.push(init.body && init.body.json ? init.body.json.seed : undefined);
      w.seedAuth.push(init.headers && init.headers.Authorization);
      events.push("contrib:201");
      return res(201, JSON.stringify({ ok: true }));
    }
    if (/\/seed$/.test(url)) {
      gets++;
      const scripted = opts.seedAnswer ? opts.seedAnswer(gets, w) : undefined;
      if (scripted) { events.push("seed:" + scripted.status); return scripted; }
      const next = pool.shift();
      if (!next) { events.push("seed:503"); return res(503, JSON.stringify({ detail: "no_seeds" })); }
      events.push("seed:200");
      const body = next.raw !== undefined ? next.raw
        : { seed: next.seedAsText ? JSON.stringify(next.seed) : next.seed, expires_at: next.expires_at ?? clock.now + next.remaining_s * 1000, remaining_s: next.remaining_s };
      return res(200, typeof body === "string" ? body : JSON.stringify(body));
    }
    const m = /^https:\/\/([^/]+)\/api\/portalCore\/(.+)$/.exec(url);
    if (!m) return undefined;
    const path = m[2];
    const bean = JSON.parse(decryptBlob(init.body, KEY));
    portal.push({ path, bean, host: m[1] });
    events.push("portal:" + path);
    counters[path] = (counters[path] || 0) + 1;
    if (opts.latency) {
      // A request costs `latency` ms, never more than its own timeout (then it fails with Kino's timeout error).
      const t = Number(init.timeoutMs) || 30_000;
      if (opts.latency > t) { clock.now += t; return Object.assign(new Error("timeout"), { code: "timeout" }); }
      clock.now += opts.latency;
    }
    let out = handlers[path] ? handlers[path](bean, counters[path], w) : undefined;
    if (out === undefined && opts.geo === "own" && CONTENT.has(path) && !String(bean.userToken).startsWith("SEEDTOK")) out = portalError("portal100024", "地区限制");
    if (out === undefined) out = defaultAnswer(path, bean, counters[path]);
    if (out instanceof Error) return out;
    if (out && out.returnCode) return json(out);
    return json({ returnCode: "0", data: encryptBody(JSON.stringify(out), KEY) });
  }, ...(opts.routes || [])];
  const storage = { ...(opts.storage || {}) };
  if (opts.bearer !== false) storage["o2:bearer"] = BEARER;
  storage["o2:xcfg"] = storage["o2:xcfg"] || JSON.stringify({ magisKey: KEY, email: SHARED.email, password: SHARED.password, at: clock.now });
  if (opts.sn) storage["o2:xsn"] = JSON.stringify({ sn: opts.sn, at: clock.now });
  if (opts.sn && opts.own) storage["o2:xsess"] = JSON.stringify({ sn: opts.sn, userId: "OWNUID-SECRET-0", userToken: opts.own, at: clock.now });
  const k = installKino({ routes, storage, lang: opts.lang });
  // Kino's storage TTL (the value is gone once its ttlMs passed), and what each write asked for.
  const base = k.kino.storage;
  const expires = new Map();
  w.ttl = new Map();
  const alive = (key) => { const e = expires.get(key); if (e != null && clock.now >= e) { base.remove(key); expires.delete(key); } };
  k.kino.storage = {
    get: (key) => { alive(String(key)); return base.get(key); },
    set: (key, v, o) => {
      base.set(key, v);
      if (o && o.ttlMs > 0) { expires.set(String(key), clock.now + o.ttlMs); w.ttl.set(String(key), o.ttlMs); } else { expires.delete(String(key)); w.ttl.delete(String(key)); }
    },
    remove: (key) => { base.remove(key); expires.delete(String(key)); },
    keys: () => base.keys().filter((key) => { alive(key); return base.get(key) !== null; }),
  };
  k.kino.sleep = async (ms) => { clock.now += Math.max(0, Number(ms) || 0); };
  k.kino.log.report = (...a) => { w.reports.push(a.join(" ")); k.logs.push(a.join(" ")); };
  k.kino.seed = () => { throw new Error("kino.seed is no longer used: the contribution goes to POST /seed"); };
  k.kino.error = (code, msg, o) => Object.assign(new Error(msg), { code }, o && o.userMessage ? { userMessage: o.userMessage } : {});
  w.kino = k.kino;
  w.store = k.store;
  w.logs = k.logs;
  w.state = () => { const t = k.kino.storage.get("o2:xseedSt"); return t ? JSON.parse(t) : {}; };
  w.held = () => { const t = k.kino.storage.get("o2:xseed"); return t ? JSON.parse(t) : null; };
  /** Every secret value this world handed out or holds (to scan logs, reports, errors and screens for). */
  w.secrets = () => {
    const out = new Set([BEARER, KEY, SHARED.email, SHARED.password]);
    for (const r of portal) for (const f of ["userId", "userToken", "sn"]) if (r.bean[f]) out.add(String(r.bean[f]));
    for (const s of opts.pool || []) for (const f of ["sn", "userId", "userToken", "jwtToken"]) if (s.seed && s.seed[f]) out.add(String(s.seed[f]));
    const sn = k.kino.storage.get("o2:xsn");
    if (sn) out.add(JSON.parse(sn).sn);
    return [...out].filter((v) => v.length >= 6);
  };
  return w;
}
