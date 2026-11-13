// Per-request signing of a live channel (native-magis §6.5; LiveHlsProxy.contentAuth + requestFromOrigin).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { signingLane } from "../sdk/kino-shim.mjs";
import { checkOutput, validateManifest } from "../sdk/contract.mjs";
import { buildSignContext, signRequest, tokenOf, authorityOf, MAX_CONTEXT_CHARS } from "../src/liveSign.js";
import { signO3 } from "../src/tweakedMd5.js";
import { LIVE_USER_AGENT, LIVE_APP, LIVE_APP_VERSION, LIVE_X_BUFFER } from "../src/config.js";

const checked = validateManifest(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
const manifest = checked.manifest;

const TOKEN_A = "0123456789abcdef0123456789abcdef";
const TOKEN_B = "fedcba9876543210FEDCBA9876543210";
// A realistic authBase: a loose querystring of about 250 characters with the token inside.
const auth = (token, n = 1) =>
  `cdn_type=1&sign_type=cfl&token=${token}&expired=1786300000&uid=${"7".repeat(19)}&sid=${String(n).repeat(32)}` +
  `&region=co&isp=${"x".repeat(24)}&ver=49902&group=live&p=${"q".repeat(60)}&n=${n}`;
const LICENSE = "LIC-" + "z".repeat(120);
const NOW = 1786228951248;

const ctxOf = (cdns) => buildSignContext(LICENSE, cdns).context;
const TWO = [{ cflHost: "cdn1.live.test", authBase: auth(TOKEN_A, 1) }, { cflHost: "cdn2.live.test:8080", authBase: auth(TOKEN_B, 2) }];

test("the live literals are the native proxy's", () => {
  assert.equal(LIVE_USER_AGENT, "Ranger/4.9.4-17294ac0");
  assert.equal(LIVE_APP, "com.android.msandroid");
  assert.equal(LIVE_APP_VERSION, "49902");
  assert.equal(LIVE_X_BUFFER, "0");
});

test("tokenOf finds token=<32 hex> anywhere in the authBase, else empty", () => {
  assert.equal(tokenOf(auth(TOKEN_A)), TOKEN_A);
  assert.equal(tokenOf(auth(TOKEN_B)), TOKEN_B, "upper-case hex too");
  assert.equal(tokenOf("sign_type=cfl&token=corto"), "");
  assert.equal(tokenOf("sign_type=cfl"), "");
});

test("authorityOf: host or host:port of an http url, lower-cased, default port dropped", () => {
  assert.equal(authorityOf("http://CDN1.live.test/live/x.m3u8"), "cdn1.live.test");
  assert.equal(authorityOf("http://cdn2.live.test:8080/live/seg-1.ts?x=1"), "cdn2.live.test:8080");
  assert.equal(authorityOf("http://cdn1.live.test:80/live/x.m3u8"), "cdn1.live.test");
  assert.equal(authorityOf("not a url"), "");
});

test("the headers: Content-Auth = authBase + the sign_o3 tail at now, the license and the fixed literals", () => {
  const out = signRequest({ url: "http://cdn1.live.test/live/pc.m3u8", kind: "playlist", ref: "cyx-RCNHD", context: ctxOf(TWO) }, NOW);
  assert.deepEqual(out, {
    headers: {
      "Content-Auth": `${auth(TOKEN_A, 1)}&sign2_method=sign_o3&instance=0&start_moment=${NOW}&sign2=${signO3(TOKEN_A, NOW)}`,
      "Content-License": LICENSE,
      "User-Agent": "Ranger/4.9.4-17294ac0",
      App: "com.android.msandroid",
      "App-Version": "49902",
      "X-Buffer": "0",
    },
  });
  // The captured vector (TweakedMd5Test) through the whole path.
  const real = signRequest({ url: "http://h.live.test/live/a.m3u8", kind: "playlist", ref: "c", context: buildSignContext("L", [{ cflHost: "h.live.test", authBase: "sign_type=cfl&token=941d98961990d67e249dcd1ac57378c8" }]).context }, 1786228951248);
  assert.ok(real.headers["Content-Auth"].endsWith("&start_moment=1786228951248&sign2=42eda1217c11706f8034f00831f11645"));
});

test("a request on the second CDN's host is signed with ITS authBase and token, never the first's", () => {
  const out = signRequest({ url: "http://cdn2.live.test:8080/live/seg-00042.ts", kind: "segment", ref: "c", context: ctxOf(TWO) }, NOW);
  const ca = out.headers["Content-Auth"];
  assert.ok(ca.startsWith(auth(TOKEN_B, 2) + "&sign2_method=sign_o3"));
  assert.ok(ca.endsWith(`&sign2=${signO3(TOKEN_B, NOW)}`));
  assert.ok(!ca.includes(TOKEN_A));
});

test("a host that is in no entry is signed with the first CDN (the native active-CDN default)", () => {
  const out = signRequest({ url: "http://elsewhere.live.test/k/key.bin", kind: "segment", ref: "c", context: ctxOf(TWO) }, NOW);
  assert.ok(out.headers["Content-Auth"].startsWith(auth(TOKEN_A, 1) + "&"));
  assert.ok(out.headers["Content-Auth"].endsWith(signO3(TOKEN_A, NOW)));
});

test("the moment is a whole number of ms: a fractional clock is truncated in both places", () => {
  const out = signRequest({ url: "http://cdn1.live.test/live/x.m3u8", kind: "playlist", ref: "c", context: ctxOf(TWO) }, NOW + 0.75);
  assert.ok(out.headers["Content-Auth"].endsWith(`&start_moment=${NOW}&sign2=${signO3(TOKEN_A, NOW)}`));
});

test("a broken context is an error, never headers signed with nothing", () => {
  for (const context of ["", "{", "null", "{}", JSON.stringify({ l: "L", c: [] }), JSON.stringify({ l: "L", c: [{ h: "x", a: "no-token" }] })]) {
    assert.throws(() => signRequest({ url: "http://x.live.test/a.m3u8", kind: "playlist", ref: "c", context }, NOW), context);
  }
});

test("signContext: compact keys, every CDN with its host, authBase and token", () => {
  const { context, kept } = buildSignContext(LICENSE, TWO);
  assert.equal(kept.length, 2);
  assert.deepEqual(JSON.parse(context), {
    l: LICENSE,
    c: [{ h: "cdn1.live.test", a: auth(TOKEN_A, 1), t: TOKEN_A }, { h: "cdn2.live.test:8080", a: auth(TOKEN_B, 2), t: TOKEN_B }],
  });
});

test("signContext budget: four CDNs with realistic ~250-char authBases fit in 4096 chars with room", () => {
  const four = [1, 2, 3, 4].map((n) => ({ cflHost: `edge-${n}.cdn${n}.live.test`, authBase: auth(n % 2 ? TOKEN_A : TOKEN_B, n) }));
  for (const c of four) assert.ok(c.authBase.length >= 240, "authBase " + c.authBase.length);
  const { context, kept } = buildSignContext(LICENSE, four);
  assert.equal(kept.length, 4);
  assert.ok(context.length <= MAX_CONTEXT_CHARS, "length " + context.length);
  assert.equal(MAX_CONTEXT_CHARS, 4096);
  assert.ok("t" in JSON.parse(context).c[0], "the token stays when everything fits");
  // Six CDNs (the SDK's alternateHosts cap is 6 + the primary) still fit, with the token field.
  const six = [1, 2, 3, 4, 5, 6].map((n) => ({ cflHost: `edge-${n}.cdn${n}.live.test`, authBase: auth(TOKEN_A, n) }));
  assert.ok(buildSignContext(LICENSE, six).context.length <= MAX_CONTEXT_CHARS);
});

test("signContext over budget: the token field goes first (it is re-read from the authBase), then trailing CDNs", () => {
  const long = (n) => ({ cflHost: `h${n}.live.test`, authBase: auth(TOKEN_A, n) + "&pad=" + "p".repeat(700) });
  const five = [1, 2, 3, 4, 5].map(long);
  const { context, kept } = buildSignContext(LICENSE, five);
  assert.ok(context.length <= MAX_CONTEXT_CHARS);
  const parsed = JSON.parse(context);
  assert.ok(!("t" in parsed.c[0]), "token field dropped");
  assert.equal(parsed.c.length, kept.length);
  assert.ok(kept.length < 5 && kept.length >= 1);
  assert.equal(kept[0].cflHost, "h1.live.test", "the primary always stays");
  // Without the token field sign() still finds it inside the authBase.
  const out = signRequest({ url: "http://h1.live.test/live/x.m3u8", kind: "playlist", ref: "c", context }, NOW);
  assert.ok(out.headers["Content-Auth"].endsWith(signO3(TOKEN_A, NOW)));
  // Not even the primary fits: null, the caller refuses the channel.
  assert.equal(buildSignContext(LICENSE, [{ cflHost: "h.live.test", authBase: auth(TOKEN_A) + "p".repeat(5000) }]), null);
});

test("sign output passes the kit's sign check unchanged", () => {
  const out = signRequest({ url: "http://cdn1.live.test/live/x.m3u8", kind: "playlist", ref: "c", context: ctxOf(TWO) }, NOW);
  const { value, drops } = checkOutput("sign", out, manifest);
  assert.deepEqual(value, out);
  assert.deepEqual(drops, []);
});

test("purity: the plugin's sign export runs in the signing lane (no storage, fetch, sleep, cookies) and 200 signatures take far below 1.5 s", async () => {
  const lane = signingLane(fakeKino());
  const touched = [];
  globalThis.kino = new Proxy(lane, {
    get(target, prop) {
      if (["storage", "fetch", "sleep", "cookies"].includes(prop)) touched.push(prop);
      return target[prop];
    },
  });
  const plugin = await import("../src/plugin.js");
  const context = ctxOf(TWO);
  const t0 = process.hrtime.bigint();
  let last;
  for (let i = 0; i < 200; i++) {
    last = await plugin.sign({ url: i % 2 ? "http://cdn2.live.test:8080/live/s.ts" : "http://cdn1.live.test/live/pc.m3u8", kind: i % 2 ? "segment" : "playlist", ref: "c", context });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 300, `200 signatures took ${ms.toFixed(1)} ms`);
  assert.deepEqual(touched, [], "sign touched " + touched.join(","));
  const moment = Number(/start_moment=(\d+)/.exec(last.headers["Content-Auth"])[1]);
  assert.ok(Math.abs(moment - Date.now()) < 5000, "signed at the real time");
  assert.ok(last.headers["Content-Auth"].endsWith(signO3(TOKEN_B, moment)));
  // A broken context is a kino error, not a crash.
  await assert.rejects(() => plugin.sign({ url: "http://x.live.test/a.m3u8", kind: "playlist", ref: "c", context: "{" }), (e) => e.code === "unavailable");
});
