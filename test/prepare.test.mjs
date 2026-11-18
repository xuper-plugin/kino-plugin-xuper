// Kino's play ahead on a title page (app: PlayAhead, owner 2026-11-18): `prepare(ref)` readies the person's trial session
// and this device's CDN authorization (backend 7046b17: POST /resolve/prepare, then the batch steps through POST
// /resolve/step), never a resolve: no /resolve/<id>, no play ticket, no startPlayVOD. While the slbExpiresAt it was told
// lasts it asks nothing; a backend without the route is left alone for the rest of the runtime; a 429 and every failure
// are quiet (Kino ignores the answer). Against a fake backend and a fake portal, as test/resolve-batch.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import("../src/plugin.js");
const api = await import("../src/api.js");
const catalog = await import("../src/catalog.js");
const data = await import("../src/data.js");
const { itemRef, episodeRef, liveRef, mergedRef, catRef, colRef } = await import("../src/refs.js");
const { callSeq } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";
const PORTAL_HOST = "https://cobgj.qw5ld24mj.com/";
const PORTAL = PORTAL_HOST + "portalCore/v3/";
const H = 60 * 60_000;
const MOVIE = itemRef("77", "1");
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });
/** A batch ticket named `id`: its portal request (at `url`) carries its own headers and an opaque body. */
const TK = (id, url = PORTAL + id) => ({ id, method: "POST", url, headers: { "X-T": id }, body: "cipher-" + id });
const STEP = (step, ids, parallel = ids.length > 1) => ({ step, parallel, tickets: ids.map((id) => TK(id)) });
const READY = (slbExpiresAt) => ({ results: { ready: true, slbExpiresAt } });
const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; });

/**
 * A device (a new runtime) with Bearer `bearer` (null: none); `backend(path with query, init)` and `portal(url, init)`
 * answer (undefined: a 404). `k.seen` lists every request with its init and `at` (Date.now() when it was sent).
 */
async function device(backend, portal = (url) => res(200, "raw-" + url.slice(PORTAL.length)), { bearer = "bearer-token" } = {}) {
  const seen = [];
  const k = installKino({ storage: { "o2:mig": "1" }, routes: [(url, init) => {
    seen.push({ url, init: init || {}, at: Date.now() });
    if (url.startsWith(BACKEND)) return backend(url.slice(BACKEND.length), init || {});
    if (url.startsWith(PORTAL_HOST)) return portal(url, init || {});
    return undefined;
  }] });
  await api.clearBearer();
  if (bearer) k.kino.storage.set("o2:bearer", bearer);
  api._resetRateLimit();
  api._resetEgress();
  api._resetPrepare();
  data._resetMemory();
  catalog._resetResolveMemory();
  k.seen = seen;
  return k;
}
const pathOf = (url) => url.slice(BACKEND.length).replace(/\?.*$/, "");
const paths = (k) => k.seen.map((r) => (r.url.startsWith(BACKEND) ? pathOf(r.url) : "PORTAL:" + r.url.slice(PORTAL.length)));
const bodyOf = (r) => { const b = r.init && r.init.body; if (b && typeof b === "object" && "json" in b) return b.json; try { return JSON.parse(b); } catch (_) { return null; } };
const steps = (k) => k.seen.filter((r) => r.url.startsWith(BACKEND + "/resolve/step")).map(bodyOf);
const prepareLogs = (k) => k.logs.filter((l) => l.startsWith("prepare: "));

/** Never a resolve and never a play: the backend's /resolve sees only /resolve/prepare and /resolve/step, the portal no play. */
function neverPlays(k) {
  for (const r of k.seen) {
    if (r.url.startsWith(BACKEND + "/resolve")) assert.match(pathOf(r.url), /^\/resolve\/(prepare|step)$/, "a resolve: " + r.url);
    if (r.url.startsWith(PORTAL_HOST)) assert.ok(!/play/i.test(r.url), "a play went to the portal: " + r.url);
  }
}

/** The trial flow of test/egress-v2.test.mjs: POST /trial/egress, then three portal steps through POST /egress/step. */
function trialRoutes(n, expiresAt) {
  const T = (i) => ({ egress: { method: "POST", url: PORTAL + "trial" + i, headers: {}, body: "cipher-trial" + i }, step: "ts" + i });
  return (p, init) => {
    if (p === "/trial/egress") { n.trials = (n.trials || 0) + 1; return json(T(1)); }
    if (p !== "/egress/step") return undefined;
    const s = bodyOf({ init }).step;
    return json(s === "ts1" ? T(2) : s === "ts2" ? T(3) : { results: { ready: true, expiresAt: expiresAt() } });
  };
}

