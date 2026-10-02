import test from "node:test";
import assert from "node:assert/strict";
import { encode, decode, encodeChapter, isSeries, SERIES } from "../src/refs.js";

// A REAL gateway ref (`base64url(json).hmac`), already expired and signed with a key we do not
// have: exactly what old libraries still hold (the native MagisRefTest fixture).
const oldRef =
  "eyJzIjoibWFnaXMiLCJwIjp7ImNvbnRlbnRfaWQiOiIxNDcwOTc0IiwicHJvZ3JhbV90eXBlIjoidGVsZXBsYXki" +
  "LCJlcGlzb2RlIjozfSwiZXhwIjoxNzU3MDAwMDAwfQ.lkewA6xe7e098nDA5WYNWA";
const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

test("round trip of its own format", () => {
  const ref = { contentId: "1470974", programType: "teleplay", episode: 3 };
  assert.equal(encode(ref), "magis1:teleplay:3:1470974");
  assert.deepEqual(decode(encode(ref)), { ...ref, isSeries: true });
});

test("encode defaults: movie and episode 0", () => {
  assert.equal(encode({ contentId: "C1" }), "magis1:movie:0:C1");
  assert.equal(encode({ contentId: "C1", programType: "" }), "magis1:movie:0:C1");
});

test("a contentId with colons inside survives (split limit 4)", () => {
  const ref = { contentId: "cyx:raro:99", programType: "movie", episode: 0 };
  assert.deepEqual(decode(encode(ref)), { ...ref, isSeries: false });
});

test("chapter refs always carry the literal teleplay, even for variety", () => {
  assert.equal(encodeChapter(7, "S1"), "magis1:teleplay:7:S1");
  assert.deepEqual(decode(encodeChapter(7, "S1")), { contentId: "S1", programType: "teleplay", episode: 7, isSeries: true });
});

test("blank program type reads as movie; a non-number episode reads as 0", () => {
  assert.deepEqual(decode("magis1::0:C1"), { contentId: "C1", programType: "movie", episode: 0, isSeries: false });
  assert.deepEqual(decode("magis1:teleplay:tres:C1"), { contentId: "C1", programType: "teleplay", episode: 0, isSeries: true });
  assert.equal(decode("magis1:teleplay:99999999999:C1").episode, 0); // beyond Int: toIntOrNull is null
  assert.equal(decode("magis1:teleplay:-2:C1").episode, -2);
  assert.equal(decode("magis1:teleplay:+4:C1").episode, 4);
});

test("the portal's three series types count as a series, movie does not", () => {
  for (const t of ["teleplay", "series", "variety"]) assert.equal(isSeries(t), true, t);
  assert.equal(isSeries("movie"), false);
  assert.deepEqual([...SERIES].sort(), ["series", "teleplay", "variety"]);
});

test("an old gateway ref is understood even if expired and signed with another key", () => {
  assert.deepEqual(decode(oldRef), { contentId: "1470974", programType: "teleplay", episode: 3, isSeries: true });
});

test("legacy ref: defaults and number content ids", () => {
  const r = decode(b64url({ s: "magis", p: { content_id: 55 } }) + ".sig");
  assert.deepEqual(r, { contentId: "55", programType: "movie", episode: 0, isSeries: false });
  const r2 = decode(b64url({ s: "magis", p: { content_id: "x", program_type: "", episode: "4" } }) + ".sig");
  assert.equal(r2.episode, 4);
  assert.equal(r2.programType, "movie");
});

test("a legacy ref from another source is not Magis's", () => {
  const fromWeb = "eyJzIjoid2ViIiwicCI6eyJ1cmwiOiJ4In0sImV4cCI6MTc1NzAwMDAwMH0.hAsrHhTwBhEMO5hw9hZ_bA";
  assert.equal(decode(fromWeb), null);
  assert.equal(decode(b64url({ s: "magis", p: { content_id: "  " } }) + ".x"), null);
  assert.equal(decode(b64url({ s: "magis" }) + ".x"), null);
  assert.equal(decode(b64url([1, 2]) + ".x"), null);
});

test("garbage, empty and half-built things give null instead of throwing", () => {
  for (const g of ["", "   ", "magis1", "magis1:movie", "magis1:movie:0:", "magis1:movie:0:   ",
    "no-es-un-ref", "sinpunto", "...", "@@@.@@@", "eyJzIjoibWFnaXMi.x", ".x", "abc.", null, undefined, 42]) {
    assert.equal(decode(g), null, "ref " + String(g));
  }
});

test("legacy ref: multi-byte UTF-8 content ids decode", () => {
  assert.equal(decode(b64url({ s: "magis", p: { content_id: "ñandú€😀" } }) + ".x").contentId, "ñandú€😀");
});
