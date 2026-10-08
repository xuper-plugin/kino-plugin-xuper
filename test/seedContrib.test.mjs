// The fleet's anonymous seed contribution (2.2.19): gates, the validate-before-send hard rule, and
// the exact seed shape sent through kino.seed. No real portal; a scripted mock answers the mint.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeSeedContrib, CONTRIB_INTERVAL_MS, AT_KEY, VALIDATE_COLUMN } from "../src/seedContrib.js";
import { PortalError } from "../src/portal.js";

// A portal mock that answers the three mint calls. `col` is what getNextColumns returns (null/[]/throw
// means the fresh session can't read the catalog -> the contribution is dropped).
function portalOf({ col = [{ id: 1 }], activeExtra = {}, failAt = null } = {}) {
  const calls = [];
  return {
    calls,
    async call(path, bean, opts = {}) {
      calls.push({ path, bean, opts });
      if (failAt === path) throw new PortalError("portal100024", "geo");
      if (path === "v3/snToken") return { snToken: "sntok-abc", sn: "device-sn-01" };
      if (path === "v8/active") return { userId: 967000001, userToken: "uuid-tok-01", jwtToken: "j.w.t", ...activeExtra };
      if (path === "getNextColumns") { if (col instanceof Error) throw col; return col; }
      throw new Error("unexpected path " + path);
    },
  };
}

// A kino with seed() present by default; `seed:null` removes it (older Kino). `settings`/`storage`
// seed the config and storage. Returns the kino plus the list of seeds kino.seed() received.
function worldKino({ withSeed = true, settings = {}, storage = {} } = {}) {
  const base = fakeKino();
  for (const [k, v] of Object.entries(storage)) base.storage.set(k, v);
  const got = [];
  // The plugin's own `contributeSeeds` toggle isn't in the kit's manifest, so model config.get for it.
  const config = { ...base.config, get: (k) => (k in settings ? settings[k] : base.config.get(k)) };
  const kino = { ...base, config, seed: withSeed ? (s) => got.push(s) : undefined };
  return { kino, got };
}

const clockAt = (t) => ({ now: () => t });
const NOW = 1_700_000_000_000;

test("no kino.seed (older Kino): no mint, no event", async () => {
  const { kino, got } = worldKino({ withSeed: false });
  const portal = portalOf();
  const c = makeSeedContrib({ kino, portal, clock: clockAt(NOW) });
  assert.equal(await c.maybeContribute(), null);
  assert.equal(portal.calls.length, 0);
  assert.equal(got.length, 0);
});

test("telemetry/contribute toggle off: nothing minted, nothing sent", async () => {
  const { kino, got } = worldKino({ settings: { contributeSeeds: false } });
  const portal = portalOf();
  const c = makeSeedContrib({ kino, portal, clock: clockAt(NOW) });
  assert.equal(await c.maybeContribute(), null);
  assert.equal(portal.calls.length, 0);
  assert.equal(got.length, 0);
});

test("rate limit: a contribution inside the 10 h window is skipped", async () => {
  const { kino, got } = worldKino({ storage: { [AT_KEY]: String(NOW - (CONTRIB_INTERVAL_MS - 1000)) } });
  const portal = portalOf();
  const c = makeSeedContrib({ kino, portal, clock: clockAt(NOW) });
  assert.equal(await c.maybeContribute(), null);
  assert.equal(portal.calls.length, 0);
});

test("geo-blocked region: the mint throws, no event, but the window is stamped (one try per interval)", async () => {
  const { kino, got } = worldKino();
  const portal = portalOf({ failAt: "v3/snToken" });
  const c = makeSeedContrib({ kino, portal, clock: clockAt(NOW) });
  assert.equal(await c.maybeContribute(), null);
  assert.equal(got.length, 0);
  assert.equal(kino.storage.get(AT_KEY), String(NOW)); // stamped: a blocked device won't retry until the window passes
});

test("validate-before-send: an empty catalog answer drops the contribution (no event)", async () => {
  for (const col of [[], null, {}]) {
    const { kino, got } = worldKino();
    const portal = portalOf({ col });
    const c = makeSeedContrib({ kino, portal, clock: clockAt(NOW) });
    assert.equal(await c.maybeContribute(), null);
    assert.equal(got.length, 0, `col=${JSON.stringify(col)}`);
    assert.ok(portal.calls.some((x) => x.path === "getNextColumns"));
  }
});

test("happy path: mints a fresh session, validates it, sends the exact seed shape", async () => {
  const { kino, got } = worldKino();
  const portal = portalOf({ activeExtra: { customer: "M-2", availableTime: 28800 } });
  const c = makeSeedContrib({ kino, portal, clock: clockAt(NOW) });
  const seed = await c.maybeContribute();
  assert.ok(seed);
  // The validation fetched the agreed column.
  const col = portal.calls.find((x) => x.path === "getNextColumns");
  assert.equal(col.bean.columnCode, VALIDATE_COLUMN);
  // Exactly one seed reached kino.seed, with the pool schema and nothing about the person.
  assert.equal(got.length, 1);
  assert.deepEqual(got[0], {
    sn: "device-sn-01",
    userId: "967000001",
    userToken: "uuid-tok-01",
    jwtToken: "j.w.t",
    mintedAt: Math.floor(NOW / 1000),
    customer: "M-2",
    availableTime: 28800,
  });
  // The window is stamped so the device won't contribute again for 10 h.
  assert.equal(kino.storage.get(AT_KEY), String(NOW));
});

test("the interval is the owner's value (10 h) and there is no dice", () => {
  assert.equal(CONTRIB_INTERVAL_MS, 10 * 3600_000);
});