// ── what the backend asks ──

test("all ready already: one POST /resolve/prepare with the Bearer (no content id, no batch, no fresh), no portal call", async () => {
  const k = await device((p) => (p === "/resolve/prepare" ? json(READY(Date.now() + 2.5 * H)) : undefined));
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.deepEqual(paths(k), ["/resolve/prepare"]);
  const start = k.seen[0];
  assert.equal(start.url, BACKEND + "/resolve/prepare");
  assert.equal(start.init.method, "POST");
  assert.equal(start.init.headers.Authorization, "Bearer bearer-token");
  assert.equal(start.init.timeoutMs, 8000, "a backend hop carries at most 8 s");
  assert.deepEqual(prepareLogs(k), ["prepare: ready, 150 min of CDN authorization left"]);
});

test("no trial yet: tok, act and free one at a time through POST /resolve/step, then ready (an episode's ref)", async () => {
  const k = await device((p, init) => {
    if (p === "/resolve/prepare") return json(STEP("t1", ["tok"]));
    if (p !== "/resolve/step") return undefined;
    const s = bodyOf({ init }).step;
    return json(s === "t1" ? STEP("t2", ["act"]) : s === "t2" ? STEP("t3", ["free"]) : READY(Date.now() + 2 * H));
  });
  assert.equal(await P.prepare(episodeRef("e1", "s1")), "ready");
  assert.deepEqual(paths(k), ["/resolve/prepare", "PORTAL:tok", "/resolve/step", "PORTAL:act", "/resolve/step", "PORTAL:free", "/resolve/step"]);
  assert.deepEqual(steps(k), [
    { step: "t1", answers: { tok: { response: "raw-tok" } } },
    { step: "t2", answers: { act: { response: "raw-act" } } },
    { step: "t3", answers: { free: { response: "raw-free" } } },
  ]);
  for (const r of k.seen.filter((x) => x.url.startsWith(PORTAL_HOST))) {
    assert.equal(r.init.cookies, false, "no cookies: the ticket brings its own headers");
    assert.equal(r.init.headers["X-T"], r.url.slice(PORTAL.length));
    assert.equal(r.init.body, "cipher-" + r.url.slice(PORTAL.length));
    assert.equal(r.init.timeoutMs, 10_000, "a portal hop carries at most 10 s");
  }
  neverPlays(k);
});

test("no valid CDN authorization: the slb ticket, one step, then ready; in account mode the login goes in the same step", async () => {
  let k = await device((p) => (p === "/resolve/prepare" ? json(STEP("s1", ["slb"])) : p === "/resolve/step" ? json(READY(Date.now() + 2 * H)) : undefined));
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.deepEqual(paths(k), ["/resolve/prepare", "PORTAL:slb", "/resolve/step"]);
  assert.deepEqual(steps(k), [{ step: "s1", answers: { slb: { response: "raw-slb" } } }]);
  neverPlays(k);

  k = await device((p) => (p === "/resolve/prepare" ? json(STEP("l1", ["login", "slb"])) : p === "/resolve/step" ? json(READY(Date.now() + 2 * H)) : undefined));
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.deepEqual(paths(k), ["/resolve/prepare", "PORTAL:login", "PORTAL:slb", "/resolve/step"]);
  assert.deepEqual(steps(k), [{ step: "l1", answers: { login: { response: "raw-login" }, slb: { response: "raw-slb" } } }]);
  neverPlays(k);
});

test("a prepare is not a play: the resolve that follows is the title's plain first one (batch=1, never fresh=1)", async () => {
  const k = await device((p) => {
    if (p === "/resolve/prepare") return json(READY(Date.now() + 2 * H));
    if (p.startsWith("/resolve/77?")) return json({ stream: { url: "https://cdn.example/77.ts" } });
    return undefined;
  });
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.equal((await P.resolve(MOVIE)).url, "https://cdn.example/77.ts");
  assert.deepEqual(k.seen.map((r) => r.url.slice(BACKEND.length)), ["/resolve/prepare", "/resolve/77?batch=1"]);
});

// ── what it remembers ──

