// A VOD resolve ends inside Kino's 20 s (app: PluginContentSource.RESOLVE_TIMEOUT_MS) with the plugin's own error, whatever
// hop stalls. A call Kino times out is the worst outcome: Kino discards the runtime (the next call opens a cold one),
// counts it toward "No responde" (three in a row switch the plugin off) and the masnew fallback never runs. The relay
// (src/api.js relayResolve) runs under the call's deadline (src/catalog.js RESOLVE_BUDGET_MS, 17 s), each backend hop in
// at most 8 s and each portal hop in at most 10 s (they were 20 s and 25 s); the fallback starts only with
// VOD_FALLBACK_MIN_MS (6 s) left. On a virtual clock (test/helpers/seed-world.mjs: Date.now replaced, the real-3DES
// masnew portal) with the Xuper backend and the relay's portal scripted as in test/egress-v2.test.mjs: a request that
// hangs fails at its own timeoutMs with Kino's "timeout" error, the clock moved by that much.
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, BEARER } from "./helpers/seed-world.mjs";
import { res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import("../src/plugin.js");
const api = await import("../src/api.js");
const catalog = await import("../src/catalog.js");
const data = await import("../src/data.js");
const xmod = await import("../src/sources/xuper.js");
const seeds = await import("../src/seeds.js");
const { itemRef, episodeRef } = await import("../src/refs.js");
const { beginCall } = await import("../src/flight.js");

const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; });

const KINO_RESOLVE_MS = 20_000;   // app: PluginContentSource.RESOLVE_TIMEOUT_MS
const H = 60 * 60_000;
const BACKEND = "https://x.xkplugins.site";
const RELAY = "https://cobgj.qw5ld24mj.com/portalCore/v3/x";   // the portal the relay's tickets name
const SN = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";                  // a stored device sn (the masnew own session)
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });
const TICKET = (n) => ({ egress: { method: "POST", url: RELAY + n, headers: {}, body: "cipher-" + n }, step: "s" + n });
const STREAM = { stream: { url: "https://cdn.example/v.ts" } };
/** The answer `body` (JSON, `status`) `ms` after the request started. */
const ok = (ms, body, status = 200) => ({ ms, res: json(body, status) });
/** A portal answer (the relay posts its raw text to the step) `ms` after the request started. */
const raw = (ms) => ({ ms, res: res(200, "raw") });
/** No answer: Kino fails the request at its timeoutMs. */
const HANG = { hang: true };

/**
 * A device with a Bearer on a virtual clock: the masnew world (its own anonymous session and the portal secret stored,
 * so the fallback needs no backend), and the Xuper backend and the relay's portal answering `script(path, n)` with
 * `ok(…)`, `raw(…)` or HANG (undefined: a 404). `path`: the backend path without its query, or "RELAY<n>" for the n-th
 * ticket's portal call; `n` counts that path. `d.seen`: those requests with `at` (ms since the call started) and
 * `timeoutMs`; `d.timeouts`: the errors the hung ones failed with.
 */
async function device(script) {
  const d = { seen: [], timeouts: [], t0: 0, w: null };
  const counts = {};
  const route = (url, init) => {
    let path;
    if (url.startsWith(BACKEND)) path = url.slice(BACKEND.length).replace(/\?.*$/, "");
    else if (url.startsWith(RELAY)) path = "RELAY" + url.slice(RELAY.length);
    else return undefined;
    counts[path] = (counts[path] || 0) + 1;
    d.seen.push({ path, url, at: d.w.clock.now - d.t0, timeoutMs: init.timeoutMs });
    const a = script(path, counts[path]) || { ms: 10, res: res(404, "") };
    const limit = Number(init.timeoutMs) || 30_000;
    if (a.hang || a.ms >= limit) {
      d.w.advance(limit);
      const e = Object.assign(new Error("timeout"), { code: "timeout" });
      d.timeouts.push(e);
      return e;
    }
    d.w.advance(a.ms);
    return a.res;
  };
  d.w = await world({ sn: SN, own: "OWNTOK-SECRET-0", routes: [route] });
  await api.clearBearer();
  d.w.kino.storage.set("o2:bearer", BEARER);
  api._resetRateLimit();
  api._resetEgress();
  data._resetMemory();
  xmod._resetSession();
  seeds._newRuntime();
  d.paths = () => d.seen.map((r) => r.path);
  return d;
}

/** Kino's `resolve(ref)` (src/plugin.js: the call starts now) → `{ out }` or `{ err }`, and `ms`, the time it held. */
async function resolveTimed(d, ref) {
  d.t0 = d.w.clock.now;
  try { const out = await P.resolve(ref); return { out, ms: d.w.clock.now - d.t0 }; }
  catch (err) { return { err, ms: d.w.clock.now - d.t0 }; }
}

