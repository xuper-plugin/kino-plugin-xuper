// Seed economy and the Ajustes contract (review of the 1.0.46 seed work, 2026-11-17): every case here was a confirmed
// finding, reproduced on the seed-world fakes (test/helpers/seed-world.mjs: a fake Kino on a virtual clock, a backend
// whose GET /seed POPS one-use seeds, a real-3DES portal). Each test failed before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { world, poolSeed, portalError, T0, MIN, BEARER } from "./helpers/seed-world.mjs";
import { res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const xmod = await import("../src/sources/xuper.js");
const seeds = await import("../src/seeds.js");
const { beginCall, callFor } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const plugin = await import("../src/plugin.js");
const C = await import("../src/seedContrib.js");
const xuper = xmod.default;

const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; kino.lang = "es"; });

const SN = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";   // a stored device sn

async function device(opts = {}) {
  const w = await world(opts);
  await clearBearer();
  if (opts.bearer !== false) w.kino.storage.set("o2:bearer", BEARER);
  const settings = opts.settings || {};
  w.kino.config = { get: (k) => settings[k] };
  xmod._resetSession();
  seeds._newRuntime();
  return w;
}
const call = (name) => { beginCall(); callFor(name); };
const pool = (n, life) => Array.from({ length: n }, (_, i) => poolSeed(i + 1, life));
const rejection = async (p) => { try { await p; } catch (e) { return e; } assert.fail("expected a rejection"); };
const isSeed = (b) => String(b.userToken).startsWith("SEEDTOK");
const holdSeed = (w, n = "x") => w.kino.storage.set("o2:xseed", JSON.stringify({ v: 1, sn: "5eed" + n, userId: "SEEDUID-SECRET-" + n, userToken: "SEEDTOK-SECRET-" + n, gotAt: Date.now(), lifeMs: 5 * 3600_000 }));

/** Every text of a tree (ES and EN). */
function texts(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) texts(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  for (const k of ["text", "textEn", "labelText", "labelTextEn", "title", "titleEn"]) if (typeof node[k] === "string") out.push(node[k]);
  for (const v of Object.values(node)) if (v && typeof v === "object") texts(v, out);
  return out;
}
const keysOf = (node, out = new Set()) => {
  if (Array.isArray(node)) { for (const n of node) keysOf(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (typeof node.key === "string") out.add(node.key);
  for (const v of Object.values(node)) if (v && typeof v === "object") keysOf(v, out);
  return out;
};
const configTree = async () => { call("screen"); return plugin.screen({ state: { nav: "config" } }); };

// ── seed-economy-F1: the renewal point is the seed's end — the own session is tried once before another GET ──

test("seed-economy-F1: the block lifted: at the held seed's renewal point the own session is tried first; it answers → no more GET, need cleared, the seed retired", async () => {
  let blocked = true;
  const geoIfOwn = (b) => (blocked && !isSeed(b) ? portalError("portal100024") : undefined);
  const handlers = {};
  for (const p of ["getNextColumns", "v6/getLiveData", "v4/startPlayLive", "v14/getSlbInfo"]) handlers[p] = geoIfOwn;
  const w = await device({ sn: SN, own: "OWNTOK-SECRET-0", pool: pool(20, 3600), handlers });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 1);
  assert.equal(w.state().need, "geo");
  blocked = false;                                     // the person turned the VPN off / the block lifted
  for (let i = 0; i < 36; i++) { w.advance(10 * MIN); call("liveChannels"); assert.equal((await xuper.channels("31", {})).length, 1); }
  assert.equal(w.gets, 1, "the own session answers again: no seed is asked for any more");
  assert.equal(w.state().need, null, "off the seed path");
  assert.equal(w.held(), null, "the seed at its renewal point is retired once the own session answered");
  const own = w.beans("v6/getLiveData").filter((b) => !isSeed(b)).length;
  assert.ok(own >= 32, "the listings ride the own session from the renewal point on: " + own);
  assert.ok(w.logs.includes("seed:end why=own"));
});

test("seed-economy-F1: a one-off activation hiccup (need=mint) does not keep a device on seeds: 6 h of listings, no more GET, one reactivation at the renewal point", async () => {
  let first = true;
  const w = await device({ sn: SN, pool: pool(20, 3600), handlers: {
    "v8/active": () => { if (first) { first = false; return { userId: "x", userToken: "" }; } return undefined; },
  } });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 1);
  assert.equal(w.state().need, "mint");
  for (let i = 0; i < 36; i++) { w.advance(10 * MIN); call("liveChannels"); await xuper.channels("31", {}); }
  assert.equal(w.gets, 1);
  assert.equal(w.count("v8/active"), 2, "the failed one, then one reactivation at the seed's renewal point");
  assert.equal(w.state().need, null);
});

