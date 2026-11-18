// The batch resolve (backend b45b73e): POST /resolve/<id>?…&batch=1 answers {step, parallel, tickets}; every ticket goes to
// the portal from this device (all at once when `parallel`) and POST /resolve/step {step, answers} answers the next step or
// {stream}. Without a trial the backend makes it inside the resolve (tok → act → free, no 409). A resolve of the same title
// within FRESH_AGAIN_MS asks for a new CDN authorization (fresh=1). A backend without batch answers the classic envelope.
// Against a fake backend and a fake portal, as test/egress-v2.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const api = await import("../src/api.js");
const catalog = await import("../src/catalog.js");
const data = await import("../src/data.js");
const { itemRef, episodeRef } = await import("../src/refs.js");
const { beginCall } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";
const PORTAL_HOST = "https://cobgj.qw5ld24mj.com/";
const PORTAL = PORTAL_HOST + "portalCore/v3/";
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });
/** A batch ticket named `id`: its portal request carries its own headers and an opaque body. */
const TK = (id) => ({ id, method: "POST", url: PORTAL + id, headers: { "X-T": id }, body: "cipher-" + id });
const STEP = (step, ids, parallel = ids.length > 1) => ({ step, parallel, tickets: ids.map(TK) });
const STREAM = { stream: { url: "https://cdn.example/77.ts", qualities: ["1080p"] } };
const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; });

/** A device with a Bearer; `backend(path with query, init)` and `portal(url, init)` answer (undefined: a 404). */
async function device(backend, portal = (url) => res(200, "raw-" + url.slice(PORTAL.length))) {
  const seen = [];
  const k = installKino({ storage: { "o2:bearer": "bearer-token", "o2:mig": "1" }, routes: [(url, init) => {
    seen.push({ url, init: init || {} });
    if (url.startsWith(BACKEND)) return backend(url.slice(BACKEND.length), init || {});
    if (url.startsWith(PORTAL_HOST)) return portal(url, init || {});
    return undefined;
  }] });
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  api._resetRateLimit();
  api._resetEgress();
  data._resetMemory();
  catalog._resetResolveMemory();
  beginCall();
  k.seen = seen;
  return k;
}
const pathOf = (url) => url.slice(BACKEND.length).replace(/\?.*$/, "");
const paths = (k) => k.seen.map((r) => (r.url.startsWith(BACKEND) ? pathOf(r.url) : "PORTAL:" + r.url.slice(PORTAL.length)));
const bodyOf = (r) => { const b = r.init && r.init.body; if (b && typeof b === "object" && "json" in b) return b.json; try { return JSON.parse(b); } catch (_) { return null; } };
const steps = (k) => k.seen.filter((r) => r.url.startsWith(BACKEND + "/resolve/step")).map(bodyOf);

test("batch: [play, slb] go to the portal from this device at once, both answers in one step, then the stream", async () => {
  let open = 0, peak = 0;
  const k = await device(
    (p) => (p.startsWith("/resolve/77?") ? json(STEP("b1", ["play", "slb"])) : p === "/resolve/step" ? json(STREAM) : undefined),
    async (url) => {
      open++; peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return res(200, "raw-" + url.slice(PORTAL.length));
    },
  );
  const out = await catalog.resolve(itemRef("77", "1"));
  assert.equal(out.url, "https://cdn.example/77.ts");
  assert.equal(peak, 2, "both portal requests were in flight together");
  assert.match(k.seen[0].url, /\/resolve\/77\?batch=1$/, "a first resolve asks for batch, with the cached authorization");
  assert.deepEqual(paths(k), ["/resolve/77", "PORTAL:play", "PORTAL:slb", "/resolve/step"]);
  assert.deepEqual(steps(k), [{ step: "b1", answers: { play: { response: "raw-play" }, slb: { response: "raw-slb" } } }]);
  for (const r of k.seen.filter((x) => x.url.startsWith(PORTAL_HOST))) {
    assert.equal(r.init.cookies, false, "no cookies: the ticket brings its own headers");
    assert.equal(r.init.headers["X-T"], r.url.slice(PORTAL.length));
    assert.equal(r.init.body, "cipher-" + r.url.slice(PORTAL.length));
  }
});