test("a healthy relay: the start and each step carry 8 s, each portal call 10 s (they were 20 s and 25 s), and the stream comes back", async () => {
  const d = await device((p, n) => {
    if (p === "/resolve/77") return ok(300, TICKET(1));
    if (p === "/resolve/step") return ok(300, n < 3 ? TICKET(n + 1) : STREAM);
    if (p.startsWith("RELAY")) return raw(500);
    return undefined;
  });
  const { out, ms } = await resolveTimed(d, itemRef("77", "1"));
  assert.equal(out.url, "https://cdn.example/v.ts");
  assert.equal(ms, 300 + 3 * (500 + 300));
  assert.deepEqual(d.paths(), ["/resolve/77", "RELAY1", "/resolve/step", "RELAY2", "/resolve/step", "RELAY3", "/resolve/step"]);
  assert.deepEqual(d.seen.map((r) => r.timeoutMs), [8000, 10_000, 8000, 10_000, 8000, 10_000, 8000]);
});

test("a stalled hop fails the call at its own cap with the plugin's error, well inside Kino's 20 s: the backend's start at 8 s, a portal call at 10 s", async () => {
  // the backend's start hangs (it had rawBackend's 20 s: Kino timed the call out first)
  let d = await device((p) => (p === "/resolve/e1" ? HANG : undefined));
  let r = await resolveTimed(d, episodeRef("e1", "s1"));
  assert.equal(r.err, d.timeouts[0], "the hop's own error, thrown by the plugin");
  assert.equal(r.ms, 8000);
  assert.match(d.seen[0].url, /\/resolve\/e1\?series=s1&batch=1$/);
  assert.deepEqual(d.paths(), ["/resolve/e1"], "an episode has no fallback: nothing else is asked");

  // the relay's first portal call hangs (it had 25 s)
  d = await device((p) => (p === "/resolve/e1" ? ok(300, TICKET(1)) : p === "RELAY1" ? HANG : undefined));
  r = await resolveTimed(d, episodeRef("e1", "s1"));
  assert.equal(r.err, d.timeouts[0]);
  assert.equal(r.err.code, "timeout");
  assert.equal(r.ms, 300 + 10_000);
  assert.ok(r.ms < KINO_RESOLVE_MS);
  assert.deepEqual(d.paths(), ["/resolve/e1", "RELAY1"]);
  assert.equal(d.seen[1].timeoutMs, 10_000);
});

test("slow hops, each inside its cap: every hop is cut to what is left of the 17 s and none starts with under 0.8 s left; the call fails by 17 s with the plugin's own error", async () => {
  // Before the deadline the last step went out too (20 s) and answered at 21.8 s, past Kino's 20 s.
  const d = await device((p, n) => {
    if (p === "/resolve/e1") return ok(3000, TICKET(1));
    if (p === "RELAY1") return raw(6000);
    if (p === "/resolve/step") return n === 1 ? ok(4000, TICKET(2)) : ok(5000, STREAM);
    if (p === "RELAY2") return raw(3800);
    return undefined;
  });
  const { err, ms } = await resolveTimed(d, episodeRef("e1", "s1"));
  assert.ok(err, "the plugin throws");
  assert.equal(err.code, "unavailable");
  assert.match(err.message, /resolve flow out of time/);
  assert.equal(ms, 16_800);
  assert.deepEqual(d.paths(), ["/resolve/e1", "RELAY1", "/resolve/step", "RELAY2"], "the second step (200 ms left) is never sent");
  assert.deepEqual(d.seen.map((r) => r.at), [0, 3000, 9000, 13_000]);
  assert.deepEqual(d.seen.map((r) => r.timeoutMs), [8000, 10_000, 8000, 4000], "RELAY2 gets the 4 s left, not 10 s");
  for (const r of d.seen) assert.ok(r.at + r.timeoutMs <= catalog.RESOLVE_BUDGET_MS, r.path + " could end past the deadline");
});

test("a movie whose relay stalls with 6.7 s left: the masnew fallback runs inside the deadline and plays", async () => {
  const d = await device((p) => {
    if (p === "/resolve/77") return ok(300, TICKET(1));
    if (p === "RELAY1") return HANG;
    if (p === "/item/egress") return ok(300, { results: { detail: { name: "Pelicula Uno" }, related: [] } });
    return undefined;
  });
  const { out, ms } = await resolveTimed(d, itemRef("77", "1"));
  assert.ok(out && out.url.endsWith("/vod/t1_media.mp4"), "the masnew stream");
  assert.deepEqual(d.paths(), ["/resolve/77", "RELAY1", "/item/egress"]);
  const lookup = d.seen[2];
  assert.equal(lookup.at, 10_300);
  assert.equal(lookup.timeoutMs, catalog.RESOLVE_BUDGET_MS - 10_300, "the title lookup ends by the deadline too");
  assert.equal(d.w.count("v3/searchByName"), 1);
  assert.equal(d.w.count("v10/startPlayVOD"), 1);
  assert.ok(ms <= catalog.RESOLVE_BUDGET_MS, "held " + ms + " ms");
  assert.ok(!d.w.logs.some((l) => /no time for the masnew fallback/.test(l)));
});

