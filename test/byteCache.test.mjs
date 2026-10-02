import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeByteCache } from "../src/byteCache.js";

const HOUR = 3600_000;
const bytes = (s) => Buffer.byteLength(s, "utf8");

function setup({ budgetBytes = 400, ttlMs = HOUR, valid, failSet = false, failGet = false } = {}) {
  const base = fakeKino();
  const sets = [];
  const storage = Object.freeze({
    ...base.storage,
    get: (k) => { if (failGet) throw new Error("io"); return base.storage.get(k); },
    set: (k, v, o) => { sets.push({ k, v, o }); if (failSet) throw new Error("quota"); return base.storage.set(k, v, o); },
  });
  const kino = Object.freeze({ ...base, storage });
  const clock = { t: 1_000_000, now() { return this.t; } };
  const cache = makeByteCache({ kino, key: "c:v1", budgetBytes, clock, ttlMs, valid });
  return { kino, clock, cache, sets, stored: () => base.storage.get("c:v1") };
}

test("write then get: the payload comes back, a miss is undefined, no ttlMs on the key", () => {
  const t = setup();
  t.cache.write([{ k: "a", i: { n: 1 } }]);
  assert.deepEqual(t.cache.get("a"), { n: 1 });
  assert.equal(t.cache.get("b"), undefined);
  assert.equal(t.sets[0].o, undefined);
  assert.equal(JSON.parse(t.stored()).v, 1);
});

test("freshness: fresh strictly below ttl, a get does not renew, stale entries are dropped on the next write", () => {
  const t = setup();
  t.cache.write([{ k: "a", i: 1 }]);
  t.clock.t += HOUR - 1;
  assert.equal(t.cache.get("a"), 1);
  t.clock.t += 1;
  assert.equal(t.cache.get("a"), undefined);
  t.cache.write([{ k: "b", i: 2 }]);
  assert.deepEqual(JSON.parse(t.stored()).e.map((e) => e.k), ["b"]);
});

test("the stored text never exceeds the budget (measured in UTF-8 bytes), oldest evicted first, newest kept", () => {
  const t = setup({ budgetBytes: 300 });
  for (let n = 0; n < 20; n++) {
    t.cache.write([{ k: "k" + n, i: { text: "ñandú-" + n + "-".repeat(30) } }]);
    t.clock.t += 10;
    assert.ok(bytes(t.stored()) <= 300, `after ${n}: ${bytes(t.stored())}`);
  }
  const keys = JSON.parse(t.stored()).e.map((e) => e.k);
  assert.ok(keys.length >= 2 && keys.length < 20);
  assert.equal(keys.at(-1), "k19");
  assert.ok(!keys.includes("k0"));
});

test("multi-byte text is measured as bytes, not characters", () => {
  const t = setup({ budgetBytes: 120 });
  t.cache.write([{ k: "x", i: "ñ".repeat(60) }]); // 60 chars but 120 bytes + framing: over budget
  assert.equal(t.cache.get("x"), undefined);
  assert.equal(t.sets.length, 0);
});

test("an entry that alone exceeds the budget is skipped and evicts nobody", () => {
  const t = setup({ budgetBytes: 200 });
  t.cache.write([{ k: "small", i: 1 }]);
  t.cache.write([{ k: "huge", i: "x".repeat(500) }]);
  assert.equal(t.cache.get("small"), 1);
  assert.equal(t.cache.get("huge"), undefined);
});

test("touched keys move to the newest end (LRU); re-adding a key replaces it", () => {
  const t = setup();
  t.cache.write([{ k: "a", i: 1 }]);
  t.cache.write([{ k: "b", i: 2 }]);
  t.cache.write([], ["a"]);
  assert.deepEqual(JSON.parse(t.stored()).e.map((e) => e.k), ["b", "a"]);
  t.cache.write([{ k: "b", i: 3 }]);
  assert.deepEqual(JSON.parse(t.stored()).e.map((e) => [e.k, e.i]), [["a", 1], ["b", 3]]);
});

test("nothing to store means no write", () => {
  const t = setup();
  t.cache.write([]);
  assert.equal(t.sets.length, 0);
});

test("a storage that throws on set or get never fails the caller", () => {
  const t = setup({ failSet: true });
  assert.doesNotThrow(() => t.cache.write([{ k: "a", i: 1 }]));
  assert.equal(t.sets.length, 1);
  const g = setup({ failGet: true });
  assert.deepEqual(g.cache.read(), []);
  assert.equal(g.cache.get("a"), undefined);
  assert.doesNotThrow(() => g.cache.write([{ k: "a", i: 1 }]));
});

test("corrupt, old-format or foreign stored values read as a miss; invalid payloads are filtered", () => {
  for (const junk of ["not json", "{}", '{"v":2,"e":[]}', '{"v":1,"e":[{"k":1}]}', "[]", '{"v":1,"e":[{"k":"a","s":"x","i":1}]}', '{"v":1,"e":[{"k":"a","s":1}]}']) {
    const t = setup();
    t.kino.storage.set("c:v1", junk);
    assert.deepEqual(t.cache.read(), [], junk);
    t.cache.write([{ k: "ok", i: 1 }]);
    assert.equal(t.cache.get("ok"), 1);
  }
  const t = setup({ valid: (p) => typeof p === "number" });
  t.kino.storage.set("c:v1", JSON.stringify({ v: 1, e: [{ k: "a", s: t.clock.t, i: "str" }, { k: "b", s: t.clock.t, i: 5 }] }));
  assert.deepEqual(t.cache.read().map((e) => e.k), ["b"]);
});
