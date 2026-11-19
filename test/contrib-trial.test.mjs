// The trial contribution (backend f69e68d): POST /trial/egress?contrib=1 runs the classic three-step trial flow on a
// made-up device the backend pools for accounts blocked by region. Its answers (contributed, pool_full, region), 409
// contrib_not_needed, 429, an older backend, the switch, the 3 h window, and afterHome's one contribution per Home.
// Against a fake backend and a fake portal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const api = await import("../src/api.js");
const C = await import("../src/seedContrib.js");
const { beginCall, callFor } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";
const PORTAL_HOST = "https://cobgj.qw5ld24mj.com/";
const PORTAL = PORTAL_HOST + "portalCore/v3/x";
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });
const TICKET = (n) => ({ egress: { method: "POST", url: PORTAL + n, headers: { Cookie: "d=1" }, body: "cipher-" + n }, step: "s" + n });
const bodyOf = (init) => { const b = init && init.body; if (b && typeof b === "object" && "json" in b) return b.json; try { return JSON.parse(b); } catch (_) { return null; } };
const H = 3600_000;

/** A device with a Bearer and the given settings; `backend(path, init)` answers (undefined: 404 with no detail). */
async function device(backend, { settings = {}, storage = {}, bearer = true } = {}) {
  const seen = [];
  const k = installKino({ storage: { "o2:mig": "1", ...storage }, routes: [(url, init) => {
    seen.push({ url, init: init || {} });
    if (url.startsWith(BACKEND)) return backend(url.slice(BACKEND.length), init || {});
    if (url.startsWith(PORTAL_HOST)) return res(200, "raw-" + url.slice(-1));
    return undefined;
  }] });
  await api.clearBearer();
  if (bearer) k.kino.storage.set("o2:bearer", "bearer-token");
  for (const [key, v] of Object.entries(storage)) k.kino.storage.set(key, v);
  k.kino.config = { get: (key) => settings[key] };
  api._resetRateLimit();
  api._resetEgress();
  beginCall(); callFor("home");
  k.seen = seen;
  k.paths = () => seen.map((r) => (r.url.startsWith(BACKEND) ? r.url.slice(BACKEND.length) : "PORTAL"));
  return k;
}

/** The contrib flow: three classic steps, then `final` (the backend's results). */
const contribRoutes = (final = { ready: true, contributed: true }) => (p, init) => {
  if (p === "/trial/egress?contrib=1" && init.method === "POST") return json(TICKET(1));
  const step = p === "/egress/step" ? bodyOf(init).step : "";
  if (step === "s1") return json(TICKET(2));
  if (step === "s2") return json(TICKET(3));
  if (step === "s3") return json({ results: final });
  return undefined;
};
const FLOW = ["/trial/egress?contrib=1", "PORTAL", "/egress/step", "PORTAL", "/egress/step", "PORTAL", "/egress/step"];

test("contributed: the three classic steps from this device with the Bearer, then the 3 h window is stamped", async () => {
  const k = await device(contribRoutes());
  const before = Date.now();
  assert.equal(await C.maybeContributeTrial(), true);
  assert.deepEqual(k.paths(), FLOW);
  assert.equal(k.seen[0].init.headers.Authorization, "Bearer bearer-token");
  assert.equal(k.seen[0].init.headers["X-Plugin-Version"], (await import("../src/config.js")).PLUGIN_VERSION, "every backend call names the version");
  assert.equal(k.seen[0].init.body, undefined, "the start carries no body");
  assert.deepEqual(bodyOf(k.seen[2].init), { step: "s1", response: "raw-1" });
  assert.ok(Number(k.kino.storage.get(C.TRIAL_AT_KEY)) >= before);
  assert.equal(k.kino.storage.get(api.TRIAL_KEY), null, "never the person's own trial");
  assert.ok(k.logs.includes("seed_contrib trial_done ok=1"));
});

test("pool_full: answered at once, no portal, not contributed, window stamped", async () => {
  const k = await device((p) => (p === "/trial/egress?contrib=1" ? json({ results: { ready: true, contributed: false, reason: "pool_full" } }) : undefined));
  assert.equal(await C.maybeContributeTrial(), false);
  assert.deepEqual(k.paths(), ["/trial/egress?contrib=1"]);
  assert.ok(Number(k.kino.storage.get(C.TRIAL_AT_KEY)) || null);
  assert.ok(k.logs.includes("seed_contrib trial_done ok=0 why=pool_full"));
});

