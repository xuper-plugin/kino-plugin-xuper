import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

test("the literal K table is the sine definition except the four tweaked steps", async () => {
  const { K, TWEAKED_STEPS } = await import("../src/tweakedMd5.js");
  assert.equal(K.length, 64);
  assert.deepEqual([...TWEAKED_STEPS].sort((a, b) => a - b), [42, 45, 54, 62]);
  for (let i = 0; i < 64; i++) {
    const textbook = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
    if (TWEAKED_STEPS.includes(i)) assert.notEqual(K[i], textbook, "step " + i + " is tweaked");
    else assert.equal(K[i], textbook, "step " + i);
  }
  assert.equal(K[42], 0xd46f3085);
  assert.equal(K[45], 0xe6bd99e5);
  assert.equal(K[54], 0xffecc47d);
  assert.equal(K[62], 0x2da7d2bb);
});

test("the signing code needs no BigInt (one less engine feature to trust on the device's QuickJS)", () => {
  const source = readFileSync(new URL("../src/tweakedMd5.js", import.meta.url), "utf8");
  assert.ok(!/BigInt|\d+n\b/.test(source), "BigInt in src/tweakedMd5.js");
});
