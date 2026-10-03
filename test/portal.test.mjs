import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeCrypto } from "../src/crypto.js";
import { makePortal, PortalError, mapPortalError } from "../src/portal.js";

const reply = (obj) => ({ text: () => (typeof obj === "string" ? obj : JSON.stringify(obj)) });

// `script(host, call)` answers per host; `calls` records every fetch.
function setup({ hosts = ["h1.test", "h2.test"], script, sn = "SN-STORED" } = {}) {
  const calls = [];
  const sleeps = [];
  let now = 1000;
  const base = fakeKino({
    fetch: async (url, opts) => {
      const host = new URL(url).host;
      const c = { url, host, opts };
      calls.push(c);
      return script(host, c);
    },
  });
  const kino = Object.freeze({ ...base, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
  const crypto = makeCrypto(kino);
  const clock = { now: () => now, advance: (ms) => { now += ms; } };
  const portal = makePortal({
    kino, crypto, clock, snProvider: () => sn,
    config: { hosts, appId: "app-1", apkVersion: "9.9" },
  });
  return { portal, calls, sleeps, clock, crypto, kino };
}

const sent = (crypto, c) => JSON.parse(crypto.decryptBlob(c.opts.body));

test("fails over to the next host, then prefers the one that answered", async () => {
  const { portal, calls } = setup({
    script: (host) => { if (host === "h1.test") throw new Error("down"); return reply({ ok: 1 }); },
  });
  assert.deepEqual(await portal.call("a/b", {}), { ok: 1 });
  assert.deepEqual(calls.map((c) => c.host), ["h1.test", "h2.test"]);
  await portal.call("a/b", {});
  assert.deepEqual(calls.slice(2).map((c) => c.host), ["h2.test"]);
  assert.equal(calls[2].url, "https://h2.test/api/portalCore/a/b");
});

test("a portal error is final: no second host, PortalError with code and message", async () => {
  const { portal, calls } = setup({
    script: () => reply({ returnCode: "portal100024", errorMessage: "blocked" }),
  });
  await assert.rejects(portal.call("x", {}), (e) =>
    e instanceof PortalError && e.code === "portal100024" && e.message === "blocked");
  assert.equal(calls.length, 1);
});

test("returnCode 0 is success; numeric nonzero is an error", async () => {
  let rc = 0;
  const { portal } = setup({ script: () => reply({ returnCode: rc, v: 1 }) });
  assert.deepEqual(await portal.call("x", {}), { returnCode: 0, v: 1 });
  rc = 5;
  await assert.rejects(portal.call("x", {}), (e) => e instanceof PortalError && e.code === "5");
});

test("a non-JSON body moves on to the next host and never throws raw", async () => {
  const { portal, calls } = setup({
    script: (host) => (host === "h1.test" ? reply("<html>nope") : reply({ v: 2 })),
  });
  assert.deepEqual(await portal.call("x", {}), { v: 2 });
  assert.equal(calls.length, 2);
});

test("all hosts non-JSON: unavailable, not a SyntaxError", async () => {
  const { portal } = setup({ script: () => reply("garbage") });
  await assert.rejects(portal.call("x", {}), (e) => e.code === "unavailable" && !(e instanceof SyntaxError));
});

test("data is decrypted; a decrypt failure on a 200 moves to the next host", async () => {
  let crypto;
  const s = setup({
    script: (host) => {
      if (host === "h1.test") return reply({ data: "abcd" }); // hex, but not valid ciphertext
      return reply({ data: crypto.encryptBody(JSON.stringify({ list: [1, 2] })) });
    },
  });
  crypto = s.crypto;
  assert.deepEqual(await s.portal.call("x", {}), { list: [1, 2] });
  assert.equal(s.calls.length, 2);
});

test("decrypt failure on every host never becomes an empty result", async () => {
  const { portal } = setup({ script: () => reply({ data: "abcd" }) });
  await assert.rejects(portal.call("x", {}), (e) => e.code === "unavailable");
});

test("without data the whole answer comes back", async () => {
  const { portal } = setup({ script: () => reply({ returnCode: "0", a: 1 }) });
  assert.deepEqual(await portal.call("x", {}), { returnCode: "0", a: 1 });
});

test("body: base fields + bean + device dict (device overwrites the bean)", async () => {
  const { portal, calls, crypto } = setup({ script: () => reply({}) });
  await portal.call("x", { reserve1: "from-bean", keep: "k" }, { userId: "u1", userToken: "t1" });
  const b = sent(crypto, calls[0]);
  assert.equal(b.portalCode, "masnew");
  assert.equal(b.userId, "u1");
  assert.equal(b.userToken, "t1");
  assert.equal(b.keep, "k");
  assert.equal(b.reserve1, ""); // overwritten by the device dict
  assert.equal(b.sn, "SN-STORED");
  assert.equal(b.appId, "app-1");
  assert.equal(b.apkVersion, "9.9");
  assert.equal(b.sysVersion, "2025-08-07 05:40:11_36_16_");
  assert.equal(b.sdkVer, 36);
  assert.equal(b.loginType, "2");
  assert.equal(b.model, "sdk_gphone64_arm64");
});

test("baseFields false drops portalCode/userId/userToken; explicit sn overrides the provider", async () => {
  const { portal, calls, crypto } = setup({ script: () => reply({}) });
  await portal.call("x", { a: 1 }, { baseFields: false, sn: "TMP" });
  const b = sent(crypto, calls[0]);
  assert.equal("portalCode" in b, false);
  assert.equal("userId" in b, false);
  assert.equal("userToken" in b, false);
  assert.equal(b.sn, "TMP");
  assert.equal(b.a, 1);
});

test("snProvider is read on every call", async () => {
  let sn = "A";
  const calls = [];
  const base = fakeKino({ fetch: async (u, o) => { calls.push(o); return reply({}); } });
  const kino = Object.freeze({ ...base, sleep: async () => {} });
  const crypto = makeCrypto(kino);
  const portal = makePortal({ kino, crypto, clock: { now: () => 0 }, snProvider: () => sn,
    config: { hosts: ["h"], appId: "a", apkVersion: "1" } });
  await portal.call("x", {});
  sn = "B";
  await portal.call("x", {});
  assert.deepEqual(calls.map((o) => JSON.parse(crypto.decryptBlob(o.body)).sn), ["A", "B"]);
});

test("headers are exactly the five, with the fixed apkVer literal", async () => {
  const { portal, calls } = setup({ script: () => reply({}) });
  await portal.call("x", {});
  assert.deepEqual(calls[0].opts.headers, {
    apk: "app-1",
    apkVer: "43404",
    spkgVer: "2025-08-07 05:40:11_36_16_",
    "User-Agent": "okhttp/3.12.12",
    "Content-Type": "application/json;charset=utf-8",
  });
});

test("fetch options: POST, encrypted hex body, no cookies, 25 s timeout", async () => {
  const { portal, calls } = setup({ script: () => reply({}) });
  await portal.call("x", {});
  const o = calls[0].opts;
  assert.equal(o.method, "POST");
  assert.match(o.body, /^[0-9a-f]+$/);
  assert.equal(o.cookies, false);
  assert.equal(o.timeoutMs, 25000);
});

test("pacing: calls start >= 400 ms apart, one wait per call, none for host failover", async () => {
  const { portal, sleeps, clock, calls } = setup({
    script: (host) => { if (host === "h1.test") throw new Error("down"); return reply({}); },
  });
  await portal.call("x", {});
  assert.deepEqual(sleeps, []); // first call never waits
  clock.advance(100);
  await portal.call("x", {}); // host failover inside the call: still a single wait
  assert.deepEqual(sleeps, [300]);
  assert.equal(calls.length, 3); // h1,h2 then h2 (preferred)
  clock.advance(1000);
  await portal.call("x", {});
  assert.deepEqual(sleeps, [300]); // already far apart
});

test("no hosts: unavailable with a Spanish message", async () => {
  const { portal } = setup({ hosts: [], script: () => reply({}) });
  await assert.rejects(portal.call("x", {}), (e) =>
    e.code === "unavailable" && e.message === "sin hosts configurados");
});

test("all hosts down: fixed Spanish message, no host or raw error text leaks", async () => {
  const { portal } = setup({
    script: (h) => { throw new Error("fetch https://" + h + "/api/portalCore/x failed SECRET-DETAIL"); },
  });
  await assert.rejects(portal.call("x", {}), (e) =>
    e.code === "unavailable" && e.message.length > 0 &&
    !/SECRET-DETAIL|h1\.test|h2\.test|https?:/.test(e.message));
});

test("mapPortalError follows section 10", () => {
  const { kino } = setup({ script: () => reply({}) });
  assert.equal(mapPortalError("portal100004", "", kino).code, "not_found");
  assert.equal(mapPortalError("zzz", "视频不存在", kino).code, "not_found");
  assert.equal(mapPortalError("portal100024", "", kino).code, "geo_blocked");
  assert.equal(mapPortalError("aaa100027", "", kino).code, "auth_required");
  assert.equal(mapPortalError("aaa100028", "", kino).code, "auth_required");
  assert.equal(mapPortalError("other", "x", kino).code, "unavailable");
  assert.equal(mapPortalError("other", undefined, kino).code, "unavailable");
});

test("pacing: four parallel calls start >= 400 ms apart (the slot is taken under a lock)", async () => {
  let clk = null;
  const starts = [];
  const { portal, clock, sleeps } = setup({ script: () => { starts.push(clk.now()); return reply({ ok: 1 }); } });
  clk = clock;
  await Promise.all([1, 2, 3, 4].map((n) => portal.call("p/" + n, {})));
  assert.equal(starts.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(starts[i] - starts[i - 1] >= 400, `gap ${i}: ${starts[i] - starts[i - 1]}`);
  assert.deepEqual(sleeps, [400, 400, 400]); // first call never waits; one wait per later call
});

// ---- optional bounds for callers with a cap of their own --------------------------------------

test("opts.timeoutMs reaches kino.fetch: default 25 s, clamped to 1..30 s", async () => {
  const { portal, calls } = setup({ script: () => reply({ v: 1 }) });
  await portal.call("x", {});
  await portal.call("x", {}, { timeoutMs: 5000 });
  await portal.call("x", {}, { timeoutMs: 99999 });
  await portal.call("x", {}, { timeoutMs: 0 });
  await portal.call("x", {}, { timeoutMs: "nope" });
  assert.deepEqual(calls.map((c) => c.opts.timeoutMs), [25000, 5000, 30000, 25000, 25000]);
});

test("opts.deadline shortens a request and stops failover once passed", async () => {
  const { portal, calls, clock } = setup({
    script: () => { clock.advance(12000); throw new Error("slow"); },
  });
  const deadline = clock.now() + 17000;
  await assert.rejects(portal.call("x", {}, { timeoutMs: 12000, deadline }), (e) => e.name === "KinoError_unavailable");
  // The first of two hosts gets half the time left (so a black hole cannot use it all); the last, the rest.
  assert.deepEqual(calls.map((c) => c.opts.timeoutMs), [8500, 5000]);

  const second = setup({ script: () => { throw new Error("slow"); } });
  second.clock.advance(100);
  await assert.rejects(second.portal.call("x", {}, { deadline: second.clock.now() - 1 }), (e) => e.name === "KinoError_unavailable");
  assert.equal(second.calls.length, 0, "a passed deadline starts no request");
});

// ---- the answer's `data` and an error without text (app triage #8) ------------------------------

test("a PortalError the portal sent without text carries its code as the message", async () => {
  for (const em of [undefined, "", "   ", 7]) {
    const { portal } = setup({ hosts: ["h1.test"], script: () => reply({ returnCode: "aaa100099", ...(em === undefined ? {} : { errorMessage: em }) }) });
    await assert.rejects(portal.call("x", {}), (e) => {
      assert.ok(e instanceof PortalError);
      assert.equal(e.code, "aaa100099");
      assert.equal(e.message, "aaa100099");
      return true;
    });
  }
  assert.equal(new PortalError("c1").message, "c1");
  assert.equal(new PortalError("c1", "texto").message, "texto");
});

test("`data`: a string is decrypted, absent/null/empty is the whole answer, an object is the answer itself", async () => {
  const { portal } = setup({ hosts: ["h1.test"], script: (h, c) => reply(answers.shift()) });
  const answers = [
    { returnCode: "0", v: 1 },
    { returnCode: "0", data: null, v: 2 },
    { returnCode: "0", data: "", v: 3 },
    { returnCode: "0", data: { inner: 4 } },
  ];
  assert.deepEqual(await portal.call("x", {}), { returnCode: "0", v: 1 });
  assert.deepEqual(await portal.call("x", {}), { returnCode: "0", data: null, v: 2 });
  assert.deepEqual(await portal.call("x", {}), { returnCode: "0", data: "", v: 3 });
  assert.deepEqual(await portal.call("x", {}), { inner: 4 }, "an unencrypted object is the data, not the envelope");
});

test("`data` of any other type is not an answer: the next host is asked", async () => {
  for (const data of [5, true, ["a"]]) {
    const { portal, calls } = setup({ script: (host) => (host === "h1.test" ? reply({ returnCode: "0", data }) : reply({ returnCode: "0", v: 9 })) });
    assert.deepEqual(await portal.call("x", {}), { returnCode: "0", v: 9 }, JSON.stringify(data));
    assert.equal(calls.length, 2);
  }
});