test("region: the portal refused the made-up device, not contributed (tried again in the next window)", async () => {
  const k = await device(contribRoutes({ ready: false, contributed: false, reason: "region" }));
  assert.equal(await C.maybeContributeTrial(), false);
  assert.ok(k.logs.includes("seed_contrib trial_done ok=0 why=region"));
  assert.equal(k.kino.storage.get(C.TRIAL_OFF_KEY), null, "only the account's own block stops it for days");
});

test("409 contrib_not_needed: this account is blocked by region, not asked again for 7 days", async () => {
  const k = await device((p) => (p === "/trial/egress?contrib=1" ? json({ detail: "contrib_not_needed" }, 409) : undefined));
  const now = Date.now();
  assert.equal(await C.maybeContributeTrial(), false);
  assert.ok(Number(k.kino.storage.get(C.TRIAL_OFF_KEY)) >= now + C.TRIAL_BLOCKED_MS);
  // past the 3 h window, still blocked: no request
  k.kino.storage.set(C.TRIAL_AT_KEY, String(now - 4 * H));
  const n = k.seen.length;
  assert.equal(await C.maybeContributeTrial(), false);
  assert.equal(k.seen.length, n);
});

test("429: not contributed, and the person's own trial family is not held up", async () => {
  const k = await device((p) => (p === "/trial/egress?contrib=1" ? json({ detail: "rate_limited" }, 429) : undefined));
  assert.equal(await C.maybeContributeTrial(), false);
  assert.ok(k.logs.includes("seed_contrib trial_send ok=0 code=429"));
  assert.equal(api.limitedUntil("trial"), 0);
  assert.ok(api.limitedUntil("contrib") > 0);
});

test("an older backend (405 / 404 Not Found): nothing more for this runtime", async () => {
  const k = await device((p) => (p.startsWith("/trial/egress") ? json({ detail: "Method Not Allowed" }, 405) : undefined));
  assert.equal((await api.contribTrial(Date.now() + 10_000)).status, "noroute");
  const n = k.seen.length;
  assert.equal((await api.contribTrial(Date.now() + 10_000)).status, "noroute");
  assert.equal(k.seen.length, n, "no second request");
});

test("gates: the switch off, no Bearer, inside the 3 h window, too little time: no request", async () => {
  let k = await device(contribRoutes(), { settings: { contributeSeeds: false } });
  assert.equal(await C.maybeContributeTrial(), false);
  assert.equal(k.seen.length, 0);
  k = await device(contribRoutes(), { bearer: false });
  assert.equal(await C.maybeContributeTrial(), false);
  assert.equal(k.seen.length, 0);
  k = await device(contribRoutes(), { storage: { [C.TRIAL_AT_KEY]: String(Date.now() - 2 * H) } });
  assert.equal(await C.maybeContributeTrial(), false);
  assert.equal(k.seen.length, 0);
  k = await device(contribRoutes());
  assert.equal(await C.maybeContributeTrial({ deadline: Date.now() + 2000 }), false);
  assert.equal(k.seen.length, 0);
  assert.equal(Number(k.kino.storage.get(C.TRIAL_AT_KEY)) || null, null, "not stamped: a later Home tries");
});

test("afterHome: inside the masnew seed's window, Home's one contribution is the trial", async () => {
  const k = await device(contribRoutes(), { storage: { [C.AT_KEY]: String(Date.now() - H) } });
  assert.equal(await C.afterHome(Date.now()), true);
  assert.deepEqual(k.paths(), FLOW);
});

test("afterHome: a masnew seed that cannot even be tried (no portal secret stored) leaves the time to the trial", async () => {
  const k = await device((p, init) => (p === "/xuper/config" ? json({ detail: "down" }, 503) : contribRoutes()(p, init)));
  assert.equal(await C.afterHome(Date.now()), true);
  assert.equal(k.kino.storage.get(C.AT_KEY), null, "the masnew window stays open");
  assert.ok(k.paths().includes("/trial/egress?contrib=1"));
});