test("batch without a trial: tok, act and free one at a time (no 409, no /trial/egress), then [play, slb], then the stream", async () => {
  const k = await device((p, init) => {
    if (p.startsWith("/resolve/77?")) return json(STEP("t1", ["tok"]));
    if (p !== "/resolve/step") return undefined;
    const s = bodyOf({ init }).step;
    return json(s === "t1" ? STEP("t2", ["act"]) : s === "t2" ? STEP("t3", ["free"]) : s === "t3" ? STEP("p1", ["play", "slb"]) : STREAM);
  });
  const out = await catalog.resolve(itemRef("77", "1"));
  assert.equal(out.url, "https://cdn.example/77.ts");
  assert.deepEqual(paths(k), [
    "/resolve/77", "PORTAL:tok", "/resolve/step", "PORTAL:act", "/resolve/step", "PORTAL:free", "/resolve/step",
    "PORTAL:play", "PORTAL:slb", "/resolve/step",
  ]);
  assert.deepEqual(steps(k).map((s) => Object.keys(s.answers)), [["tok"], ["act"], ["free"], ["play", "slb"]]);
});

test("batch with parallel false: the tickets go one after another, in the order given", async () => {
  let open = 0, peak = 0;
  const k = await device(
    (p) => (p.startsWith("/resolve/77?") ? json(STEP("b1", ["login", "play"], false)) : p === "/resolve/step" ? json(STREAM) : undefined),
    async (url) => {
      open++; peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return res(200, "raw-" + url.slice(PORTAL.length));
    },
  );
  await catalog.resolve(itemRef("77", "1"));
  assert.equal(peak, 1);
  assert.deepEqual(paths(k), ["/resolve/77", "PORTAL:login", "PORTAL:play", "/resolve/step"]);
});

test("a backend without batch answers the classic envelope: the classic flow runs ({step, response})", async () => {
  const k = await device((p, init) => {
    if (p.startsWith("/resolve/77?")) return json({ egress: { method: "POST", url: PORTAL + "c1", headers: {}, body: "cipher-c1" }, step: "s1" });
    if (p === "/resolve/step") return json(bodyOf({ init }).step === "s1" ? { egress: { method: "POST", url: PORTAL + "c2", headers: {}, body: "x" }, step: "s2" } : STREAM);
    return undefined;
  });
  const out = await catalog.resolve(itemRef("77", "1"));
  assert.equal(out.url, "https://cdn.example/77.ts");
  assert.deepEqual(paths(k), ["/resolve/77", "PORTAL:c1", "/resolve/step", "PORTAL:c2", "/resolve/step"]);
  assert.deepEqual(steps(k), [{ step: "s1", response: "raw-c1" }, { step: "s2", response: "raw-c2" }]);
});

test("the same title again within 5 min asks fresh=1 (a retry after the CDN refused it); another title, or later, does not", async () => {
  let t = realNow();
  Date.now = () => t;
  const k = await device((p) => (p.startsWith("/resolve/") && p !== "/resolve/step" ? json(STREAM) : undefined));
  const starts = () => k.seen.filter((r) => r.url.startsWith(BACKEND + "/resolve/")).map((r) => r.url.slice(BACKEND.length));
  await catalog.resolve(itemRef("77", "1"));
  t += 60_000; beginCall();
  await catalog.resolve(itemRef("77", "1"));
  t += 1000; beginCall();
  await catalog.resolve(itemRef("88", "1"));
  t += 5 * 60_000; beginCall();
  await catalog.resolve(itemRef("88", "1"));
  // An episode is its own title: another episode of the same series is not a retry.
  t += 1000; beginCall();
  await catalog.resolve(episodeRef("e1", "s1"));
  t += 1000; beginCall();
  await catalog.resolve(episodeRef("e2", "s1"));
  t += 1000; beginCall();
  await catalog.resolve(episodeRef("e1", "s1"));
  assert.deepEqual(starts(), [
    "/resolve/77?batch=1", "/resolve/77?batch=1&fresh=1", "/resolve/88?batch=1", "/resolve/88?batch=1",
    "/resolve/e1?series=s1&batch=1", "/resolve/e2?series=s1&batch=1", "/resolve/e1?series=s1&batch=1&fresh=1",
  ]);
});

test("a malformed batch step (a ticket without id or url) fails the resolve without asking the portal", async () => {
  const k = await device((p) => (p.startsWith("/resolve/77?") ? json({ step: "b1", parallel: true, tickets: [{ id: "play" }] }) : undefined));
  await assert.rejects(api.relayResolve("77", Date.now() + 17_000), /malformed batch step/);
  assert.deepEqual(paths(k), ["/resolve/77"]);
});

test("the anti-loop guard: a batch resolve stops after 10 steps", async () => {
  let n = 0;
  const k = await device((p) => (p.startsWith("/resolve/77?") || p === "/resolve/step" ? json(STEP("x" + ++n, ["play"])) : undefined));
  await assert.rejects(api.relayResolve("77", Date.now() + 60_000), /too many egress steps/);
  assert.equal(k.seen.filter((r) => r.url.startsWith(BACKEND + "/resolve/step")).length, 10);
});