test("seed-economy-F1: an always-on TV re-resolving a channel every 10 min for 24 h on 4 h seeds: one transient refusal costs one seed, not six a day", async () => {
  let first = true;
  const w = await device({ sn: SN, pool: pool(40, 4 * 3600), handlers: {
    "v8/active": () => { if (first) { first = false; return { userId: "x", userToken: "" }; } return undefined; },
  } });
  call("resolve"); assert.ok((await xuper.resolve("ch1")).url);
  assert.equal(w.gets, 1);
  for (let i = 0; i < 144; i++) { w.advance(10 * MIN); call("resolve"); assert.ok((await xuper.resolve("ch1")).url); }
  assert.equal(w.gets, 1);
  const own = w.beans("v4/startPlayLive").filter((b) => String(b.userToken).startsWith("OWNTOK")).length;
  assert.ok(own >= 120, "the opens ride the own session again: " + own);
});

test("seed-economy-F1: still blocked: at each renewal point the own session is tried exactly once, then the renewal GET; never in between", async () => {
  const w = await device({ geo: "own", sn: SN, own: "OWNTOK-SECRET-0", pool: pool(20, 3600) });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 1);
  const shapes = [];
  for (let i = 0; i < 18; i++) {
    w.advance(10 * MIN);
    const sent = w.portal.length, gets = w.gets;
    call("liveChannels");
    assert.equal((await xuper.channels("31", {})).length, 1);
    const kinds = w.portal.slice(sent).filter((r) => r.path === "v6/getLiveData").map((r) => (isSeed(r.bean) ? "seed" : "own"));
    shapes.push(kinds.join(">") + " gets=" + (w.gets - gets));
  }
  // 1 h seeds: each reaches its renewal point 30 min after it came (D3); there, one own try, then one GET
  const renewals = shapes.filter((s) => s === "own>seed gets=1").length;
  assert.equal(renewals, 6, shapes.join("\n"));
  assert.equal(shapes.filter((s) => s === "seed gets=0").length, 12, "in between, the held seed alone: " + shapes.join("\n"));
  assert.equal(w.gets, 1 + renewals);
  assert.equal(w.state().need, "geo");
  assert.ok(w.held());
});

test("seed-economy-F1: a seed refused mid-call while a stale need=geo is stored: the own session is tried before another GET", async () => {
  let blocked = true;
  const s1 = poolSeed(1);
  const w = await device({ sn: SN, own: "OWNTOK-SECRET-0", pool: [s1, poolSeed(2)], handlers: {
    getNextColumns: (b) => (blocked && !isSeed(b) ? portalError("portal100024") : undefined),
    "v6/getLiveData": (b) => (b.userToken === s1.seed.userToken ? portalError("aaa100027") : undefined),
  } });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.state().need, "geo");
  blocked = false;
  w.advance(5 * MIN);
  call("liveChannels");
  assert.equal((await xuper.channels("31", {})).length, 1);
  assert.equal(w.gets, 1, "the own session answered: no replacement asked");
  assert.equal(w.state().need, null);
  assert.equal(w.held(), null);
});

test("seed-economy-F1: at the renewal point an own failure no seed fixes (unknown code, transport error) keeps using the held seed: no GET, the call works", async () => {
  // an unknown code on the own session's content
  const w = await device({ geo: "own", sn: SN, own: "OWNTOK-SECRET-0", pool: pool(3, 3600), handlers: {
    "v6/getLiveData": (b) => (isSeed(b) ? undefined : portalError("aaa555555")),
  } });
  call("liveCategories"); await xuper.categories({});
  w.advance(40 * MIN);
  call("liveChannels");
  assert.equal((await xuper.channels("31", {})).length, 1);
  assert.equal(w.gets, 1);
  assert.equal(w.beans("v6/getLiveData").pop().userToken, "SEEDTOK-SECRET-1");

  // the own reactivation cut by the network
  let net = false;
  const v = await device({ sn: SN, pool: pool(3, 3600), handlers: {
    "v8/active": () => (net ? new Error("socket closed") : portalError("portal100024")),
  } });
  call("liveCategories"); await xuper.categories({});
  assert.equal(v.gets, 1);
  net = true;
  v.advance(40 * MIN);
  call("liveChannels");
  assert.equal((await xuper.channels("31", {})).length, 1);
  assert.equal(v.gets, 1, "no seed on a transport error (D2): the held one is still good");
  assert.equal(v.beans("v6/getLiveData").pop().userToken, "SEEDTOK-SECRET-1");
});