test("while the slbExpiresAt it was told lasts a prepare asks nothing, for any title; once it ends, or under another Bearer, it asks again", async () => {
  let t = realNow();
  Date.now = () => t;
  let starts = 0;
  const k = await device((p) => (p === "/resolve/prepare" ? (starts++, json(READY(t + 2 * H))) : undefined));
  const until = t + 2 * H;
  assert.equal(await P.prepare(MOVIE), "ready");
  t += H;
  assert.equal(await P.prepare(episodeRef("e9", "s9")), "ready", "another title: the same authorization");
  t = until - 1;
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.equal(starts, 1, "nothing asked while the slb lasts");
  assert.equal(k.seen.length, 1);
  assert.ok(prepareLogs(k).includes("prepare: still ready for 60 min: nothing asked"), prepareLogs(k).join(" | "));
  t = until;
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.equal(starts, 2, "the slb ended: asked again");
  // Desconectar, then another sign-in: what the old Bearer readied is not this one's.
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-2");
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.equal(starts, 3);
  assert.equal(k.seen[2].init.headers.Authorization, "Bearer bearer-2");
});

test("a ready answer without a usable slbExpiresAt (none, past, 30 days ahead) is not remembered; one in seconds is", async () => {
  for (const exp of [undefined, Date.now() - 1000, Date.now() + 30 * 24 * H]) {
    let starts = 0;
    await device((p) => (p === "/resolve/prepare" ? (starts++, json({ results: { ready: true, slbExpiresAt: exp } })) : undefined));
    assert.equal(await P.prepare(MOVIE), "ready");
    assert.equal(await P.prepare(MOVIE), "ready");
    assert.equal(starts, 2, "asked again after slbExpiresAt " + exp);
  }
  let starts = 0;
  await device((p) => (p === "/resolve/prepare" ? (starts++, json(READY(Math.floor((Date.now() + 2 * H) / 1000)))) : undefined));
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.equal(starts, 1, "seconds: remembered as ms");
});

test("a backend without /resolve/prepare (404 'Not Found', or 405): skip, and nothing asked again in that runtime", async () => {
  for (const answer of [json({ detail: "Not Found" }, 404), json({ detail: "Method Not Allowed" }, 405)]) {
    const k = await device((p) => (p === "/resolve/prepare" ? answer : undefined));
    assert.equal(await P.prepare(MOVIE), "skip");
    assert.equal(await P.prepare(episodeRef("e1", "s1")), "skip");
    assert.deepEqual(paths(k), ["/resolve/prepare"], "asked once");
    api._resetEgress();   // a new runtime asks once more
    assert.equal(await P.prepare(MOVIE), "skip");
    assert.equal(k.seen.length, 2);
  }
  // A 404 with no JSON detail (a proxy's page) is unsure: skipped this once, not latched.
  const k = await device((p) => (p === "/resolve/prepare" ? res(404, "<html>nope</html>") : undefined));
  assert.equal(await P.prepare(MOVIE), "skip");
  assert.equal(await P.prepare(MOVIE), "skip");
  assert.equal(k.seen.length, 2);
});

// ── quiet ──

test("a 429 is quiet: 'failed' with no throw and no sentence; prepare then waits with no request, and the person's resolve is not held", async () => {
  const k = await device((p) => {
    if (p === "/resolve/prepare") return res(429, JSON.stringify({ detail: "rate_limited" }));
    if (p.startsWith("/resolve/77?")) return json({ stream: { url: "https://cdn.example/77.ts" } });
    return undefined;
  });
  assert.equal(await P.prepare(MOVIE), "failed");
  assert.ok(api.limitedUntil("prepare") > Date.now(), "prepare waits");
  assert.equal(api.limitedUntil("resolve"), 0, "its own family: the resolve does not");
  assert.equal(await P.prepare(MOVIE), "failed");
  assert.deepEqual(paths(k), ["/resolve/prepare"], "inside the wait: no request");
  assert.equal((await P.resolve(MOVIE)).url, "https://cdn.example/77.ts");
  assert.deepEqual(paths(k), ["/resolve/prepare", "/resolve/77"]);
});

test("it never throws: a network error, a 502, a malformed step, an answer without results or not ready: 'failed', one log line each", async () => {
  const answers = [
    () => new Error("network down"),
    () => json({ detail: "upstream_error" }, 502),
    () => json({ step: "b1", parallel: true, tickets: [{ id: "slb" }] }),
    () => json({ ok: 1 }),
    () => json({ results: { ready: false } }),
  ];
  for (const a of answers) {
    const k = await device((p) => (p === "/resolve/prepare" ? a() : undefined));
    assert.equal(await P.prepare(MOVIE), "failed");
    assert.equal(prepareLogs(k).length, 1, prepareLogs(k).join(" | "));
    assert.ok(!k.seen.some((r) => r.url.startsWith(PORTAL_HOST)), "nothing went to the portal");
  }
});

