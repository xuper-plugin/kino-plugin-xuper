// LiveSeedRotation semantics (native LiveSeedRotation.kt + LiveSeedRotationTest), over kino.storage.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeLiveRotation, MAX_ROTATIONS, ROTATION_TTL_MS } from "../src/liveRotation.js";

const seed = (sn) => ({ sn, userId: `u-${sn}`, userToken: `t-${sn}` });
const pool = ["a", "b", "c", "d", "e"].map(seed);

// A seeded LCG: deterministic, never Math.random.
function lcg(s = 7) {
  let x = s;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

function setup({ max, random = lcg(), storage } = {}) {
  const base = fakeKino();
  const writes = [];
  const kino = storage ? { ...base, storage } : {
    ...base,
    storage: {
      get: (k) => base.storage.get(k),
      set: (k, v, o) => { writes.push({ k, v, o }); base.storage.set(k, v, o); },
      remove: (k) => base.storage.remove(k),
      keys: () => base.storage.keys(),
    },
  };
  const clock = { t: 1000, now() { return this.t++; } };
  const r = makeLiveRotation({ kino, clock, random, ...(max === undefined ? {} : { maxRotations: max }) });
  return { r, kino, writes };
}

test("the budget is three rotations, the state lives 30 minutes", () => {
  assert.equal(MAX_ROTATIONS, 3);
  assert.equal(ROTATION_TTL_MS, 30 * 60_000);
});

test("before any refusal the channel uses the device's own session", () => {
  assert.equal(setup().r.activeSn("ch1"), null);
});

test("a refusal picks a seed that is not the session that was refused", () => {
  const { r } = setup();
  assert.equal(r.onRefused("ch1", "a", pool, "k0"), true);
  const active = r.activeSn("ch1");
  assert.ok(active && active !== "a");
});

test("it never repeats a seed on the same channel", () => {
  const { r } = setup({ max: 4 });
  const seen = ["a"];
  let current = "a";
  for (let i = 0; i < 4; i++) {
    assert.equal(r.onRefused("ch1", current, pool, "k-" + current), true);
    current = r.activeSn("ch1");
    assert.ok(!seen.includes(current), current + " was already tried");
    seen.push(current);
  }
  assert.equal(new Set(seen).size, 5);
});

test("it stops after the budget and goes back to the device's own session", () => {
  const { r } = setup({ max: 2 });
  assert.equal(r.onRefused("ch1", "a", pool, "k-a"), true);
  assert.equal(r.onRefused("ch1", r.activeSn("ch1"), pool, "k-" + r.activeSn("ch1")), true);
  assert.equal(r.onRefused("ch1", r.activeSn("ch1"), pool, "k-" + r.activeSn("ch1")), false, "past the budget");
  assert.equal(r.activeSn("ch1"), null);
});

test("with the default budget: three rotations, the fourth refusal goes back to the own session", () => {
  const { r } = setup();
  let current = "own";
  for (let i = 0; i < 3; i++) {
    assert.equal(r.onRefused("ch1", current, pool, "k" + i), true);
    current = r.activeSn("ch1");
  }
  assert.equal(r.onRefused("ch1", current, pool, "k3"), false);
  assert.equal(r.activeSn("ch1"), null);
  assert.equal(r.triedCount("ch1"), 4, "the device's own sn and three seeds");
});

test("an empty pool or one with nothing new gives no seed", () => {
  const { r } = setup();
  assert.equal(r.onRefused("ch1", "a", [], "k"), false);
  assert.equal(r.onRefused("ch2", "a", [seed("a")], "k"), false);
  assert.equal(r.activeSn("ch2"), null);
});

test("a seed without an sn is never chosen", () => {
  const { r } = setup();
  assert.equal(r.onRefused("ch1", "a", [seed(""), seed("  "), seed("a")], "k"), false);
});

test("the same refusal repeated counts once", () => {
  const { r } = setup({ max: 3 });
  assert.equal(r.onRefused("ch1", "a", pool, "license-A"), true);
  const first = r.activeSn("ch1");
  assert.equal(r.onRefused("ch1", "a", pool, "license-A"), true);
  assert.equal(r.onRefused("ch1", "a", pool, "license-A"), true);
  assert.equal(r.activeSn("ch1"), first, "three identical refusals moved it once");
  assert.equal(r.triedCount("ch1"), 1);
  assert.equal(r.onRefused("ch1", first, pool, "license-B"), true, "a refusal of the NEW session moves it");
  assert.notEqual(r.activeSn("ch1"), first);
});

test("channels are independent and reset gives a channel a fresh budget", () => {
  const { r } = setup({ max: 1 });
  assert.equal(r.onRefused("ch1", "a", pool, "k-a"), true);
  assert.equal(r.activeSn("ch2"), null);
  assert.equal(r.onRefused("ch1", r.activeSn("ch1"), pool, "k-x"), false);
  r.reset("ch1");
  assert.equal(r.activeSn("ch1"), null);
  assert.equal(r.onRefused("ch1", "a", pool, "k-a"), true);
});

test("the pick comes from the injected random: 0 takes the first untried seed in pool order", () => {
  const { r } = setup({ random: () => 0 });
  r.onRefused("ch1", "a", pool, "k");
  assert.equal(r.activeSn("ch1"), "b");
  const last = setup({ random: () => 0.999999 }).r;
  last.onRefused("ch1", "a", pool, "k");
  assert.equal(last.activeSn("ch1"), "e");
});

test("the state is kept in kino.storage with a short ttl, never the refused key in clear", () => {
  const { r, writes } = setup();
  r.onRefused("ch1", "own-sn", pool, "LICENSE-SECRET-VALUE");
  assert.ok(writes.length >= 1);
  for (const w of writes) {
    assert.deepEqual(w.o, { ttlMs: ROTATION_TTL_MS });
    assert.ok(!w.v.includes("LICENSE-SECRET-VALUE"), "only a digest of the refused key is stored");
    assert.ok(!w.v.includes("t-"), "no seed token is stored, only sns");
  }
});

test("a storage that refuses writes (quota) or reads never fails the rotation", () => {
  const broken = { get: () => { throw new Error("boom"); }, set: () => { throw new Error("full"); }, remove: () => { throw new Error("x"); }, keys: () => { throw new Error("x"); } };
  const { r } = setup({ storage: broken });
  assert.equal(r.onRefused("ch1", "a", pool, "k"), true);
  assert.ok(r.activeSn("ch1"), "the rotation still holds in memory for this runtime");
});

test("a fresh runtime (the sandbox was discarded) reads the rotation back from storage", () => {
  const { r, kino } = setup();
  r.onRefused("ch1", "a", pool, "k");
  const active = r.activeSn("ch1");
  const again = makeLiveRotation({ kino, clock: { now: () => 5000 }, random: lcg() });
  assert.equal(again.activeSn("ch1"), active);
  assert.equal(again.triedCount("ch1"), 1);
});

test("in memory the state also expires after the ttl", () => {
  const base = fakeKino();
  const clock = { t: 0, now() { return this.t; } };
  const broken = { get: () => null, set: () => { throw new Error("full"); }, remove: () => {}, keys: () => [] };
  const r = makeLiveRotation({ kino: { ...base, storage: broken }, clock, random: lcg() });
  r.onRefused("ch1", "a", pool, "k");
  assert.ok(r.activeSn("ch1"));
  clock.t = ROTATION_TTL_MS + 1;
  assert.equal(r.activeSn("ch1"), null);
});

test("many channels stay inside the budget: at most 12 kept, about 4 KB in total", () => {
  const { r, kino } = setup({ max: 3 });
  const sn32 = (i) => i.toString(16).padStart(32, "0");
  const bigPool = Array.from({ length: 40 }, (_, i) => seed(sn32(i + 100)));
  for (let ch = 0; ch < 30; ch++) {
    const code = `cyx_${String(ch).padStart(28, "9")}`;
    let current = sn32(ch);
    for (let i = 0; i < 4; i++) { r.onRefused(code, current, bigPool, `lic-${ch}-${i}`); current = r.activeSn(code) || current; }
  }
  const keys = kino.storage.keys().filter((k) => k.startsWith("liveRot:"));
  assert.ok(keys.length <= 12, "kept " + keys.length);
  const bytes = keys.reduce((n, k) => n + k.length + kino.storage.get(k).length, 0);
  assert.ok(bytes <= 4096, "rotation state " + bytes + " bytes");
});