// ── seed-economy-F2: aaa100028 off the live open is probed before it counts as a dead session ──

test("seed-economy-F2: aaa100028 on VOD after a fresh own renewal: the own session answers the probe → the content needs an account, 0 GET", async () => {
  const w = await device({ sn: SN, own: "OWNTOK-SECRET-old", pool: pool(10), handlers: { "v10/startPlayVOD": () => portalError("aaa100028", "用户未登录") } });
  call("resolve");
  const e = await rejection(xmod.resolveVod("m1", "movie"));
  assert.equal(e.code, "aaa100028");
  assert.equal(e.userMessage, "Este contenido necesita una cuenta de Xuper; con la sesión anónima no está disponible.");
  assert.equal(w.gets, 0, "a seed is anonymous too: none is asked");
  assert.equal(w.count("v8/active"), 1, "renewed once first");
  const probe = w.beans("getNextColumns").pop();
  assert.equal(probe.pageSize, 1);
  assert.equal(probe.userToken, "OWNTOK-SECRET-1", "the probe runs on the fresh own token");
  kino.lang = "en";
  call("resolve");
  assert.equal((await rejection(xmod.resolveVod("m1", "movie"))).userMessage, "This content needs a Xuper account; it is not available with the anonymous session.");
  assert.equal(w.gets, 0);
  assert.equal(w.count("v8/login"), 0, "the shared retry is only for a live channel (A′)");

  // a listing too
  const v = await device({ sn: SN, own: "OWNTOK-SECRET-old", pool: pool(3), handlers: { "v6/getLiveData": () => portalError("aaa100028") } });
  call("liveChannels");
  assert.match((await rejection(xuper.channels("31", {}))).userMessage, /necesita una cuenta de Xuper/);
  assert.equal(v.gets, 0);
});

test("seed-economy-F2: on a seed, aaa100028 on VOD: the seed answers the probe → it is kept (not dead on arrival), 0 GET", async () => {
  const w = await device({ geo: "own", pool: pool(5), handlers: { "v10/startPlayVOD": () => portalError("aaa100028") } });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 1);
  for (let i = 0; i < 2; i++) {
    call("resolve");
    assert.match((await rejection(xmod.resolveVod("m1", "movie"))).userMessage, /^Este contenido necesita una cuenta de Xuper/);
  }
  assert.equal(w.gets, 1, "the working seed is kept");
  assert.equal(w.held().userToken, "SEEDTOK-SECRET-1");
  assert.ok(!(w.state().doa > 0), "never counted as dead on arrival");
  assert.ok(!w.logs.some((l) => l.startsWith("seed:drop")));
});

// ── seed-economy-F3: never two GETs at once in one runtime ──

test("seed-economy-F3: a renewal GET in flight and a replacement for a seed that died: one GET, both callers use its seed", async () => {
  const s1 = poolSeed(1, 3600);
  const w = await device({ geo: "own", sn: SN, own: "OWNTOK-SECRET-0", pool: [s1, poolSeed(2), poolSeed(3)], handlers: {
    "v6/getLiveData": (b) => (b.userToken === s1.seed.userToken && Date.now() > T0 + 30 * MIN ? portalError("aaa100027") : undefined),
  } });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 1);
  // Real delays: the GET stays in flight while the dying seed's answer lands.
  const f0 = w.kino.fetch;
  w.kino.fetch = async (url, init) => {
    if (/\/seed$/.test(url)) await new Promise((r) => setTimeout(r, 40));
    else if (/getLiveData/.test(url)) await new Promise((r) => setTimeout(r, 15));
    return f0(url, init);
  };
  w.advance(30 * MIN - 1000);
  call("liveChannels");
  const a = xuper.channels("31", {});      // still on the seed (29:59 after it came)
  w.advance(2000);
  const b = xuper.resolve("ch1");          // 30:01: the seed's renewal point
  const [list, open] = await Promise.all([a, b]);
  assert.equal(list.length, 1);
  assert.ok(open.url);
  assert.equal(w.gets, 2, "one GET in the call, shared");
  assert.equal(w.held().userToken, "SEEDTOK-SECRET-2");
  assert.equal(w.pool.length, 1, "seed 3 never popped");
});