test("a 401: 'failed', and the refused Bearer is dropped for the screen's sign-in, as on every call; then nothing is asked", async () => {
  const k = await device((p) => (p === "/resolve/prepare" ? json({ detail: "no_session" }, 401) : undefined));
  assert.equal(await P.prepare(MOVIE), "failed");
  assert.equal(k.kino.storage.get("o2:bearer"), null);
  assert.equal(api.reloginPending(), true);
  assert.equal(await P.prepare(MOVIE), "skip");
  assert.equal(k.seen.length, 1);
});

// ── what it never does ──

test("a live channel, a merged one, a section, a column or anything else: nothing asked", async () => {
  const k = await device(() => json(READY(Date.now() + 2 * H)));
  const refs = [
    liveRef("supertv", "http://x.example/1.m3u8"), mergedRef(["L:supertv:a", "L:premiumtv:b"]), "supertv_abc12", catRef("pelicula"),
    colRef("85163"), "v:", "e:", "", null, undefined, 42, {}, "zzz:1",
  ];
  for (const ref of refs) assert.equal(await P.prepare(ref), "skip", String(ref));
  assert.equal(k.seen.length, 0);
});

test("no Bearer: nothing asked and never a sign-in (that needs the person's screen)", async () => {
  const k = await device(() => json(READY(Date.now() + 2 * H)), undefined, { bearer: null });
  let asked = 0;
  k.kino.identity = { telegram: async () => { asked++; return {}; } };
  assert.equal(await P.prepare(MOVIE), "skip");
  assert.equal(await P.prepare(episodeRef("e1", "s1")), "skip");
  assert.equal(k.seen.length, 0, "no /session/challenge, no /resolve/prepare");
  assert.equal(asked, 0);
  assert.equal(k.kino.storage.get("o2:bearer"), null);
});

test("never a play: a step that asks for one (its id, or a startPlayVOD under another id) or a classic ticket sends nothing to the portal, and prepare stops for the runtime", async () => {
  const firsts = [
    STEP("p1", ["slb", "play"]),
    { step: "p1", parallel: true, tickets: [TK("slb"), TK("x2", PORTAL_HOST + "portalCore/v10/startPlayVOD")] },
    { egress: { method: "POST", url: PORTAL + "c1", headers: {}, body: "cipher-c1" }, step: "c1" },   // an older backend's POST /resolve/{content_id}
  ];
  for (const first of firsts) {
    const k = await device((p) => (p === "/resolve/prepare" ? json(first) : p === "/resolve/step" ? json(READY(Date.now() + 2 * H)) : undefined));
    assert.equal(await P.prepare(MOVIE), "skip");
    assert.deepEqual(paths(k), ["/resolve/prepare"], "nothing went to the portal");
    assert.equal(await P.prepare(MOVIE), "skip");
    assert.equal(k.seen.length, 1, "no prepare for the rest of the runtime");
  }
  // A later step: the slb goes, the play never does.
  const k = await device((p, init) => {
    if (p === "/resolve/prepare") return json(STEP("s1", ["slb"]));
    if (p === "/resolve/step") return json(bodyOf({ init }).step === "s1" ? STEP("p2", ["play"]) : READY(Date.now() + 2 * H));
    return undefined;
  });
  assert.equal(await P.prepare(MOVIE), "skip");
  assert.deepEqual(paths(k), ["/resolve/prepare", "PORTAL:slb", "/resolve/step"]);
  neverPlays(k);
});

// ── its budget ──

test("under 12 s: every hop is cut to what is left (a backend one at most 8 s, a portal one 10 s) and none starts with under 0.8 s left", async () => {
  let t = realNow();
  Date.now = () => t;
  let k = await device((p) => {
    if (p === "/resolve/prepare") { t += 3000; return json(STEP("s1", ["slb"])); }
    if (p === "/resolve/step") { t += 2000; return json(READY(t + 2 * H)); }
    return undefined;
  }, () => { t += 6000; return res(200, "raw-slb"); });
  let t0 = t;
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.deepEqual(k.seen.map((r) => r.at - t0), [0, 3000, 9000]);
  assert.deepEqual(k.seen.map((r) => r.init.timeoutMs), [8000, 9000, 3000]);

  // The slb answers with 0.5 s left: the step is never sent, the call fails by 12 s with the plugin's own error.
  k = await device((p) => (p === "/resolve/prepare" ? (t += 3000, json(STEP("s1", ["slb"]))) : p === "/resolve/step" ? json(READY(t + 2 * H)) : undefined),
    () => { t += 8500; return res(200, "raw-slb"); });
  t0 = t;
  assert.equal(await P.prepare(MOVIE), "failed");
  assert.deepEqual(paths(k), ["/resolve/prepare", "PORTAL:slb"]);
  assert.ok(prepareLogs(k).some((l) => /prepare flow out of time/.test(l)), prepareLogs(k).join(" | "));
  for (const r of k.seen) assert.ok(r.at - t0 + r.init.timeoutMs <= catalog.PREPARE_BUDGET_MS, r.url + " could end past 12 s");
});