test("a movie whose relay stalls with 5.5 s left: no fallback; the relay's own error at once, as when the fallback finds no match", async () => {
  const d = await device((p, n) => {
    if (p === "/resolve/77") return ok(500, TICKET(1));
    if (p === "RELAY1") return raw(500);
    if (p === "/resolve/step") return n === 1 ? ok(500, TICKET(2)) : ok(300, STREAM);
    if (p === "RELAY2") return HANG;
    if (p === "/item/egress") return ok(300, { results: { detail: { name: "Pelicula Uno" }, related: [] } });
    return undefined;
  });
  const { err, ms } = await resolveTimed(d, itemRef("77", "1"));
  assert.equal(err, d.timeouts[0], "the very error the relay failed with");
  assert.equal(ms, 1500 + 10_000);
  assert.ok(catalog.RESOLVE_BUDGET_MS - ms < catalog.VOD_FALLBACK_MIN_MS);
  assert.deepEqual(d.paths(), ["/resolve/77", "RELAY1", "/resolve/step", "RELAY2"], "no title lookup");
  assert.equal(d.w.portal.length, 0, "no masnew call");
  assert.ok(d.w.logs.some((l) => /relay failed with 5500 ms left: no time for the masnew fallback/.test(l)));
});

test("a skipped fallback keeps the relay's own sentence for the person (ES/EN): a trial that could not be prepared in time reads so", async () => {
  // The 409 comes at 2 s; the trial's start hangs until its own deadline (10 s later): 5 s are left, under 6 s.
  for (const lang of ["es", "en"]) {
    const d = await device((p) => {
      if (p === "/resolve/77") return ok(2000, { detail: "trial_needed" }, 409);
      if (p === "/trial/egress") return HANG;
      if (p === "/item/egress") return ok(300, { results: { detail: { name: "Pelicula Uno" }, related: [] } });
      return undefined;
    });
    d.w.kino.lang = lang;
    const { err, ms } = await resolveTimed(d, itemRef("77", "1"));
    assert.ok(err, "no masnew stream: the fallback was not started");
    assert.equal(ms, 12_000);
    assert.equal(err.userMessage, api.trialFailedText(lang));
    assert.equal(err.userMessage, lang === "en" ? "Could not prepare your Xuper session. Try again in a moment." : "No se pudo preparar tu sesión de Xuper. Inténtalo de nuevo en un momento.");
    assert.deepEqual(d.paths(), ["/resolve/77", "/trial/egress"], "no title lookup");
    assert.equal(d.w.portal.length, 0, "no masnew call");
  }
});

test("409 trial_needed: the repeat after the trial gets only what is left of the 17 s, not the first attempt's 8 s, so a stall there still ends inside Kino's 20 s", async () => {
  // The repeat reused the timeout computed before the trial: 8 s from 12.5 s would end at 20.5 s (20 s: 32.5 s).
  const d = await device((p, n) => {
    if (p === "/resolve/e1") return n === 1 ? ok(3000, { detail: "trial_needed" }, 409) : HANG;
    if (p === "/trial/egress") return ok(9500, { results: { ready: true, expiresAt: Date.now() + 2 * H } });
    return undefined;
  });
  const { err, ms } = await resolveTimed(d, episodeRef("e1", "s1"));
  assert.deepEqual(d.paths(), ["/resolve/e1", "/trial/egress", "/resolve/e1"]);
  assert.deepEqual(d.seen.map((r) => r.at), [0, 3000, 12_500]);
  assert.equal(d.seen[2].timeoutMs, catalog.RESOLVE_BUDGET_MS - 12_500);
  assert.equal(err, d.timeouts[0], "the repeat's own error");
  assert.equal(ms, catalog.RESOLVE_BUDGET_MS);
  assert.ok(api.trialValid(), "the trial itself is ready for the next call");
});

test("without a deadline nothing changes: Kino's detail page (episodes) keeps rawBackend's 20 s per backend hop and 8 s per portal call", async () => {
  const d = await device((p) => {
    if (p === "/item/egress") return ok(300, TICKET(1));
    if (p === "/egress/step") return ok(300, { results: { detail: { name: "Serie", simpleProgramList: [{ contentId: "e1", name: "Uno" }] }, related: [] } });
    if (p === "RELAY1") return raw(300);
    return undefined;
  });
  beginCall();
  const out = await catalog.episodes(itemRef("5", "0"));
  assert.equal(out.episodes.length, 1);
  assert.deepEqual(d.paths(), ["/item/egress", "RELAY1", "/egress/step"]);
  assert.deepEqual(d.seen.map((r) => r.timeoutMs), [20_000, 8000, 20_000]);
});