// ── seed-economy-F4: a one-use GET never starts with too little time left ──

test("seed-economy-F4: a GET /seed is not started with less than 3 s left in the call (it would cost a seed and time out)", async () => {
  const w = await device({ sn: SN, pool: [poolSeed(1)], handlers: {
    "v8/active": (b, n, ww) => { ww.advance(15_400); return portalError("portal100024"); },
  } });
  const seen = [];
  const f0 = w.kino.fetch;
  w.kino.fetch = async (url, init) => { if (/\/seed$/.test(url)) seen.push(init.timeoutMs); return f0(url, init); };
  call("resolve");
  const e = await rejection(xuper.resolve("ch1"));
  assert.deepEqual(seen, [], "no GET with 0.6 s left");
  assert.equal(w.gets, 0);
  assert.equal(e.userMessage, "Xuper bloquea tu zona. Vuelve a intentar en unos segundos.");
  assert.ok(!w.state().back && !(w.state().hour && w.state().hour.n), "a skipped GET costs nothing: no backoff, not counted");

  // with 4 s left it goes out, with all of them
  const v = await device({ sn: SN, pool: [poolSeed(1)], handlers: {
    "v8/active": (b, n, ww) => { ww.advance(12_000); return portalError("portal100024"); },
  } });
  const seen2 = [];
  const g0 = v.kino.fetch;
  v.kino.fetch = async (url, init) => { if (/\/seed$/.test(url)) seen2.push(init.timeoutMs); return g0(url, init); };
  call("resolve");
  assert.ok((await xuper.resolve("ch1")).url);
  assert.equal(seen2.length, 1);
  assert.ok(seen2[0] >= 3000, "timeout " + seen2[0]);
});

// ── contract-ux-F1: "Cambiar semilla" has its own small budget, and the card and the button agree ──

test("contract-ux-F1: manual taps: one per 10 min and two per UTC hour; more taps make no GET and say when", async () => {
  const w = await device({ pool: pool(6) });
  holdSeed(w);
  const results = [];
  for (let i = 0; i < 4; i++) { call("screenEvent"); results.push(await seeds.manualChange()); w.advance(20_000); }
  assert.deepEqual(results.map((r) => r.result), ["ok", "soon", "soon", "soon"]);
  assert.equal(results[1].min, 10);
  assert.equal(w.gets, 1, "one GET for four taps");
  w.advance(10 * MIN);
  call("screenEvent");
  assert.equal((await seeds.manualChange()).result, "ok");
  assert.equal(w.gets, 2);
  w.advance(10 * MIN);                                  // 10:26: two manual GETs already in this UTC hour
  call("screenEvent");
  const r = await seeds.manualChange();
  assert.equal(r.result, "hour");
  assert.equal(r.min, 34);
  assert.equal(w.gets, 2);
  // the toasts
  w.advance(40 * MIN);                                  // 11:06: a new hour
  call("screenEvent");
  assert.equal((await plugin.screenEvent({ name: "seedChange", state: { nav: "config" } })).toast.text, "Semilla cambiada");
  kino.lang = "en";
  call("screenEvent");
  const t = (await plugin.screenEvent({ name: "seedChange", state: { nav: "config" } })).toast;
  assert.equal(t.text, "You just asked for a backup session; you can ask for another in 10 min.");
  kino.lang = "es";
  call("screenEvent");
  assert.equal((await plugin.screenEvent({ name: "seedChange", state: { nav: "config" } })).toast.text,
    "Acabas de pedir una sesión de respaldo; podrás pedir otra en 10 min.");
});

test("contract-ux-F1: taps never lock out the automatic path: after an open and three taps, a seed that dies is still replaced", async () => {
  let dead = "";
  const w = await device({ geo: "own", pool: pool(6), handlers: {
    "v4/startPlayLive": (b) => (b.userToken === dead ? portalError("aaa100027") : undefined),
  } });
  call("resolve"); assert.ok((await xuper.resolve("ch1")).url);
  assert.equal(w.gets, 1);
  const results = [];
  for (let i = 0; i < 2; i++) { w.advance(20_000); call("screenEvent"); results.push((await seeds.manualChange()).result); }
  w.advance(20_000);
  call("screenEvent");
  const toast = (await plugin.screenEvent({ name: "seedChange", state: { nav: "config" } })).toast;
  assert.deepEqual(results, ["ok", "used"], "one tap, then the hour's last GET is kept for the automatic path");
  assert.equal(toast.text, "Ya se usaron las sesiones de respaldo de esta hora; podrás pedir otra en 54 min.");
  assert.equal(toast.textEn, "This hour's backup sessions are used up; you can ask for another in 54 min.");
  assert.equal(w.gets, 2);
  dead = w.held().userToken;
  w.advance(MIN);
  call("resolve");
  assert.ok((await xuper.resolve("ch2")).url, "the dead seed is replaced");
  assert.equal(w.gets, 3);
});

