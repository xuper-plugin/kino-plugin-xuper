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

// Device bug (task-23 smoke, Redmi): `portal v6/getLiveData: el portal no se pudo descifrar`. A
// 500-channel page is a wire of megabytes, and the app's QuickJS (2024-02-14) keeps one backtrack
// state per repetition of a non-simple regex: `/^(?:[0-9a-f]{2})+$/` over 1 MiB of hex needs ~30 MB
// of heap and throws "out of memory in regexp execution" in the 64 MB sandbox whenever the heap is
// already half full (measured with that QuickJS: 1 MiB fails with 32 MB held, 1.5 MiB with 16 MB).
// Node's regex never runs out, so the test makes any regex over a long string throw the same way
// while PLUGIN code runs; kino.crypto is the host's (Kotlin on a device), so the guard is off inside it.
let hostDepth = 0;
function withQuickJsRegexBudget(run) {
  const { exec, test: rtest } = RegExp.prototype;
  const LIMIT = 64 * 1024;
  const guard = (orig) => function (s) {
    if (hostDepth === 0 && typeof s === "string" && s.length > LIMIT) throw new Error("InternalError: out of memory in regexp execution");
    return orig.call(this, s);
  };
  RegExp.prototype.exec = guard(exec);
  RegExp.prototype.test = guard(rtest);
  try { return run(); } finally { RegExp.prototype.exec = exec; RegExp.prototype.test = rtest; }
}
const hostSide = (base) => Object.freeze({
  ...base,
  crypto: Object.freeze({
    ...base.crypto,
    decrypt: (...a) => { hostDepth++; try { return base.crypto.decrypt(...a); } finally { hostDepth--; } },
  }),
});

test("a megabytes-long wire (a 500-channel getLiveData page) decrypts without a regex over it", () => {
  const c = makeCrypto(hostSide(fakeKino({ secrets: { magisKey: KEY } })));
  const channels = Array.from({ length: 500 }, (_, i) => ({
    channelCode: "ch" + i, name: "Canal " + i + " ñ", channelNumber: i + 1, logo: "x".repeat(1200),
  }));
  const plain = JSON.stringify({ channelList: channels });
  const wire = c.encryptBody(plain);
  assert.ok(wire.length > 1_500_000, "the wire is megabytes long: " + wire.length);
  assert.equal(withQuickJsRegexBudget(() => c.decryptBlob(wire)), plain);
});
