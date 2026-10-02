import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { digestHex, signO3 } from "../src/tweakedMd5.js";

// Captured from the real app (same vectors as the native TweakedMd5Test).
const VECTORS = [
  ["941d98961990d67e249dcd1ac57378c8", 1786228951248, "42eda1217c11706f8034f00831f11645"],
  ["941d98961990d67e249dcd1ac57378c8", 1786229028826, "7b7a1751bd8dc9fa4cb38bcc8dd8acb3"],
  ["941d98961990d67e249dcd1ac57378c8", 1786229709567, "0cccdfc85f900a6ee407eedd13003494"],
  ["c3ec544b53a526c59ab677ffbdffa1e0", 1786223278615, "2e055d6f2c0407c82017286e8f4a31ad"],
  ["c3ec544b53a526c59ab677ffbdffa1e0", 1786225491689, "095a0c6ebc25e6570705fd9d16c6b67b"],
];

test("the five real sign2 vectors", () => {
  for (const [token, moment, expected] of VECTORS) {
    assert.equal(signO3(token, moment), expected, "moment " + moment);
  }
});

test("padding boundaries do not shift", () => {
  const expected = {
    0: "788eb771bc499f0bc7f00fdb08c397aa",
    55: "3df0dbf8fb79a50d50d4d1d95a40942c",
    56: "0e0b477553c03363f907a303756fb565",
    63: "16b54eb04d82dee39edc72de0532523d",
    64: "acd46d59775f5cd639b96b2d1a4dc020",
    65: "233f868f6402130ab977de8bd5d2b943",
  };
  for (const [n, hex] of Object.entries(expected)) {
    assert.equal(digestHex(new Uint8Array(Number(n))), hex, "length " + n);
  }
});

test("it is not standard MD5", () => {
  const md5 = createHash("md5").update(new Uint8Array(64)).digest("hex");
  assert.notEqual(digestHex(new Uint8Array(64)), md5);
  const abc = new TextEncoder().encode("abc");
  assert.notEqual(digestHex(abc), "900150983cd24fb0d6963f7d28e17f72"); // real MD5("abc")
});
