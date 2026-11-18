import { test } from "node:test";
import assert from "node:assert/strict";
import { installKino } from "./helpers/fake-kino.mjs";
import { getText, getJson, setText, setJson, remove, sweepOld } from "../src/store.js";

test("setText refuses anything that is not a string (never '[object Object]')", () => {
  const { store } = installKino();
  assert.throws(() => setText("k", { a: 1 }), TypeError);
  assert.throws(() => setText("k", 5), TypeError);
  assert.throws(() => setText("k", null), TypeError);
  assert.equal(store.has("k"), false);
  assert.equal(setText("k", "v"), true);
  assert.equal(getText("k"), "v");
});

test("setJson stores JSON text and getJson reads it back", () => {
  const { store } = installKino();
  setJson("o", { at: 1, cats: [{ id: "a" }] });
  assert.equal(store.get("o"), '{"at":1,"cats":[{"id":"a"}]}');
  assert.deepEqual(getJson("o"), { at: 1, cats: [{ id: "a" }] });
  assert.equal(getJson("missing"), null);
});

test("getJson: a value that does not parse ('[object Object]') is a miss and is removed", () => {
  const { store } = installKino({ storage: { "sc:x": "[object Object]", bad: "{oops" } });
  assert.equal(getJson("sc:x"), null);
  assert.equal(store.has("sc:x"), false);
  assert.equal(getJson("bad"), null);
  assert.equal(store.has("bad"), false);
});

test("setText returns false (does not throw) when Kino refuses the write", () => {
  const { kino } = installKino();
  kino.storage.set = () => { throw new Error("plugin storage full (16 MB)"); };
  assert.equal(setText("k", "v"), false);
});

test("remove deletes a key", () => {
  const { store } = installKino({ storage: { a: "1" } });
  remove("a");
  assert.equal(store.has("a"), false);
});

test("sweepOld removes every key outside o2: (what Xuper 2.x left), 2.x's `session` included, and keeps this version's", () => {
  const { store } = installKino({ storage: {
    // 2.x's portal session: JSON with the person's portal tokens (never a Bearer, never sent anywhere)
    session: JSON.stringify({ userId: "u1", userToken: "T-SECRET", jwtToken: "J-SECRET", sn: "0123456789abcdef", acct: "" }),
    "rows:meta": "{}", "rows:0": "[]", "chapters:v1": "[]", seeds: "[]", seedsAt: "1", deadSeeds: "{}", "liveCats:v2": "[]",
    homeCountry: "CO", "kino-xuper-hex16": "x", browseTab: "a",
    "o2:bearer": "bearer-token", "o2:cat": "{}", "o2:xsn": '{"sn":"abc"}',
  } });
  assert.equal(sweepOld(), 11);
  assert.deepEqual([...store.keys()].sort(), ["o2:bearer", "o2:cat", "o2:xsn"]);
  assert.equal(store.get("o2:bearer"), "bearer-token", "this version's Bearer stays");
  assert.equal(sweepOld(), 0, "nothing left to remove");
  store.set("session", "{}");   // a restored 2.x backup brings it back
  assert.equal(sweepOld(), 1);
  assert.equal(store.has("session"), false);
});

test("sweepOld on a storage without keys() removes nothing and never throws", () => {
  const { kino } = installKino({ storage: { session: "{}" } });
  delete kino.storage.keys;
  assert.equal(sweepOld(), 0);
});

test("store reads survive a missing kino.storage", () => {
  globalThis.kino = {};
  assert.equal(getText("x"), null);
  assert.equal(getJson("x"), null);
  assert.equal(setText("x", "y"), false);
});
