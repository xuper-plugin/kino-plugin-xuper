// Request parity with the old kino-plugin-xuper (seed design §9 tests 21-22): every masnew portal request the xuper
// connector sends is the old plugin's, byte for byte (url, method, headers in order, fetch cookies, the JSON body with
// its key order, the wire). The old plugin's requests are pinned by test/fixtures/xuper-old-requests.json and
// test/fixtures/xuper-old-seeds.json, captured with no network by the old plugin's own code (2.6.9) against the same fake
// portal, stand-in key and random byte stream.
//
// BUG-2 (2026-11-16/17: portal200001 "版本已停止使用" on v3/snToken) was measured with this: this version's mint is the old
// plugin's fresh-device mint exactly, so the refusal was not in the request. Since 1.0.46 the default session is the
// device's own anonymous one, as the old plugin's: the listing and open requests match it exactly, ids included; the
// seed contribution sends the same kino.seed payload (its mint carries no existing sn: the one deliberate difference),
// and a seed is applied exactly as the old plugin applied one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const xmod = await import("../src/sources/xuper.js");
const { beginCall, callFor } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const contrib = await import("../src/seedContrib.js");
const xuper = xmod.default;

const FX = JSON.parse(readFileSync(new URL("./fixtures/xuper-old-requests.json", import.meta.url), "utf8"));
const SFX = JSON.parse(readFileSync(new URL("./fixtures/xuper-old-seeds.json", import.meta.url), "utf8"));
const OLD = FX.requests;

// The fixture's random byte stream (xorshift32 from FX.randomSeed), behind both random sources a fingerprint may use:
// Math.random (one draw per byte) and kino.crypto.randomBytes.
let rs = 0;
const nextByte = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs & 0xff; };
const realRandom = Math.random;
const realNow = Date.now;
test.after(() => { Math.random = realRandom; });
test.afterEach(() => { Date.now = realNow; });

// Reference wire, independent of src/sources/xuper-crypto.js: 3DES-EDE/ECB/PKCS7 → base64 → lowercase hex of its ASCII.
const des = (encrypt, data) => {
  const c = (encrypt ? createCipheriv : createDecipheriv)("des-ede3-ecb", Buffer.from(FX.key, "hex"), null);
  return Buffer.concat([c.update(data), c.final()]);
};
const refEncrypt = (plain) => Buffer.from(des(true, Buffer.from(plain, "utf8")).toString("base64"), "ascii").toString("hex");
const refDecrypt = (wire) => des(false, Buffer.from(Buffer.from(wire, "hex").toString("ascii"), "base64")).toString("utf8");

/** A cold runtime on a device: the fake portal answers FX.answers and every portal request is kept whole. */
function device(storage = {}) {
  rs = FX.randomSeed;
  Math.random = () => (nextByte() + 0.5) / 256;
  const sent = [];
  const route = (url, init) => {
    if (/\/seed$/.test(url) && init.method === "POST") { sent.seeds.push(init.body.json.seed); return res(201, "{}"); }
    const m = /^https:\/\/[^/]+\/api\/portalCore\/(.+)$/.exec(url);
    if (!m) return undefined;
    sent.push({
      path: m[1], url, method: init.method, headers: Object.entries(init.headers || {}), cookies: init.cookies,
      wire: init.body, body: refDecrypt(init.body),
    });
    const bean = JSON.parse(refDecrypt(init.body));
    const answer = m[1] === "getNextColumns" && bean.columnCode === "masnew_movies" ? SFX.moviesAnswer : FX.answers[m[1]] || {};
    return res(200, JSON.stringify({ returnCode: "0", errorMessage: "", data: refEncrypt(JSON.stringify(answer)) }));
  };
  const cfg = JSON.stringify({ magisKey: FX.key, email: FX.shared.email, password: FX.shared.password, at: Date.now() });
  const k = installKino({ routes: [route], storage: { "o2:xcfg": cfg, ...storage } });
  k.kino.crypto.randomBytes = (n, enc = "hex") => Buffer.from(Array.from({ length: n }, nextByte)).toString(enc);
  sent.seeds = [];   // what POST /seed received
  sent.kino = k.kino;
  xmod._resetSession();
  beginCall();
  return sent;
}

const only = (sent, path) => sent.filter((r) => r.path === path);

function assertSame(actual, expected, what) {
  assert.ok(actual, what + ": not sent");
  assert.equal(actual.url, expected.url, what + ": url");
  assert.equal(actual.method, expected.method, what + ": method");
  assert.deepEqual(actual.headers, expected.headers, what + ": headers, in order");
  assert.equal(actual.cookies, expected.cookies, what + ": fetch cookies");
  assert.equal(actual.body, expected.body, what + ": body (key order included)");
  assert.equal(actual.wire, refEncrypt(actual.body), what + ": wire");
}

/** `expected` with body fields replaced in place (key order kept). */
const withFields = (expected, fields) => ({ ...expected, body: JSON.stringify({ ...JSON.parse(expected.body), ...fields }) });


test("parity: a fresh device's v3/snToken and v8/active are the old plugin's, byte for byte (BUG-2 was not in the request)", async () => {
  const sent = device();
  await xuper.categories({});
  assertSame(only(sent, "v3/snToken")[0], OLD.mint, "v3/snToken");
  assertSame(only(sent, "v8/active")[0], OLD.activate, "v8/active");
  assert.equal(only(sent, "v3/snToken").length, 1);
});

test("parity: the old seed contribution's mint differs only in the device sn, which a brand-new device sends empty", async () => {
  const sent = device();
  await xuper.categories({});
  assert.equal(JSON.parse(OLD.contribMint.body).sn, FX.storedSn, "the old contribution sends the person's stored sn");
  assertSame(only(sent, "v3/snToken")[0], withFields(OLD.contribMint, { sn: "" }), "v3/snToken");
});

