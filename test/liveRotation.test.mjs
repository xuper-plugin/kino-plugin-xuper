// LiveSeedRotation semantics (native LiveSeedRotation.kt + LiveSeedRotationTest), over kino.storage.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeLiveRotation, MAX_ROTATIONS, ROTATION_TTL_MS, MAX_CARRIED_REFUSALS } from "../src/liveRotation.js";

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

test("budgets are per channel: one channel's spent budget is not another's", () => {
  const { r } = setup({ max: 1 });
  assert.equal(r.onRefused("ch1", "a", pool, "k-a"), true);
  assert.equal(r.onRefused("ch1", r.activeSn("ch1"), pool, "k-x"), false);
  // ch2 starts on nothing carried (ch1's carried seed was refused with nothing left) and rotates on its own.
  assert.equal(r.onRefused("ch2", "a", pool, "k2-a"), true);
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
    // The window runs from the channel's first refusal: the ttl is what is left of it.
    assert.ok(w.o && w.o.ttlMs > ROTATION_TTL_MS - 1000 && w.o.ttlMs <= ROTATION_TTL_MS, JSON.stringify(w.o));
    assert.ok(!w.v.includes("LICENSE-SECRET-VALUE"), "only a digest of the refused key is stored");
    assert.ok(!w.v.includes("t-"), "no seed token is stored, only sns");
  }
});

test("when the host cannot hash, no license reaches storage (and nothing is deduped)", () => {
  const base = fakeKino();
  const stored = [];
  const kino = {
    ...base,
    crypto: { ...base.crypto, hash: () => { throw new Error("no hash"); } },
    storage: { ...base.storage, set: (k, v, o) => { stored.push(v); base.storage.set(k, v, o); } },
  };
  const rot = makeLiveRotation({ kino, clock: { now: () => 1 }, random: () => 0, maxRotations: 3 });
  const LICENSE = "LICENSE-SECRET-VALUE-0123456789";
  assert.equal(rot.onRefused("ch1", "own-sn", pool, LICENSE), true);
  assert.ok(stored.length >= 1);
  for (const v of stored) assert.ok(!v.includes("LICENSE"), "not even a prefix of the license is stored: " + v);
  // an unknown digest cannot prove "the same refusal": the same key twice counts twice
  assert.equal(rot.onRefused("ch1", "own-sn", pool, LICENSE), true);
  assert.equal(rot.triedCount("ch1"), 2);
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
  // Each channel may remember the sessions refused before the carried seed it started on (<= 16 sns).
  const all = kino.storage.keys().filter((k) => k.startsWith("liveRot"));
  const bytes = all.reduce((n, k) => n + k.length + kino.storage.get(k).length, 0);
  assert.ok(bytes <= 16_384, "rotation state " + bytes + " bytes");
});

// ---- 0.9.45 (native 2d285106): the rotated seed is carried, the budget is per window ----------

function timed({ max = 3, window = 60_000, storage } = {}) {
  const base = fakeKino();
  const kino = storage ? { ...base, storage } : base;
  const clock = { t: 1_000_000, now() { return this.t; } };
  const r = makeLiveRotation({ kino, clock, random: lcg(), maxRotations: max, ttlMs: window });
  return { r, clock, kino };
}

test("the seed a rotation landed on is carried to the next channel opened", () => {
  const { r } = setup();
  assert.equal(r.onRefused("ch1", "a", pool, "k-a"), true);
  const landed = r.activeSn("ch1");
  assert.equal(r.activeSn("ch2"), landed, "ch2 starts on the seed that worked, not on the refused own session");
});

test("a channel started on the carried seed never goes back to the session refused elsewhere", () => {
  const { r } = setup({ max: 4 });
  assert.equal(r.onRefused("ch1", "a", pool, "k-a"), true);
  const carried = r.activeSn("ch2");
  assert.equal(r.refuse("ch2", carried, pool, "k2"), "rotated");
  const next = r.activeSn("ch2");
  assert.ok(next !== "a" && next !== carried, next);
  assert.equal(r.triedCount("ch2"), 1, "only ch2's own refusal counts toward its budget");
});