test("contract-ux-F1: while the card says this hour's backup sessions are used up (cap or 429), there is no Cambiar semilla button", async () => {
  const w = await device({ pool: pool(3) });
  holdSeed(w);
  let tree = await configTree();
  assert.ok(keysOf(tree).has("seedChange"), "on a seed, nothing to wait for: the button");
  w.kino.storage.set("o2:xseedSt", JSON.stringify({ hour: { win: T0 - (T0 % 3600_000), n: 3 } }));
  tree = await configTree();
  assert.ok(texts(tree).includes("Ya se usaron las sesiones de respaldo de esta hora. Podrás pedir otra en 55 min."));
  assert.ok(!keysOf(tree).has("seedChange"), "the cap line and no button");
  w.kino.storage.set("o2:xseedSt", JSON.stringify({ back: { until: T0 + 30 * MIN, why: "429", n: 1 } }));
  tree = await configTree();
  assert.ok(texts(tree).some((t) => t.startsWith("Ya se usaron las sesiones de respaldo de esta hora")));
  assert.ok(!keysOf(tree).has("seedChange"));
});

// ── contract-ux-F2: the contribution never waits on the backend from Home ──

test("contract-ux-F2: no stored portal secret and a backend that hangs: Home is never held by the contribution, no /xuper/config from Home", async () => {
  const w = await device({});
  w.kino.storage.remove("o2:xcfg");
  const configs = [];
  const f0 = w.kino.fetch;
  w.kino.fetch = async (url, init) => {
    if (/\/xuper\/config$/.test(url)) { configs.push(url); w.advance(Number(init.timeoutMs) || 20_000); throw Object.assign(new Error("timeout"), { code: "timeout" }); }
    return f0(url, init);
  };
  for (let i = 0; i < 3; i++) {
    call("home");
    const homeStart = Date.now();
    w.advance(1000);
    const t = Date.now();
    assert.equal(await C.afterHome(homeStart), null);
    assert.equal(Date.now() - t, 0, "Home " + (i + 1) + " held " + (Date.now() - t) + " ms");
    w.advance(5 * MIN);
  }
  assert.deepEqual(configs, []);
  assert.equal(w.portal.length, 0);
  assert.ok(w.logs.includes("seed_contrib skip why=nokey"));
});

test("contract-ux-F2: a stored secret past fresh (2 d, still last-good) is used as is: the contribution mints without asking the backend", async () => {
  const w = await device({});
  const cfg = JSON.parse(w.kino.storage.get("o2:xcfg"));
  w.kino.storage.set("o2:xcfg", JSON.stringify({ ...cfg, at: T0 - 2 * 24 * 3600_000 }));
  const configs = [];
  const f0 = w.kino.fetch;
  w.kino.fetch = async (url, init) => { if (/\/xuper\/config$/.test(url)) configs.push(url); return f0(url, init); };
  call("home");
  assert.ok(await C.maybeContribute());
  assert.deepEqual(configs, []);
  assert.equal(w.seeds.length, 1);
});

// ── contract-ux-F5: the limits live in kino.storage, which Kino keeps per profile ──

test("contract-ux-F5: the seed limits and the contribution window are documented per profile (Kino's plugin storage is per profile)", () => {
  const src = (f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
  const docOf = (code, name) => {
    const at = code.indexOf("export const " + name);
    assert.ok(at > 0, name);
    return code.slice(code.lastIndexOf("/**", at), at);
  };
  assert.match(docOf(src("seeds.js"), "AUTO_PER_HOUR"), /per profile/);
  assert.match(docOf(src("seedContrib.js"), "CONTRIB_INTERVAL_MS"), /per profile/);
  assert.match(src("seeds.js"), /kino\.storage is per profile/);
  assert.doesNotMatch(src("seeds.js"), /per device/);
});
