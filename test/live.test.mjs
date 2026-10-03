// Live open (native-magis §6.4, MagisLive.kt + MagisLiveTest), the stream answer, retry/rotation
// (§6.6, AppGraph.onLiveConflict/resolveLive) and the routing of a bare channel code from resolve().
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput, validateManifest } from "../sdk/contract.mjs";
import { makeLive, bareHost } from "../src/live.js";
import { isChannelRef } from "../src/refs.js";
import { makeResolve } from "../src/resolve.js";
import { makeSession } from "../src/session.js";
import { PortalError } from "../src/portal.js";
import { signRequest } from "../src/liveSign.js";
import { signO3 } from "../src/tweakedMd5.js";

const checked = validateManifest(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
assert.ok(checked.ok, checked.message);
const manifest = checked.manifest;

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const TOKEN_A = "0123456789abcdef0123456789abcdef";
const TOKEN_B = "fedcba9876543210fedcba9876543210";
const TOKEN_C = "00112233445566778899aabbccddeeff";
const auth = (token) => `cdn_type=1&sign_type=cfl&token=${token}&expired=1786300000`;

// ---- fixtures ---------------------------------------------------------------------------------

const playLive = (...entries) => ({ liveAddressList: entries });
const OK_PLAY = playLive({ playCode: "cyx-2EF7E10E40C1ac19D6A9F3ED4CD2", license: "LIC-CORRECTO" });
// getSlbInfo in live mode: `main_addr` on the cdn, `url` a loose querystring.
const liveSlb = (hosts, invalidTime = "14400") =>
  ({ invalidTime, cdn_list: hosts.map(([host, a]) => ({ tag: "live", main_addr: host, url_list: [{ url: a }] })) });
const OK_SLB = liveSlb([["http://cdn1.live.test", auth(TOKEN_A)]]);

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
      const v = typeof a === "function" ? a(bean, opts) : a;
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

const seed = (sn) => ({ sn, userId: `u-${sn}`, userToken: `t-${sn}` });

function setup({ queues = {}, kind = "own", sn = "sn-own", pool = [], ensureError = null, random = () => 0, kinoOverride } = {}) {
  const kino = kinoOverride || fakeKino();
  const events = [];
  const portal = fakePortal(queues, events);
  const session = {
    ensures: 0,
    kindValue: kind,
    ensure: async () => { session.ensures++; events.push("ensure"); if (ensureError) throw ensureError; },
    // Like the real one: the token is read inside the block; portal errors come out as they are here.
    withValidSession: async (block) => block({ userId: "u1", userToken: "tok1" }),
    kind: () => session.kindValue,
    current: () => ({ userId: "u1", userToken: "tok1", jwtToken: "", sn }),
    seedPool: () => pool,
  };
  const clock = { t: NOW, now() { return this.t; } };
  const config = { appId: "app.id", apkVersion: "49902" };
  const live = makeLive({ kino, portal, session, clock, config, random });
  return { kino, portal, session, clock, events, live };
}

const rejectsWith = (promise, code, message) => assert.rejects(promise, (e) => {
  assert.equal(e.code, code);
  if (message !== undefined) assert.equal(e.message, message);
  return true;
});

const okQueues = (play = OK_PLAY, slb = OK_SLB) => ({ "v4/startPlayLive": [play], "v14/getSlbInfo": [slb] });

// ---- open: the two portal calls -------------------------------------------------------------

test("startPlayLive gets channelCode, columnId 0, type \"1\" and the session's credentials, after ensure()", async () => {
  const t = setup({ queues: okQueues() });
  await t.live.resolveLive("cyx-RCNHD");
  assert.deepEqual(t.events, ["ensure", "portal:v4/startPlayLive", "portal:v14/getSlbInfo"]);
  const [play, slb] = t.portal.calls;
  assert.deepEqual(play.bean, { channelCode: "cyx-RCNHD", columnId: 0, type: "1" });
  assert.deepEqual(play.opts, { baseFields: true, userId: "u1", userToken: "tok1" });
  assert.deepEqual(slb.opts, { baseFields: true, userId: "u1", userToken: "tok1" });
});

test("getSlbInfo asks for the CHANNEL's code (a real array), not the playCode, with the merge bean", async () => {
  const t = setup({ queues: okQueues(playLive({ playCode: "cyx-INTERNO", license: "L" })) });
  await t.live.resolveLive("cyx-RCNHD");
  const { bean } = t.portal.calls.find((c) => c.path === "v14/getSlbInfo");
  assert.deepEqual(bean, {
    hasPay: "0", userIdentity: "1", type: "merge", appVer: "49902", lang: "es", encMediaSupported: 1,
    liveCodeList: ["cyx-RCNHD"], appParams: "", reserve1: "02:00:00:00:00:00", pipFlag: "0",
  });
  assert.ok(Array.isArray(bean.liveCodeList));
});

test("the live SLB is never cached: two opens are four portal calls", async () => {
  const t = setup({ queues: { "v4/startPlayLive": [OK_PLAY, OK_PLAY], "v14/getSlbInfo": [OK_SLB, OK_SLB] } });
  await t.live.resolveLive("c");
  await t.live.resolveLive("c");
  assert.equal(t.portal.times("v14/getSlbInfo"), 2);
  assert.equal(t.portal.times("v4/startPlayLive"), 2);
});

// ---- the signal -----------------------------------------------------------------------------

test("playCode and license come from the SAME entry, never mixed", async () => {
  const t = setup({ queues: okQueues(playLive(
    { playCode: "cyx-2EF7E10E40C1ac19D6A9F3ED4CD2", license: "LIC-CORRECTO" },
    { playCode: "cyx-OTRO", license: "LIC-SENUELO" },
  )) });
  const out = await t.live.resolveLive("cyx-RCNHD");
  assert.equal(out.url, "http://cdn1.live.test/live/cyx-2EF7E10E40C1ac19D6A9F3ED4CD2.m3u8");
  assert.equal(JSON.parse(out.signContext).l, "LIC-CORRECTO");
});

test("if the first address has no playCode, the first COMPLETE one wins", async () => {
  const t = setup({ queues: okQueues(playLive({ playCode: "", license: "LIC-SIN-CODIGO" }, { playCode: "cyx-COMPLETA", license: "LIC-COMPLETA" })) });
  const out = await t.live.resolveLive("cyx-RCNHD");
  assert.ok(out.url.endsWith("/live/cyx-COMPLETA.m3u8"));
  assert.equal(JSON.parse(out.signContext).l, "LIC-COMPLETA");
});

test("with no complete entry: the FIRST entry's license and the channel's own code", async () => {
  const t = setup({ queues: okQueues(playLive({ license: "LIC-UNICA" }, { playCode: "cyx-X", license: "" })) });
  const out = await t.live.resolveLive("cyx-RCNHD");
  assert.equal(out.url, "http://cdn1.live.test/live/cyx-RCNHD.m3u8");
  assert.equal(JSON.parse(out.signContext).l, "LIC-UNICA");
});

test("no liveAddressList (or no object in it): live_no_addresses as an unavailable, and no CDN is asked", async () => {
  for (const play of [{ returnCode: "0" }, { liveAddressList: [] }, { liveAddressList: ["x", null] }]) {
    const t = setup({ queues: okQueues(play) });
    await rejectsWith(t.live.resolveLive("c"), "unavailable", "No se pudo abrir el canal: Xuper no dio la dirección de la señal");
    assert.equal(t.portal.times("v14/getSlbInfo"), 0);
  }
});

test("an empty license is never let through: live_no_license", async () => {
  const t = setup({ queues: okQueues(playLive({ playCode: "pc", license: "" })) });
  await rejectsWith(t.live.resolveLive("c"), "unavailable", "No se pudo abrir el canal: Xuper no dio la licencia de la señal");
});

// ---- the CDNs -------------------------------------------------------------------------------

test("ALL the live CDNs, each with its own authBase, in portal order; main_addr's scheme and path are dropped", async () => {
  const slb = liveSlb([["http://primero.live.test/v3/youshi/", auth(TOKEN_A)], ["https://segundo.live.test", auth(TOKEN_B)]]);
  const t = setup({ queues: okQueues(playLive({ playCode: "pc", license: "L" }), slb) });
  const out = await t.live.resolveLive("c");
  assert.equal(out.url, "http://primero.live.test/live/pc.m3u8");
  assert.deepEqual(out.alternateHosts, ["segundo.live.test"]);
  assert.deepEqual(JSON.parse(out.signContext).c, [
    { h: "primero.live.test", a: auth(TOKEN_A), t: TOKEN_A },
    { h: "segundo.live.test", a: auth(TOKEN_B), t: TOKEN_B },
  ]);
});

test("every cfl url_list item of every live cdn counts; no free-tag check; not vod, not cflx", async () => {
  const slb = { cdn_list: [
    { tag: "vod", main_addr: "http://vod.live.test", url_list: [{ url: auth(TOKEN_A) }] },
    { tag: "live", main_addr: "http://nocfl.live.test", url_list: [{ url: `sign_type=cflx&token=${TOKEN_A}` }] },
    { tag: "live", main_addr: "http://si.live.test", url_list: [{ url: auth(TOKEN_A), tag: "paid" }, { url: `token=${TOKEN_B}`, sign_type: "cfl" }] },
    { tag: "live", main_addr: "otro.live.test:8080", url_list: [{ url: auth(TOKEN_C) }] },
  ] };
  const t = setup({ queues: okQueues(playLive({ playCode: "pc", license: "L" }), slb) });
  const out = await t.live.resolveLive("c");
  assert.deepEqual(JSON.parse(out.signContext).c.map((c) => [c.h, c.t]), [
    ["si.live.test", TOKEN_A], ["si.live.test", TOKEN_B], ["otro.live.test:8080", TOKEN_C],
  ]);
  assert.deepEqual(out.alternateHosts, ["otro.live.test:8080"], "deduped, never the primary's own host");
});

test("bareHost strips the scheme and the path, keeps a port", () => {
  assert.equal(bareHost("http://primero.test/v3/youshi/"), "primero.test");
  assert.equal(bareHost("https://segundo.test"), "segundo.test");
  assert.equal(bareHost("tercero.test:8080/x"), "tercero.test:8080");
  assert.equal(bareHost(""), "");
});

test("no servable live CDN: live_no_cfl_cdn", async () => {
  for (const slb of [{ cdn_list: [] }, {}, liveSlb([["", auth(TOKEN_A)]])]) {
    const t = setup({ queues: okQueues(playLive({ playCode: "pc", license: "L" }), slb) });
    await rejectsWith(t.live.resolveLive("c"), "unavailable", "No se pudo abrir el canal: Xuper no dio un servidor de vivo");
  }
});

test("a CDN without token=<32 hex> is dropped; none left: live_no_cfl_token", async () => {
  const mixed = liveSlb([["http://sin.live.test", "sign_type=cfl&token=corto"], ["http://con.live.test", auth(TOKEN_B)]]);
  const t = setup({ queues: okQueues(playLive({ playCode: "pc", license: "L" }), mixed) });
  const out = await t.live.resolveLive("c");
  assert.equal(out.url, "http://con.live.test/live/pc.m3u8");
  assert.deepEqual(out.alternateHosts, []);
  const none = setup({ queues: okQueues(playLive({ playCode: "pc", license: "L" }), liveSlb([["live.test.cdn", "sign_type=cfl&token=corto"]])) });
  await rejectsWith(none.live.resolveLive("c"), "unavailable", "No se pudo abrir el canal: el servidor de vivo no trae su token");
});

test("a CDN whose host is not a plain host[:port] is dropped on its own reason: not the misleading 'no token'", async () => {
  const badOnly = setup({ queues: okQueues(playLive({ playCode: "pc", license: "L" }), liveSlb([["http://bad_host.live.test", auth(TOKEN_A)]])) });
  await rejectsWith(badOnly.live.resolveLive("c"), "unavailable", "No se pudo abrir el canal: Xuper dio una dirección de servidor de vivo que no es válida");
  // one good CDN beside the bad one still opens (the bad one is only dropped)
  const mixed = setup({ queues: okQueues(playLive({ playCode: "pc", license: "L" }), liveSlb([["http://bad_host.live.test", auth(TOKEN_A)], ["http://ok.live.test", auth(TOKEN_B)]])) });
  const out = await mixed.live.resolveLive("c");
  assert.equal(out.url, "http://ok.live.test/live/pc.m3u8");
});

// ---- expiry -------------------------------------------------------------------------------

test("expiresInSeconds: the portal's invalidTime, 300 without it, clamped to 30..86400", async () => {
  const cases = [["14400", 14400], ["", 300], ["basura", 300], ["0", 300], ["-5", 300], ["10", 30], ["999999", 86400], [7200, 7200]];
  for (const [invalidTime, expected] of cases) {
    const t = setup({ queues: okQueues(OK_PLAY, liveSlb([["cdn1.live.test", auth(TOKEN_A)]], invalidTime)) });
    const out = await t.live.resolveLive("c");
    assert.equal(out.expiresInSeconds, expected, "invalidTime " + invalidTime);
  }
});

// ---- the stream answer --------------------------------------------------------------------

test("the stream: http playlist on the first CDN, HLS mime, request signing, the others as alternateHosts; the kit keeps it all with zero drops", async () => {
  const slb = liveSlb([
    ["http://cdn1.live.test", auth(TOKEN_A)], ["http://cdn2.live.test:8080/p/", auth(TOKEN_B)],
    ["https://cdn3.live.test", auth(TOKEN_C)], ["cdn2.live.test:8080", auth(TOKEN_C)],
  ]);
  const t = setup({ queues: okQueues(OK_PLAY, slb) });
  const out = await t.live.resolveLive("cyx-RCNHD");
  assert.deepEqual(Object.keys(out).sort(), ["alternateHosts", "expiresInSeconds", "mime", "signContext", "signing", "url"]);
  assert.equal(out.url, "http://cdn1.live.test/live/cyx-2EF7E10E40C1ac19D6A9F3ED4CD2.m3u8");
  assert.equal(out.mime, "application/x-mpegurl");
  assert.equal(out.signing, "request");
  assert.deepEqual(out.alternateHosts, ["cdn2.live.test:8080", "cdn3.live.test"]);
  assert.equal(out.expiresInSeconds, 14400);
  const { value, drops } = checkOutput("resolve", out, manifest, [], { liveChannel: true });
  assert.deepEqual(drops, []);
  assert.equal(value.signing, true);
  assert.equal(value.signContext, out.signContext);
  assert.deepEqual(value.alternateHosts, out.alternateHosts);
  assert.equal(value.url, out.url);
  assert.equal(value.expiresInSeconds, 14400);
  assert.ok(!("headers" in out) || Object.keys(out.headers).length === 0, "everything is per request");
});

test("sign() with that stream's context signs each CDN host with its own token", async () => {
  const slb = liveSlb([["http://cdn1.live.test", auth(TOKEN_A)], ["http://cdn2.live.test:8080", auth(TOKEN_B)]]);
  const t = setup({ queues: okQueues(OK_PLAY, slb) });
  const out = await t.live.resolveLive("c");
  const one = signRequest({ url: out.url, kind: "playlist", ref: "c", context: out.signContext }, NOW + 1234);
  assert.ok(one.headers["Content-Auth"].endsWith(`start_moment=${NOW + 1234}&sign2=${signO3(TOKEN_A, NOW + 1234)}`));
  assert.equal(one.headers["Content-License"], "LIC-CORRECTO");
  const two = signRequest({ url: "http://cdn2.live.test:8080/live/seg.ts", kind: "segment", ref: "c", context: out.signContext }, NOW);
  assert.ok(two.headers["Content-Auth"].startsWith(auth(TOKEN_B) + "&sign2_method=sign_o3&instance=0&start_moment="));
});

test("nothing secret is logged on a successful open", async () => {
  const base = fakeKino();
  const logs = [];
  const kino = { ...base, log: (...a) => logs.push(a.join(" ")) };
  const t = setup({ queues: okQueues(), kinoOverride: kino });
  await t.live.resolveLive("c");
  for (const line of logs) {
    assert.ok(!line.includes(TOKEN_A) && !line.includes("LIC-CORRECTO") && !line.includes("tok1"), line);
  }
});

// ---- errors -------------------------------------------------------------------------------

test("geo-blocked and not-found portal codes keep their meaning", async () => {
  const geo = setup({ queues: { "v4/startPlayLive": [new PortalError("portal100024", "版权限制")] } });
  await rejectsWith(geo.live.resolveLive("cyx-RCNHD"), "geo_blocked", "Este contenido no está disponible en tu región");
  const gone = setup({ queues: { "v4/startPlayLive": [new PortalError("portal100004", "")] } });
  await rejectsWith(gone.live.resolveLive("x"), "not_found");
  const gone2 = setup({ queues: { "v4/startPlayLive": [new PortalError("p9", "频道不存在")] } });
  await rejectsWith(gone2.live.resolveLive("x"), "not_found");
  const other = setup({ queues: { "v4/startPlayLive": [OK_PLAY], "v14/getSlbInfo": [new PortalError("p9", "x")] } });
  await rejectsWith(other.live.resolveLive("x"), "unavailable", "Xuper no está disponible ahora");
});

test("an unknown channel code is a clear Spanish not_found; an answer with no addresses stays unavailable (cannot be told apart from a known channel with no signal)", async () => {
  for (const err of [new PortalError("portal100004", ""), new PortalError("p9", "频道不存在")]) {
    const gone = setup({ queues: { "v4/startPlayLive": [err] } });
    await rejectsWith(gone.live.resolveLive("no-such-channel"), "not_found", "No se encontró ese canal en Xuper");
  }
  const empty = setup({ queues: { "v4/startPlayLive": [{ liveAddressList: [] }] } });
  await rejectsWith(empty.live.resolveLive("known-without-signal"), "unavailable", "No se pudo abrir el canal: Xuper no dio la dirección de la señal");
});

test("a failing ensure() surfaces as the mapped error and nothing is asked", async () => {
  const t = setup({ ensureError: new PortalError("portal100024", "") });
  await rejectsWith(t.live.resolveLive("c"), "geo_blocked");
  assert.equal(t.portal.calls.length, 0);
  const k = fakeKino();
  const t2 = setup({ ensureError: k.error("unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento") });
  await rejectsWith(t2.live.resolveLive("c"), "unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento");
  const t3 = setup({ ensureError: new TypeError("boom") });
  await rejectsWith(t3.live.resolveLive("c"), "unavailable", "Xuper no está disponible ahora");
});

const NO_ACCOUNT_TEXT = "Este canal necesita una cuenta de Xuper (para películas y series no hace falta). Vincúlala en Ajustes ▸ Plugins ▸ Xuper.";

test("aaa100028 on startPlayLive is auth_required with the live text, and no CDN is asked", async () => {
  const t = setup({ queues: { "v4/startPlayLive": [new PortalError("aaa100028", "未登录！")] } });
  await rejectsWith(t.live.resolveLive("c"), "auth_required", NO_ACCOUNT_TEXT);
  assert.equal(t.portal.times("v14/getSlbInfo"), 0);
});

test("with the real session: aaa100028 that survives the relogin is the live auth_required", async () => {
  const kino = fakeKino({ config: { email: "a@b.test", password: "pw" } });
  const portal = fakePortal({
    "v4/startPlayLive": [new PortalError("aaa100028", "未登录！"), new PortalError("aaa100028", "未登录！")],
    "v8/login": [{ userId: "u-own", userToken: "t2", jwtToken: "" }],
  });
  const clock = { now: () => NOW };
  const session = makeSession({ kino, portal, clock, random: () => 0 });
  // The stored token belongs to the saved account (an `acct`-less one would be re-logged first).
  kino.storage.set("session", JSON.stringify({ userId: "u-own", userToken: "t-own", jwtToken: "", sn: "sn-own", acct: session.accountKey("a@b.test", "pw") }));
  const live = makeLive({ kino, portal, session, clock, config: { apkVersion: "49902" }, random: () => 0 });
  await rejectsWith(live.resolveLive("c"), "auth_required", NO_ACCOUNT_TEXT);
  assert.deepEqual(portal.calls.map((c) => c.path), ["v4/startPlayLive", "v8/login", "v4/startPlayLive"]);
  assert.equal(portal.calls[2].opts.userToken, "t2", "the retry runs with the renewed token");
});

// ---- retry: expired and conflict ----------------------------------------------------------

test("retry expired: a fresh open with the own session (nothing cached)", async () => {
  const t = setup({ queues: { "v4/startPlayLive": [OK_PLAY, OK_PLAY], "v14/getSlbInfo": [OK_SLB, OK_SLB] } });
  await t.live.resolveLive("c");
  await t.live.resolveLive("c", { retry: { reason: "expired", attempt: 1 } });
  assert.equal(t.portal.times("v4/startPlayLive"), 2);
  assert.equal(t.session.ensures, 2);
});

test("retry conflict on an own (minted) session does not rotate: the own session again", async () => {
  const t = setup({ kind: "own", pool: [seed("a"), seed("b")], queues: { "v4/startPlayLive": [OK_PLAY, OK_PLAY], "v14/getSlbInfo": [OK_SLB, OK_SLB] } });
  await t.live.resolveLive("c");
  await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  for (const call of t.portal.calls) assert.deepEqual(call.opts, { baseFields: true, userId: "u1", userToken: "tok1" });
});

test("retry conflict on an account does not rotate either", async () => {
  const t = setup({ kind: "account", pool: [seed("a")], queues: { "v4/startPlayLive": [OK_PLAY, OK_PLAY], "v14/getSlbInfo": [OK_SLB, OK_SLB] } });
  await t.live.resolveLive("c");
  await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  assert.ok(t.portal.calls.every((c) => c.opts.sn === undefined));
});

const lic = (n) => playLive({ playCode: "pc", license: "LIC-" + n });

test("retry conflict on a seed session: the next open uses an untried pool seed (never the device's own sn), with ITS userId, token and sn, and no ensure", async () => {
  const pool = [seed("sn-own"), seed("a"), seed("b")];
  const t = setup({ kind: "seed", sn: "sn-own", pool, random: () => 0, queues: { "v4/startPlayLive": [lic(0), lic(1)], "v14/getSlbInfo": [OK_SLB, OK_SLB] } });
  await t.live.resolveLive("c");
  const before = t.session.ensures;
  const out = await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  assert.equal(t.session.ensures, before, "a seed open never ensures the stored session");
  const seedCalls = t.portal.calls.slice(2);
  assert.deepEqual(seedCalls.map((c) => c.opts), [
    { baseFields: true, userId: "u-a", userToken: "t-a", sn: "a" },
    { baseFields: true, userId: "u-a", userToken: "t-a", sn: "a" },
  ]);
  assert.equal(JSON.parse(out.signContext).l, "LIC-1");
});

test("a seed open never touches the stored session (real session, real storage)", async () => {
  const kino = fakeKino();
  const stored = JSON.stringify({ userId: "u-own", userToken: "t-own", jwtToken: "", sn: "sn-own" });
  kino.storage.set("session", stored);
  kino.storage.set("seeds", JSON.stringify([seed("sn-own"), seed("a")]));
  const portal = fakePortal({
    "v4/startPlayLive": [lic(0), new PortalError("aaa100028", "未登录"), lic(2)],
    "v14/getSlbInfo": [OK_SLB, OK_SLB],
  });
  const clock = { now: () => NOW };
  const session = makeSession({ kino, portal, clock, random: () => 0 });
  assert.equal(session.kind(), "seed");
  const live = makeLive({ kino, portal, session, clock, config: { apkVersion: "49902" }, random: () => 0 });
  await live.resolveLive("c");
  // The conflict rotates to seed "a"; the portal refuses it: no login, no activation, it is skipped,
  // and with nothing else untried the channel goes back to the device's own session.
  const out = await live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  assert.deepEqual(portal.calls.map((c) => [c.path, c.opts.sn]), [
    ["v4/startPlayLive", undefined], ["v14/getSlbInfo", undefined],
    ["v4/startPlayLive", "a"],
    ["v4/startPlayLive", undefined], ["v14/getSlbInfo", undefined],
  ]);
  assert.equal(kino.storage.get("session"), stored);
  assert.equal(JSON.parse(out.signContext).l, "LIC-2");
});

test("at most three rotations: the fourth conflict goes back to the device's own session", async () => {
  const pool = ["sn-own", "a", "b", "c", "d", "e"].map(seed);
  const queues = { "v4/startPlayLive": [0, 1, 2, 3, 4].map(lic), "v14/getSlbInfo": Array(5).fill(OK_SLB) };
  const t = setup({ kind: "seed", sn: "sn-own", pool, random: () => 0, queues });
  await t.live.resolveLive("c");
  for (let attempt = 1; attempt <= 4; attempt++) await t.live.resolveLive("c", { retry: { reason: "conflict", attempt } });
  const sns = t.portal.calls.filter((c) => c.path === "v4/startPlayLive").map((c) => c.opts.sn);
  assert.deepEqual(sns, [undefined, "a", "b", "c", undefined]);
});

test("the same refused license twice counts once", async () => {
  // Own session conflicts, rotates to a, a's open serves LIC-1; two conflicts arrive for that one
  // stream (no new open between them is not possible through resolve, so the dedupe is checked with
  // a stream whose open served the very same license again).
  const pool = ["sn-own", "a", "b", "c"].map(seed);
  const same = playLive({ playCode: "pc", license: "LIC-SAME" });
  const queues = { "v4/startPlayLive": [same, same, same], "v14/getSlbInfo": Array(3).fill(OK_SLB) };
  const t = setup({ kind: "seed", sn: "sn-own", pool, random: () => 0, queues });
  await t.live.resolveLive("c"); // own: LIC-SAME
  await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } }); // refused LIC-SAME → seed a, serves LIC-SAME
  await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 2 } }); // LIC-SAME again: counts once, stays on a
  const sns = t.portal.calls.filter((c) => c.path === "v4/startPlayLive").map((c) => c.opts.sn);
  assert.deepEqual(sns, [undefined, "a", "a"]);
});