test("an exhausted channel stays on the own session for the rest of the window, whatever more refusals come", () => {
  const { r } = timed({ max: 1 });
  assert.equal(r.refuse("ch1", "a", pool, "k0"), "rotated");
  assert.equal(r.refuse("ch1", r.activeSn("ch1"), pool, "k1"), "exhausted");
  assert.equal(r.activeSn("ch1"), null);
  for (let i = 0; i < 5; i++) assert.equal(r.refuse("ch1", "a", pool, "own-" + i), "already_exhausted");
  assert.equal(r.activeSn("ch1"), null);
});

test("the budget and the carried seed last one window from the first refusal", () => {
  const { r, clock, kino } = timed({ max: 1 });
  r.refuse("ch1", "a", pool, "k0");
  r.refuse("ch1", r.activeSn("ch1"), pool, "k1");
  clock.t += 30_000;
  assert.equal(r.refuse("ch1", "a", pool, "k2"), "already_exhausted", "a refusal inside the window does not extend it");
  const other = makeLiveRotation({ kino: fakeKino(), clock, random: lcg(), ttlMs: 60_000 });
  other.refuse("x", "a", pool, "kx");
  assert.ok(other.activeSn("y") !== null);
  clock.t += 30_000;
  assert.equal(r.triedCount("ch1"), 0, "ch1's window (from its first refusal) is over");
  assert.equal(r.refuse("ch1", "a", pool, "k3"), "rotated", "a new window, a new budget");
  clock.t += 30_000;
  assert.equal(other.activeSn("y"), null, "past the window the carried seed is dropped too");
  assert.ok(kino.storage.keys().length >= 1);
});

test("a carried seed refused with nothing left is not offered to the next channel", () => {
  const { r } = setup({ max: 1 });
  assert.equal(r.onRefused("ch1", "a", pool, "k-a"), true);
  const carried = r.activeSn("ch2");
  assert.equal(r.refuse("ch2", carried, pool, "k2"), "rotated");
  const second = r.activeSn("ch2");
  assert.equal(r.refuse("ch2", second, pool, "k3"), "exhausted");
  assert.equal(r.activeSn("ch3"), null);
});

test("the same refusal repeated is `repeated`, not a rotation", () => {
  const { r } = setup();
  assert.equal(r.refuse("ch1", "a", pool, "lic"), "rotated");
  assert.equal(r.refuse("ch1", "a", pool, "lic"), "repeated");
});

test("the carried seed survives a fresh runtime (kept in storage, sns only, with the window's ttl)", () => {
  const { r, kino, writes } = setup();
  r.onRefused("ch1", "own-sn", pool, "LICENSE-SECRET-VALUE");
  const landed = r.activeSn("ch1");
  const again = makeLiveRotation({ kino, clock: { now: () => 5000 }, random: lcg() });
  assert.equal(again.activeSn("ch9"), landed);
  for (const w of writes) {
    assert.ok(w.o && w.o.ttlMs > 0 && w.o.ttlMs <= ROTATION_TTL_MS);
    assert.ok(!w.v.includes("LICENSE") && !w.v.includes("t-"), "no license or token: " + w.v);
  }
  assert.ok(writes.some((w) => !w.k.startsWith("liveRot:")), "the carried seed has its own key");
});

test("a carried seed remembers at most MAX_CARRIED_REFUSALS refused sessions", () => {
  assert.equal(MAX_CARRIED_REFUSALS, 16);
  const big = Array.from({ length: 80 }, (_, i) => seed("s" + i));
  const { r, kino } = setup({ max: 3 });
  for (let ch = 0; ch < 30; ch++) r.onRefused("c" + ch, r.activeSn("c" + ch) ?? "own", big, "k" + ch);
  const carriedKey = kino.storage.keys().find((k) => !k.startsWith("liveRot:") && k.startsWith("liveRot"));
  assert.ok(carriedKey, kino.storage.keys().join(","));
  assert.ok(JSON.parse(kino.storage.get(carriedKey)).r.length <= 16);
});
