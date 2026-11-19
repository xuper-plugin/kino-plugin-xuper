// The anonymous seed contribution (seed design §6, §9 test 23): the old kino-plugin-xuper's ten seedContrib cases,
// ported onto this version's real path (src/seedContrib.js → src/sources/xuper.js mintAnonymous → the real-3DES fake portal).
// Gates, the validate-before-send rule, the exact POST /seed payload, the 3 h window and the after-Home budgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { world, portalError, T0, BEARER } from "./helpers/seed-world.mjs";
import { res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const xmod = await import("../src/sources/xuper.js");
const seeds = await import("../src/seeds.js");
const { beginCall, callFor } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const C = await import("../src/seedContrib.js");

const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; });

/** A device right when its Home started (the call begins now), with the given settings. */
async function device(opts = {}) {
  const w = await world(opts);
  await clearBearer();
  if (opts.bearer !== false) w.kino.storage.set("o2:bearer", BEARER);
  const settings = opts.settings || {};
  w.kino.config = { get: (k) => settings[k] };
  xmod._resetSession();
  seeds._newRuntime();
  beginCall(); callFor("home");
  return w;
}

test("the seed goes to the backend: POST /seed {seed} with the stored Bearer, never kino.seed", async () => {
  const w = await device();
  const seed = await C.maybeContribute();
  assert.ok(seed);
  assert.equal(w.seeds.length, 1);
  assert.deepEqual(w.seedAuth, ["Bearer " + BEARER]);
  assert.ok(w.events.includes("contrib:201"));
});

test("a backend without the route (405) or down: null, never throws, the window stays stamped", async () => {
  for (const [postAnswer, code] of [[() => res(405, "{}"), "405"], [() => new Error("net"), "network"], [() => res(500, "{}"), "500"]]) {
    const w = await device({ postAnswer });
    assert.equal(await C.maybeContribute(), null);
    assert.equal(w.seeds.length, 0);
    assert.equal(w.store.get(C.AT_KEY), String(T0), "one try per interval even when the send fails");
    assert.ok(w.logs.includes("seed_contrib send ok=0 code=" + code), w.logs.join("\n"));
  }
});

test("a 401 on POST /seed drops the Bearer and marks the screen's sign-in, as every endpoint", async () => {
  const w = await device({ postAnswer: () => res(401, "{}") });
  assert.equal(await C.maybeContribute(), null);
  assert.equal(w.store.get("o2:bearer"), undefined);
  assert.equal(w.store.get("o2:relogin"), "1");
});

test("the contributeSeeds setting off: nothing minted, nothing sent", async () => {
  const w = await device({ settings: { contributeSeeds: false } });
  assert.equal(await C.maybeContribute(), null);
  assert.equal(w.portal.length, 0);
  assert.equal(w.seeds.length, 0);
  assert.ok(w.logs.includes("seed_contrib skip why=off"));
});

test("rate: a contribution inside the 3 h window is skipped", async () => {
  const w = await device({ storage: { [C.AT_KEY]: String(T0 - (C.CONTRIB_INTERVAL_MS - 1000)) } });
  assert.equal(await C.maybeContribute(), null);
  assert.equal(w.portal.length, 0);
  assert.ok(w.logs.includes("seed_contrib skip why=rate"));
});

test("a geo-blocked region: the mint fails, no event, but the window is stamped (one try per interval)", async () => {
  const w = await device({ handlers: { "v3/snToken": () => portalError("portal100024") } });
  assert.equal(await C.maybeContribute(), null);
  assert.equal(w.seeds.length, 0);
  assert.equal(w.store.get(C.AT_KEY), String(T0));
  assert.ok(w.logs.includes("seed_contrib mint ok=0 why=portal code=portal100024"));
});

test("validate before send: a catalog answer with no data drops the contribution (no event)", async () => {
  for (const col of [[], null, {}]) {
    const w = await device({ handlers: { getNextColumns: (b) => (b.columnCode === C.VALIDATE_COLUMN ? col : undefined) } });
    assert.equal(await C.maybeContribute(), null);
    assert.equal(w.seeds.length, 0, "col=" + JSON.stringify(col));
    assert.ok(w.beans("getNextColumns").some((b) => b.columnCode === C.VALIDATE_COLUMN));
  }
  const w = await device({ handlers: { getNextColumns: () => portalError("portal100024") } });
  assert.equal(await C.maybeContribute(), null);
  assert.equal(w.seeds.length, 0, "a geo-blocked fresh session is never contributed");
});