test("a trial that drops mid-prepare (409 on a step): one trial flow, cut to prepare's 12 s (not the resolve's 16 s), then the prepare anew", async () => {
  let t = realNow();
  Date.now = () => t;
  const n = {};
  let starts = 0;
  const trial = trialRoutes(n, () => t + 2 * H);
  const k = await device((p, init) => {
    if (p === "/resolve/prepare") { t += 1000; return json(++starts === 1 ? STEP("s1", ["slb"]) : READY(t + 2 * H)); }
    if (p === "/resolve/step") { t += 3000; return json({ detail: "trial_needed" }, 409); }
    t += 200;
    return trial(p, init);
  }, (url) => { t += 1000; return res(200, "raw-" + url.slice(PORTAL.length)); });
  const t0 = t;
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.equal(n.trials, 1);
  assert.deepEqual(paths(k), [
    "/resolve/prepare", "PORTAL:slb", "/resolve/step",
    "/trial/egress", "PORTAL:trial1", "/egress/step", "PORTAL:trial2", "/egress/step", "PORTAL:trial3", "/egress/step",
    "/resolve/prepare",
  ]);
  const trialStart = k.seen[3];
  assert.equal(trialStart.at - t0, 5000);
  assert.equal(trialStart.init.timeoutMs, 7000, "what is left of prepare's 12 s (the trial's own end would be 10 s away)");
  for (const r of k.seen) assert.ok(r.at - t0 + r.init.timeoutMs <= catalog.PREPARE_BUDGET_MS, r.url + " could end past 12 s");
  neverPlays(k);
});

test("a 409 on prepare's own start (authed's repeat, not a step): the trial is cut to prepare's 12 s too, then the start once more", async () => {
  let t = realNow();
  Date.now = () => t;
  const n = {};
  let starts = 0;
  const trial = trialRoutes(n, () => t + 2 * H);
  const k = await device((p, init) => {
    if (p === "/resolve/prepare") {
      // A slow first start: from 7 s on, the trial left to itself would run to 16 s of the call, past Kino's 15 s.
      if (++starts === 1) { t += 7000; return json({ detail: "trial_needed" }, 409); }
      t += 500;
      return json(READY(t + 2 * H));
    }
    t += 200;
    return trial(p, init);
  }, (url) => { t += 1000; return res(200, "raw-" + url.slice(PORTAL.length)); });
  const t0 = t;
  assert.equal(await P.prepare(MOVIE), "ready");
  assert.equal(n.trials, 1);
  assert.deepEqual(paths(k), [
    "/resolve/prepare",
    "/trial/egress", "PORTAL:trial1", "/egress/step", "PORTAL:trial2", "/egress/step", "PORTAL:trial3", "/egress/step",
    "/resolve/prepare",
  ]);
  const trialStart = k.seen[1];
  assert.equal(trialStart.at - t0, 7000);
  assert.equal(trialStart.init.timeoutMs, 5000, "what is left of prepare's 12 s (the trial's own end would be 16 s into the call)");
  for (const r of k.seen) assert.ok(r.at - t0 + r.init.timeoutMs <= catalog.PREPARE_BUDGET_MS, r.url + " could end past 12 s");
  neverPlays(k);
});

// ── wiring ──

test("the bundle exports prepare; the export starts a call of its own (beginCall) and never throws, even with every fetch failing", async () => {
  const bundle = await import("../plugin.js");
  assert.equal(typeof bundle.prepare, "function");
  assert.equal(await bundle.prepare(liveRef("supertv", "x")), "skip", "the bundle carries this prepare");
  const k = installKino({ noFetch: true, storage: { "o2:mig": "1" } });
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  api._resetRateLimit();
  api._resetEgress();
  api._resetPrepare();
  const before = callSeq();
  assert.equal(await P.prepare(MOVIE), "failed");
  assert.ok(callSeq() >= before + 1, "prepare does not call beginCall()");
});

test("the manifest never declares resolveAhead: a resolve nobody plays may spend a portal free play; prepare readies the rest", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
  assert.ok(!("resolveAhead" in m));
});