test("expired with an active rotated seed keeps using that seed", async () => {
  const pool = ["sn-own", "a", "b"].map(seed);
  const queues = { "v4/startPlayLive": [lic(0), lic(1), lic(2)], "v14/getSlbInfo": Array(3).fill(OK_SLB) };
  const t = setup({ kind: "seed", sn: "sn-own", pool, random: () => 0, queues });
  await t.live.resolveLive("c");
  await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  await t.live.resolveLive("c", { retry: { reason: "expired", attempt: 2 } });
  const sns = t.portal.calls.filter((c) => c.path === "v4/startPlayLive").map((c) => c.opts.sn);
  assert.deepEqual(sns, [undefined, "a", "a"]);
});

test("a rotated seed that fails to resolve is skipped to the next untried one", async () => {
  const pool = ["sn-own", "a", "b", "c"].map(seed);
  const queues = {
    "v4/startPlayLive": [lic(0), new PortalError("aaa100027", "dead"), lic(2)],
    "v14/getSlbInfo": [OK_SLB, OK_SLB],
  };
  const t = setup({ kind: "seed", sn: "sn-own", pool, random: () => 0, queues });
  await t.live.resolveLive("c");
  const out = await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  const sns = t.portal.calls.filter((c) => c.path === "v4/startPlayLive").map((c) => c.opts.sn);
  assert.deepEqual(sns, [undefined, "a", "b"]);
  assert.equal(JSON.parse(out.signContext).l, "LIC-2");
});

