import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeCrypto } from "../src/crypto.js";

const KEY = "000102030405060708090a0b0c0d0e0f1011121314151617"; // stand-in, never the real key

test("encrypt then decrypt returns the text, wire is hex of base64", () => {
  const c = makeCrypto(fakeKino({ secrets: { magisKey: KEY } }));
  const wire = c.encryptBody('{"hola":"mundo"}');
  assert.match(wire, /^[0-9a-f]+$/);
  const b64 = Buffer.from(wire, "hex").toString("ascii");
  assert.equal(b64.length % 4, 0); // base64 padded
  assert.match(b64, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(c.decryptBlob(wire), '{"hola":"mundo"}');
});

test("non-ASCII text round-trips as UTF-8", () => {
  const c = makeCrypto(fakeKino({ secrets: { magisKey: KEY } }));
  assert.equal(c.decryptBlob(c.encryptBody('{"n":"Ñandú ✓"}')), '{"n":"Ñandú ✓"}');
});

test("odd-length, uppercase, or non-hex wire is refused, not read leniently", () => {
  const c = makeCrypto(fakeKino({ secrets: { magisKey: KEY } }));
  const wire = c.encryptBody("x");
  for (const bad of ["abc", "zz".repeat(8), "", wire.toUpperCase(), " " + wire]) {
    assert.throws(() => c.decryptBlob(bad), (e) => e.code === "unavailable", JSON.stringify(bad));
  }
});

test("a wrong key surfaces as unavailable, never as an empty string", () => {
  const good = makeCrypto(fakeKino({ secrets: { magisKey: KEY } })).encryptBody("x");
  const bad = makeCrypto(fakeKino({ secrets: { magisKey: "ff".repeat(24) } }));
  assert.throws(() => bad.decryptBlob(good), (e) => e.code === "unavailable");
});

test("valid hex whose bytes are not base64 or not a whole 3DES block is unavailable", () => {
  const c = makeCrypto(fakeKino({ secrets: { magisKey: KEY } }));
  const hexOf = (s) => Buffer.from(s, "ascii").toString("hex");
  assert.throws(() => c.decryptBlob(hexOf("QUJD")), (e) => e.code === "unavailable"); // 3 bytes: bad length
  assert.throws(() => c.decryptBlob(hexOf("!!!!")), (e) => e.code === "unavailable");
});

test("the failure message never carries the key", () => {
  const c = makeCrypto(fakeKino({ secrets: { magisKey: "ff".repeat(24) } }));
  const good = makeCrypto(fakeKino({ secrets: { magisKey: KEY } })).encryptBody("x");
  try { c.decryptBlob(good); assert.fail("should throw"); }
  catch (e) { assert.ok(!String(e.message).includes("ff".repeat(24))); }
});
