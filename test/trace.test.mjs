// The breadcrumb writer: `xuper:<area> <event> k=v ...`, short, never a secret-shaped value.
import test from "node:test";
import assert from "node:assert/strict";
import { trace, report, errCode, seedTag, MAX_LINE_CHARS } from "../src/trace.js";
import { PortalError } from "../src/portal.js";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { appScrub } from "./helpers/appScrubber.mjs";

const capture = () => {
  const lines = [];
  const kino = { ...fakeKino(), log: (...a) => lines.push(a.map(String).join(" ")) };
  return { kino, lines };
};

test("one line in the fixed format, numbers rounded, booleans as 1/0, null/undefined fields left out", () => {
  const { kino, lines } = capture();
  trace(kino, "portal", "host_fail", { path: "v8/active", i: 1, ms: 12.7, ok: false, skip: undefined, none: null });
  assert.deepEqual(lines, ["xuper:portal host_fail path=v8/active i=1 ms=13 ok=0"]);
});

test("a value that is not a short plain word becomes ?: hosts, urls, emails, spaces, long ids", () => {
  const { kino, lines } = capture();
  trace(kino, "x", "e", {
    a: "portal.example.com", b: "https://x/y", c: "a@b.co", d: "two words", e: "f".repeat(33), f: "aaa100027",
  });
  assert.equal(lines[0], "xuper:x e a=? b=? c=? d=? e=? f=aaa100027");
});

test("a key that names a secret or an address is dropped whatever its value", () => {
  const { kino, lines } = capture();
  trace(kino, "x", "e", {
    token: "1", userToken: "1", password: "1", session: "1", secret: "1", auth: "1", cookie: "1", email: "1",
    host: "1", url: "1", sn: "1", key: "1", userId: "1", kept: "1",
  });
  assert.equal(lines[0], "xuper:x e kept=1");
});

test("never throws: a log that throws, an odd area, a field object that is not one", () => {
  const kino = { log: () => { throw new Error("boom"); } };
  assert.doesNotThrow(() => trace(kino, "a", "b", { x: 1 }));
  assert.doesNotThrow(() => trace(null, "a", "b"));
  const { kino: k2, lines } = capture();
  trace(k2, "Bad Area!", "ev ent", "nope");
  assert.equal(lines[0], "xuper:? ?");
});

test("a line is cut at MAX_LINE_CHARS", () => {
  const { kino, lines } = capture();
  const fields = {};
  for (let i = 0; i < 40; i++) fields["k" + i] = "v".repeat(20);
  trace(kino, "x", "e", fields);
  assert.ok(lines[0].length <= MAX_LINE_CHARS, lines[0].length);
});

test("errCode: a portal code, a kino error's code, else the error's name, never its message", () => {
  assert.equal(errCode(new PortalError("aaa100027", "secret text host.example")), "aaa100027");
  const ke = new Error("host no permitido: portal.example"); Object.defineProperty(ke, "name", { value: "KinoError_host_not_allowed" });
  assert.equal(errCode(ke), "host_not_allowed");
  assert.equal(errCode(new TypeError("x.y is undefined")), "TypeError");
  assert.equal(errCode(null), "error");
  assert.equal(errCode({ name: "with space" }), "error");
});

test("seedTag: 8 hex of a hash, stable, never the sn itself; ? when there is none", () => {
  const { kino } = capture();
  const a = seedTag(kino, "seed-sn-1");
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(seedTag(kino, "seed-sn-1"), a);
  assert.notEqual(seedTag(kino, "seed-sn-2"), a);
  assert.equal(seedTag(kino, ""), "?");
  assert.equal(seedTag({ crypto: { hash: () => { throw new Error("x"); } } }, "s"), "?");
});

test("values: at most 20 characters; a hex run of 12+ or a digit run of 10+ is never written", () => {
  const { kino, lines } = capture();
  trace(kino, "x", "e", {
    a: "abcdefghijklmnopqrst", b: "abcdefghijklmnopqrstu", c: "0123456789abcdef0123",
    d: "x-deadbeef0123", e: "n1234567890", f: 12345678901, g: "portal100024", h: "deadbeef012", i: 123456789,
  });
  assert.equal(lines[0], "xuper:x e a=abcdefghijklmnopqrst b=? c=? d=? e=? f=? g=portal100024 h=deadbeef012 i=123456789");
});

test("a field the app's scrubber would blank is written ?: no k=v of 24+ characters, no 16+ id with a digit", () => {
  const { kino, lines } = capture();
  trace(kino, "x", "e", { outcomeLong: "abcdefghijkl", path: "v2/sendEmailVerifyC", ok: "v1_a2_b3_c4_d5_e6" });
  assert.equal(lines[0], "xuper:x e outcomeLong=? path=? ok=?");
  assert.equal(appScrub(lines[0]), lines[0]);
});

test("report writes the same line through kino.log.report when the app has it, else a plain log line", () => {
  const plain = [];
  const reported = [];
  const log = Object.assign((...a) => plain.push(a.map(String).join(" ")), { report: (...a) => reported.push(a.map(String).join(" ")) });
  report({ ...fakeKino(), log }, "seed", "pick", { pool: 3, seed: "ab12cd34", token: "x" });
  assert.deepEqual(reported, ["xuper:seed pick pool=3 seed=ab12cd34"]);
  assert.deepEqual(plain, []);
  const { kino, lines } = capture();
  report(kino, "session", "seed_pick", { pool: 3 });
  assert.deepEqual(lines, ["xuper:session seed_pick pool=3"]);
});

test("report never throws, even when the app's report does", () => {
  const log = Object.assign(() => {}, { report: () => { throw new Error("boom"); } });
  assert.doesNotThrow(() => report({ ...fakeKino(), log }, "session", "login", { ok: false }));
});