test("every seed failing ends on the device's own session after at most MAX_ROTATIONS+1 tries", async () => {
  const pool = ["sn-own", "a", "b", "c", "d", "e"].map(seed);
  const queues = {
    "v4/startPlayLive": [lic(0), () => new PortalError("x", ""), () => new PortalError("x", ""), () => new PortalError("x", ""), lic(9)],
    "v14/getSlbInfo": [OK_SLB, OK_SLB],
  };
  const t = setup({ kind: "seed", sn: "sn-own", pool, random: () => 0, queues });
  await t.live.resolveLive("c");
  const out = await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  const sns = t.portal.calls.filter((c) => c.path === "v4/startPlayLive").map((c) => c.opts.sn);
  assert.deepEqual(sns, [undefined, "a", "b", "c", undefined]);
  assert.equal(JSON.parse(out.signContext).l, "LIC-9");
});

test("rotation randomness is injected: another random picks another seed", async () => {
  const pool = ["sn-own", "a", "b", "c"].map(seed);
  const t = setup({ kind: "seed", sn: "sn-own", pool, random: () => 0.99, queues: { "v4/startPlayLive": [lic(0), lic(1)], "v14/getSlbInfo": [OK_SLB, OK_SLB] } });
  await t.live.resolveLive("c");
  await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  assert.equal(t.portal.calls[2].opts.sn, "c");
});

