// Search through this device (backend f545db3): POST /search/egress → {results} or {egress, step}; the device asks the
// portal from its own address and POST /search/step answers {results}. An older backend (404) keeps GET /search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const api = await import("../src/api.js");
const catalog = await import("../src/catalog.js");
const { beginCall } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";
const PORTAL = "https://cobgj.qw5ld24mj.com/portalCore/v3/searchByName";
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });
const RESULTS = { programResult: { list: [{ contentId: "9", name: "Matrix", type: "1", posterList: [] }] } };
const TICKET = (n) => ({ egress: { method: "POST", url: PORTAL, headers: { Cookie: "d=1; s=2; t=3" }, body: "cipher-" + n }, step: "s" + n });

/** A device with a Bearer; `backend(path, init)` and `portal(url, init)` answer (undefined: 404). */
async function device(backend, portal = () => res(200, "portal-raw")) {
  const seen = [];
  const k = installKino({ storage: { "o2:bearer": "bearer-token", "o2:mig": "1" }, routes: [(url, init) => {
    seen.push({ url, init: init || {} });
    if (url.startsWith(BACKEND)) return backend(url.slice(BACKEND.length), init);
    if (url.startsWith("https://cobgj.qw5ld24mj.com/")) return portal(url, init);
    return undefined;
  }] });
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  api._resetRateLimit();
  api._resetSearchEgress();
  beginCall();
  k.seen = seen;
  return k;
}
const paths = (k) => k.requests.map((r) => (r.url.startsWith(BACKEND) ? r.url.slice(BACKEND.length).replace(/\?.*$/, "") : "PORTAL"));
const bodyOf = (r) => { const b = r.init && r.init.body; if (b && typeof b === "object" && "json" in b) return b.json; try { return JSON.parse(b); } catch (_) { return null; } };

test("a cached search answers at once: one POST /search/egress, no portal call", async () => {
  const k = await device((p) => (p.startsWith("/search/egress") ? json({ results: RESULTS }) : undefined));
  const items = await catalog.search({ q: "Matrix uno" });
  assert.equal(items.length, 1);
  assert.deepEqual(paths(k), ["/search/egress"]);
  assert.match(k.seen[0].url, /\/search\/egress\?q=Matrix%20uno&page=1&size=25$/);
  assert.equal(k.seen[0].init.method, "POST");
});

test("search paints the vertical cover (icon), not the wide art", async () => {
  const withArt = { programResult: { list: [{ contentId: "77", name: "Dune", type: "1", posterList: [
    { fileType: "stage", fileUrl: "https://x/wide.jpg" },
    { fileType: "icon", fileUrl: "https://x/cover.jpg" },
  ] }] } };
  const k = await device((p) => (p.startsWith("/search/egress") ? json({ results: withArt }) : undefined));
  const items = await catalog.search({ q: "Dune" });
  assert.equal(items[0].poster, "https://x/cover.jpg", "the portrait icon, not the 1920×1080 stage");
  assert.equal(items[0].backdrop, "https://x/wide.jpg");
});

test("an egress ticket: the device asks the portal (8 s, no cookies, the ticket's headers) and hands the raw answer to /search/step", async () => {
  const k = await device((p) => {
    if (p.startsWith("/search/egress")) return json(TICKET(1));
    if (p === "/search/step") return json({ results: RESULTS });
    return undefined;
  });
  const items = await catalog.search({ q: "Matrix dos" });
  assert.equal(items.length, 1);
  assert.deepEqual(paths(k), ["/search/egress", "PORTAL", "/search/step"]);
  const portal = k.seen[1];
  assert.equal(portal.init.method, "POST");
  assert.equal(portal.init.body, "cipher-1");
  assert.equal(portal.init.cookies, false);
  assert.equal(portal.init.timeoutMs, 8000);
  assert.equal(portal.init.headers.Cookie, "d=1; s=2; t=3");
  assert.deepEqual(bodyOf(k.seen[2]), { step: "s1", response: "portal-raw" });
});

test("a renewed portal session: the step answers one more ticket, then results (two portal calls)", async () => {
  let steps = 0;
  const k = await device((p) => {
    if (p.startsWith("/search/egress")) return json(TICKET(1));
    if (p === "/search/step") return json(++steps === 1 ? TICKET(2) : { results: RESULTS });
    return undefined;
  });
  assert.equal((await catalog.search({ q: "Matrix tres" })).length, 1);
  assert.deepEqual(paths(k), ["/search/egress", "PORTAL", "/search/step", "PORTAL", "/search/step"]);
});

test("an older backend (404 on /search/egress) uses GET /search, and keeps it for the rest of the runtime", async () => {
  const k = await device((p, init) => {
    if (p.startsWith("/search/egress")) return json({ detail: "Not Found" }, 404);
    if (p.startsWith("/search?") && (!init || !init.method || init.method === "GET")) return json(RESULTS);
    return undefined;
  });
  assert.equal((await catalog.search({ q: "Matrix cuatro" })).length, 1);
  beginCall();
  assert.equal((await catalog.search({ q: "Matrix cinco" })).length, 1);
  assert.deepEqual(paths(k), ["/search/egress", "/search", "/search"], "the 404 is asked once");
});

test("a step that expired or belongs to another device (400 bad_step / step_mismatch) starts over once, never more", async () => {
  for (const detail of ["bad_step", "step_mismatch"]) {
    let starts = 0;
    const k = await device((p) => {
      if (p.startsWith("/search/egress")) { starts++; return json(TICKET(starts)); }
      if (p === "/search/step") return starts === 1 ? json({ detail }, 400) : json({ results: RESULTS });
      return undefined;
    });
    assert.equal((await catalog.search({ q: "Matrix " + detail })).length, 1);
    assert.equal(starts, 2);
    // refused twice: nothing found, no third start
    let n = 0;
    const k2 = await device((p) => {
      if (p.startsWith("/search/egress")) { n++; return json(TICKET(n)); }
      if (p === "/search/step") return json({ detail }, 400);
      return undefined;
    });
    assert.deepEqual(await catalog.search({ q: "Matrix again " + detail }), []);
    assert.equal(n, 2);
    assert.ok(k && k2);
  }
});

test("the portal's 502 through the backend and a 401 give no results; a 401 drops the Bearer for the screen's sign-in", async () => {
  let k = await device((p) => {
    if (p.startsWith("/search/egress")) return json(TICKET(1));
    if (p === "/search/step") return json({ detail: "upstream_error" }, 502);
    return undefined;
  });
  assert.deepEqual(await catalog.search({ q: "Matrix seis" }), []);
  k = await device((p) => (p.startsWith("/search/egress") ? json({ detail: "no_session" }, 401) : undefined));
  assert.deepEqual(await catalog.search({ q: "Matrix siete" }), []);
  assert.ok(!k.kino.storage.get("o2:bearer"), "Bearer dropped");
});

test("backendStatus reads the status of a backend error", () => {
  assert.equal(api.backendStatus({ status: 404 }), 404);
  assert.equal(api.backendStatus(new Error("Xuper: backend 400 bad_step search")), 400);
  assert.equal(api.backendStatus(new Error("other")), 0);
});
