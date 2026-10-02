import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isObject, asText, optStringStrict, isBlank, notBlank, objects, isKinoError, intOrNull } from "../src/util.js";

test("optStringStrict only reads strings and numbers; asText coerces everything (two different readers, named so)", () => {
  assert.equal(optStringStrict("a"), "a");
  assert.equal(optStringStrict(7), "7");
  assert.equal(optStringStrict(true), "");
  assert.equal(optStringStrict(null), "");
  assert.equal(optStringStrict({}), "");
  assert.equal(asText(true), "true");
  assert.equal(asText(null), "");
  assert.equal(asText(undefined), "");
  assert.equal(asText(7), "7");
});

test("shared predicates", () => {
  assert.equal(isObject({}), true);
  assert.equal(isObject([]), false);
  assert.equal(isObject(null), false);
  assert.equal(isBlank("  "), true);
  assert.equal(isBlank(5), true);
  assert.equal(isBlank(" a "), false);
  assert.equal(notBlank(" a "), true);
  assert.deepEqual(objects([{ a: 1 }, 3, null, []]), [{ a: 1 }]);
  assert.deepEqual(objects("x"), []);
  assert.equal(isKinoError({ name: "KinoError_unavailable" }), true);
  assert.equal(isKinoError(new TypeError("x")), false);
  assert.equal(isKinoError(null), false);
});

test("intOrNull is Kotlin's toString().toIntOrNull()", () => {
  assert.equal(intOrNull("12"), 12);
  assert.equal(intOrNull(12), 12);
  assert.equal(intOrNull("-3"), -3);
  assert.equal(intOrNull("1.5"), null);
  assert.equal(intOrNull(null), null);
  assert.equal(intOrNull("2147483648"), null);
});

test("no module re-declares the shared helpers (one home: src/util.js)", () => {
  for (const f of ["plugin", "wiring", "live", "liveCatalog", "homeTree", "resolve", "episodes", "search", "settings"]) {
    const text = readFileSync(new URL(`../src/${f}.js`, import.meta.url), "utf8");
    assert.ok(!/const isKinoError =|const isObject =/.test(text), f);
  }
});