test("parity: getNextColumns, v6/getLiveData, v4/startPlayLive and v14/getSlbInfo on the own anonymous session are the old plugin's exactly (ids included)", async () => {
  const sent = device();
  await xuper.categories({});
  beginCall(); await xuper.channels("31", {});
  beginCall(); await xuper.resolve("ch1");
  assert.deepEqual(sent.map((r) => r.path), ["v3/snToken", "v8/active", "getNextColumns", "v6/getLiveData", "v4/startPlayLive", "v14/getSlbInfo"]);
  assertSame(only(sent, "getNextColumns")[0], OLD.columns, "getNextColumns");
  assertSame(only(sent, "v6/getLiveData")[0], OLD.liveData, "v6/getLiveData");
  assertSame(only(sent, "v4/startPlayLive")[0], OLD.startPlayLive, "v4/startPlayLive");
  assertSame(only(sent, "v14/getSlbInfo")[0], OLD.slb, "v14/getSlbInfo");
});

test("parity: on a stored sn, the reactivation is the old plugin's; a stored device is never minted again", async () => {
  const sent = device({ "o2:xsn": JSON.stringify({ sn: FX.storedSn, at: Date.now() }) });
  await xuper.categories({});
  assert.deepEqual(sent.map((r) => r.path), ["v8/active", "getNextColumns"]);
  assertSame(only(sent, "v8/active")[0], OLD.reactivate, "v8/active");
});

test("parity: the shared-account retry of a channel that needs an account (A′) logs in exactly as the old plugin's shared login", async () => {
  const sent = device({ "o2:xsn": JSON.stringify({ sn: FX.storedSn, at: Date.now() }) });
  const answer = sent.kino.fetch;
  sent.kino.fetch = (url, init) => {
    if (/\/v4\/startPlayLive$/.test(url) && JSON.parse(refDecrypt(init.body)).userToken !== FX.answers["v8/login"].userToken) {
      return Promise.resolve(res(200, JSON.stringify({ returnCode: "aaa100028", errorMessage: "" })));
    }
    return answer(url, init);
  };
  await xuper.resolve("ch1");
  assert.deepEqual(sent.map((r) => r.path), ["v8/active", "v8/login", "v4/startPlayLive", "v14/getSlbInfo"]);
  assertSame(only(sent, "v8/login")[0], OLD.login, "v8/login");
  const shared = { userId: FX.answers["v8/login"].userId, userToken: FX.answers["v8/login"].userToken };
  assertSame(only(sent, "v4/startPlayLive")[0], withFields(OLD.startPlayLive, { ...shared, sn: FX.storedSn }), "v4/startPlayLive on the shared session");
});

// ── the seed contribution and seed use (design §9 tests 21-22) ──

/** Runs one contribution on `sent`'s device at the fixture's clock. */
async function contribute(sent) {
  Date.now = () => SFX.now;
  await clearBearer();
  sent.kino.storage.set("o2:bearer", "bearer-stand-in");
  sent.kino.storage.set("o2:xcfg", JSON.stringify({ magisKey: FX.key, email: FX.shared.email, password: FX.shared.password, at: SFX.now }));
  beginCall(); callFor("home");
  return contrib.maybeContribute();
}

test("parity: the seed contribution sends the old plugin's exact kino.seed payload to POST /seed (jwtToken and extras kept, same key order)", async () => {
  const sent = device();
  await contribute(sent);
  assert.equal(sent.seeds.length, 1);
  assert.equal(JSON.stringify(sent.seeds[0]), JSON.stringify(SFX.contribFresh.seed));
  assertSame(only(sent, "v3/snToken")[0], SFX.contribFresh.mint, "contribution v3/snToken");
  assertSame(only(sent, "v8/active")[0], SFX.contribFresh.activate, "contribution v8/active");
  assertSame(only(sent, "getNextColumns")[0], SFX.contribFresh.validate, "contribution getNextColumns (masnew_movies)");
});

test("parity: on a device with its own stored sn, the contribution's mint still carries no sn (the old plugin leaked the person's)", async () => {
  const sent = device({ "o2:xsn": JSON.stringify({ sn: FX.storedSn, at: Date.now() }) });
  await contribute(sent);
  assert.equal(JSON.parse(SFX.contribStored.mint.body).sn, FX.storedSn, "the old contribution sent the person's sn");
  assertSame(only(sent, "v3/snToken")[0], withFields(SFX.contribStored.mint, { sn: "" }), "v3/snToken");
  assert.equal(JSON.stringify(sent.seeds[0]), JSON.stringify(SFX.contribStored.seed));
});

test("parity: a held seed is applied exactly as the old plugin applied one (getNextColumns, v4/startPlayLive, v14/getSlbInfo)", async () => {
  const s = SFX.seed;
  const sent = device({ "o2:xseed": JSON.stringify({ v: 1, sn: s.sn, userId: s.userId, userToken: s.userToken, gotAt: Date.now(), lifeMs: 6 * 3600_000 }) });
  await xuper.categories({});
  beginCall(); await xuper.resolve("ch1");
  assert.deepEqual(sent.map((r) => r.path), ["getNextColumns", "v4/startPlayLive", "v14/getSlbInfo"], "no mint, activation or login while on a seed");
  assertSame(only(sent, "getNextColumns")[0], SFX.onSeed.columns, "getNextColumns on the seed");
  assertSame(only(sent, "v4/startPlayLive")[0], SFX.onSeed.startPlayLive, "v4/startPlayLive on the seed");
  assertSame(only(sent, "v14/getSlbInfo")[0], SFX.onSeed.slb, "v14/getSlbInfo on the seed");
});