test("happy path: a brand-new device (sn \"\"), validated, sends the exact seed shape; the person's session is untouched", async () => {
  const SN = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
  const w = await device({ sn: SN, own: "OWNTOK-SECRET-person", handlers: {
    "v3/snToken": () => ({ snToken: "sntok-abc", sn: "device-sn-01" }),
    "v8/active": () => ({ userId: 967000001, userToken: "uuid-tok-01", jwtToken: "j.w.t", customer: "M-2", availableTime: 28800, extra: "dropped" }),
  } });
  const seed = await C.maybeContribute();
  assert.ok(seed);
  assert.deepEqual(w.paths(), ["v3/snToken", "v8/active", "getNextColumns"]);
  assert.equal(w.beans("v3/snToken")[0].sn, "", "no existing sn in the mint (the old plugin sent the person's)");
  const col = w.beans("getNextColumns")[0];
  assert.equal(col.columnCode, C.VALIDATE_COLUMN);
  assert.equal(col.userToken, "uuid-tok-01");
  assert.equal(col.sn, "device-sn-01");
  assert.equal(w.seeds.length, 1);
  assert.equal(JSON.stringify(w.seeds[0]), JSON.stringify({
    sn: "device-sn-01", userId: "967000001", userToken: "uuid-tok-01", jwtToken: "j.w.t",
    mintedAt: Math.floor(T0 / 1000), customer: "M-2",
  }), "only the fields the pool reads: no dead activeTime/availableTime");
  assert.equal(w.store.get(C.AT_KEY), String(T0));
  assert.equal(JSON.parse(w.store.get("o2:xsn")).sn, SN, "the person's device is kept");
  assert.equal(JSON.parse(w.store.get("o2:xsess")).userToken, "OWNTOK-SECRET-person", "and its session");
  assert.ok(w.logs.includes("seed_contrib done ok=1 jwt=1"));
  assert.equal(w.gets, 0, "a contribution never asks GET /seed");
});

test("the interval is the owner's value (3 h) and there is no dice", () => {
  assert.equal(C.CONTRIB_INTERVAL_MS, 3 * 3600_000);
});

test("after Home: a slow portal never holds Home past HOME_CONTRIB_END_MS of Home's start", async () => {
  const w = await device({ latency: 6000 });
  w.advance(3000);                                       // Home answered in 3 s
  const started = Date.now();
  await C.afterHome(T0);
  assert.ok(w.portal.length > 0, "a quick Home still contributes");
  assert.ok(Date.now() <= T0 + C.HOME_CONTRIB_END_MS, `Home held until ${Date.now() - T0} ms`);
  assert.ok(Date.now() - started <= C.CONTRIB_WINDOW_MS, "never more than the contribution's own window after Home");
  assert.ok(C.HOME_CONTRIB_END_MS <= 16_000, "well inside Kino's 20 s");
  assert.equal(w.seeds.length, 0);
});

test("after Home: a Home that already took most of its budget does not contribute, and the window stays open", async () => {
  const w = await device();
  w.advance(12_000);
  assert.equal(await C.afterHome(T0), null);
  assert.equal(w.portal.length, 0, "no request");
  assert.equal(w.seeds.length, 0);
  assert.equal(w.store.get(C.AT_KEY), undefined, "not stamped: a quicker Home later contributes");
});

test("after Home: a quick Home with a healthy portal contributes as before", async () => {
  const w = await device({ latency: 300 });
  w.advance(2000);
  const seed = await C.afterHome(T0);
  assert.ok(seed);
  assert.equal(w.seeds.length, 1);
  assert.equal(w.store.get(C.AT_KEY), String(T0 + 2000));
});

test("the gate: no Bearer, or no portal secret, skips WITHOUT stamping the window", async () => {
  const w = await device({ bearer: false });
  assert.equal(await C.maybeContribute(), null);
  assert.equal(w.portal.length, 0);
  assert.equal(w.store.get(C.AT_KEY), undefined);
  const v = await device({ storage: { "o2:xcfg": JSON.stringify({ magisKey: "", at: T0 }) } });
  v.handlers["v3/snToken"] = () => assert.fail("no mint without the secret");
  const backendDown = v.kino.fetch;
  v.kino.fetch = (url, init) => (/\/xuper\/config$/.test(url) ? Promise.reject(new Error("down")) : backendDown(url, init));
  assert.equal(await C.maybeContribute(), null);
  assert.equal(v.store.get(C.AT_KEY), undefined);
});

test("plugin.js home(): Home's rows first, then the contribution (bounded by Home), never failing Home", async () => {
  // A stored catalog, as a device that revalidated it a minute ago (src/data.js; 0 requests within its TTL).
  const { installKino, res } = await import("./helpers/fake-kino.mjs");
  const data = await import("../src/data.js");
  const { DATA_BASE, RELEASE_BASE } = await import("../src/config.js");
  const legacy = readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8");
  const prep = installKino({ routes: [
    (url) => (url === DATA_BASE + "index.json" ? res(404, "") : undefined),
    (url) => (url === RELEASE_BASE + "/home.json" ? res(200, JSON.stringify({ ...JSON.parse(legacy), generatedAt: 1794844780749 }), { ETag: '"e1"' }, { binary: true }) : undefined),
  ] });
  data._resetMemory();
  beginCall();
  await data.revalidate({ catalog: true });
  const storage = Object.fromEntries(prep.store);
  const w = await device({ start: realNow(), storage });
  data._resetMemory();
  const plugin = await import("../src/plugin.js");
  const rows = await plugin.home();
  assert.ok(rows.length > 0, "Home's rows");
  for (let i = 0; i < 20 && w.seeds.length === 0; i++) await new Promise((r) => setImmediate(r));   // the detached contribution
  assert.equal(w.seeds.length, 1, "one fresh anonymous session contributed after Home");
  assert.deepEqual(w.paths(), ["v3/snToken", "v8/active", "getNextColumns"]);
  assert.equal(w.gets, 0);

  // Home with no catalog at all throws (Kino keeps its rows) and nothing is minted.
  const v = await device({ start: realNow() });
  data._resetMemory();
  await assert.rejects(() => plugin.home());
  assert.equal(v.portal.length, 0);
});