test("rotation state is written with a ttl and a full storage never fails the open", async () => {
  const base = fakeKino();
  const sets = [];
  const kino = { ...base, storage: { get: () => null, set: (k, v, o) => { sets.push(o); throw new Error("almacenamiento lleno"); }, remove: () => {}, keys: () => [] } };
  const pool = ["sn-own", "a"].map(seed);
  const t = setup({ kinoOverride: kino, kind: "seed", sn: "sn-own", pool, queues: { "v4/startPlayLive": [lic(0), lic(1)], "v14/getSlbInfo": [OK_SLB, OK_SLB] } });
  await t.live.resolveLive("c");
  const out = await t.live.resolveLive("c", { retry: { reason: "conflict", attempt: 1 } });
  assert.equal(JSON.parse(out.signContext).l, "LIC-1");
  assert.ok(sets.length >= 1 && sets.every((o) => o && o.ttlMs > 0 && o.ttlMs <= 60 * 60_000));
});

// ---- routing from resolve() ---------------------------------------------------------------

test("isChannelRef: a bare channel code is live; magis1, legacy gateway refs and urls are not", () => {
  for (const ref of ["cyx-RCNHD", "cyx_9881490555304164628541864337", "CANAL.1"]) assert.equal(isChannelRef(ref), true, ref);
  const legacy = Buffer.from(JSON.stringify({ s: "magis", p: { content_id: "M1", program_type: "movie", episode: 0 } })).toString("base64url") + ".sig";
  for (const ref of ["magis1:movie:0:M1", "magis1:movie", legacy, "https://example.com/video.mp4", "", null, undefined, "~x", "a b", "x".repeat(129)]) {
    assert.equal(isChannelRef(ref), false, String(ref));
  }
});

test("resolve() routes a bare channel code to live with its options, and a magis1 ref to VOD as before", async () => {
  const seen = [];
  const live = { resolveLive: async (code, options) => { seen.push([code, options]); return { url: "http://x.live.test/live/a.m3u8" }; } };
  const kino = fakeKino();
  const resolver = makeResolve({ kino, portal: fakePortal(), session: { ensure: async () => {}, withValidSession: async (b) => b({}) }, clock: { now: () => NOW }, config: {}, portalChapters: async () => ({ items: [] }), live });
  const opts = { retry: { reason: "conflict", attempt: 2 } };
  assert.deepEqual(await resolver.resolve("cyx-RCNHD", opts), { url: "http://x.live.test/live/a.m3u8" });
  assert.deepEqual(seen, [["cyx-RCNHD", opts]]);
  await rejectsWith(resolver.resolve("https://example.com/video.mp4"), "unavailable", "ese ref no es de Xuper: no se puede reproducir");
  await assert.rejects(resolver.resolve("magis1:movie:0:M1"), (e) => e.code === "unavailable");
  assert.equal(seen.length, 1, "neither went to live");
});
