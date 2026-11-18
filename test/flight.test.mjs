import { test } from "node:test";
import assert from "node:assert/strict";
import { beginCall, once, callSeq, callStartedAt, saneAt, CLOCK_SKEW_MS } from "../src/flight.js";

test("once dedups within a call: concurrent and later callers share one run", async () => {
  beginCall();
  let runs = 0;
  const fn = async () => { runs++; return runs; };
  const [a, b] = await Promise.all([once("k", fn), once("k", fn)]);
  const c = await once("k", fn);
  assert.equal(runs, 1);
  assert.deepEqual([a, b, c], [1, 1, 1]);
});

test("beginCall resets: the next call runs the key again", async () => {
  beginCall();
  let runs = 0;
  await once("k", async () => ++runs);
  beginCall();
  await once("k", async () => ++runs);
  assert.equal(runs, 2);
});

test("a rejection is shared within the call (no retry storm) until forced", async () => {
  beginCall();
  let runs = 0;
  const failing = async () => { runs++; throw new Error("boom"); };
  await assert.rejects(once("x", failing));
  await assert.rejects(once("x", failing));
  assert.equal(runs, 1);
  const v = await once("x", async () => "ok", { force: true });
  assert.equal(v, "ok");
  assert.equal(await once("x", failing), "ok", "later callers share the forced run");
});

test("once(key, fn, { force: true }) re-runs inside one call (nuvio re-list)", async () => {
  beginCall();
  let runs = 0;
  await once("list", async () => ++runs);
  const again = await once("list", async () => ++runs, { force: true });
  assert.equal(again, 2);
  assert.equal(runs, 2);
});

test("callSeq counts calls and callStartedAt is the call's start", () => {
  const before = callSeq();
  const t0 = Date.now();
  beginCall();
  assert.equal(callSeq(), before + 1);
  assert.ok(callStartedAt() >= t0 && callStartedAt() <= Date.now());
});

test("saneAt: a stamp more than 60 s in the future (a clock set back) reads as 0, anything else as itself", () => {
  const now = 1_800_000_000_000;
  assert.equal(saneAt(now - 5000, now), now - 5000);
  assert.equal(saneAt(now + CLOCK_SKEW_MS, now), now + CLOCK_SKEW_MS, "small skew is tolerated");
  assert.equal(saneAt(now + CLOCK_SKEW_MS + 1, now), 0);
  assert.equal(saneAt(now + 30 * 24 * 3600000, now), 0);
  assert.equal(saneAt(undefined, now), 0);
  assert.equal(saneAt("123", now), 123);
});
