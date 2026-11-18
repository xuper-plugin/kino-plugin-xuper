// Egress v2 (backend b3f1849 + a11c604): POST /column/egress, /item/egress and /trial/egress answer {results} or
// {egress, step}; the device asks the portal from its own address and POST /egress/step answers the same envelope.
// A 409 {"detail":"trial_needed"} runs the trial flow once per plugin call and repeats the call once; the screen's
// `open` prepares the trial at most once every 6 h. Against a fake backend and a fake portal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const api = await import("../src/api.js");
const catalog = await import("../src/catalog.js");
const { screenEvent } = await import("../src/screen.js");
const data = await import("../src/data.js");
const { itemRef, colRef } = await import("../src/refs.js");
const { beginCall } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";
const PORTAL_HOST = "https://cobgj.qw5ld24mj.com/";
const PORTAL = PORTAL_HOST + "portalCore/v3/x";
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });
const TICKET = (n) => ({ egress: { method: "POST", url: PORTAL + n, headers: { Cookie: "d=1; s=2" }, body: "cipher-" + n }, step: "s" + n });
const COLUMN = { items: [{ contentId: "9", name: "Matrix", type: "1", posterList: [] }], total: 45, channels: [], channelsTotal: 0, page: 1, size: 30 };
const ITEM = { detail: { name: "Serie", simpleProgramList: [{ contentId: "e1", name: "Uno" }, { contentId: "e2", name: "Dos" }] }, related: [] };
const H = 60 * 60_000;

/**
 * A device with a Bearer; `backend(path, init)` and `portal(url, init)` answer (undefined: 404 with no JSON detail).
 * `k.seen` lists every request with its init; `paths(k)` the backend paths without query ("PORTAL" for the portal).
 */
async function device(backend, portal = (url) => res(200, "raw-" + url.slice(-1)), extra = {}) {
  const seen = [];
  const k = installKino({ storage: { "o2:bearer": "bearer-token", "o2:mig": "1", ...extra }, routes: [(url, init) => {
    seen.push({ url, init: init || {} });
    if (url.startsWith(BACKEND)) return backend(url.slice(BACKEND.length), init || {});
    if (url.startsWith(PORTAL_HOST)) return portal(url, init || {});
    return undefined;
  }] });
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  for (const [key, v] of Object.entries(extra)) k.kino.storage.set(key, v);
  api._resetRateLimit();
  api._resetEgress();
  data._resetMemory();
  beginCall();
  k.seen = seen;
  return k;
}
const paths = (k) => k.seen.map((r) => (r.url.startsWith(BACKEND) ? r.url.slice(BACKEND.length).replace(/\?.*$/, "") : "PORTAL"));
const bodyOf = (r) => { const b = r.init && r.init.body; if (b && typeof b === "object" && "json" in b) return b.json; try { return JSON.parse(b); } catch (_) { return null; } };
const stamp = (k) => JSON.parse(k.kino.storage.get(api.TRIAL_KEY) || "{}");

/** A trial flow of three steps (snToken → active → getFree), ready until `expiresAt`. Counts in `n`. */
function trialRoutes(n, expiresAt = Date.now() + 2 * H) {
  return (p, init) => {
    if (p === "/trial/egress") { n.starts = (n.starts || 0) + 1; return json(TICKET(1)); }
    if (p === "/egress/step" && bodyOf({ init }).step === "s1") return json(TICKET(2));
    if (p === "/egress/step" && bodyOf({ init }).step === "s2") return json(TICKET(3));
    if (p === "/egress/step" && bodyOf({ init }).step === "s3") return json({ results: { ready: true, expiresAt } });
    return undefined;
  };
}
const TRIAL_PATHS = ["/trial/egress", "PORTAL", "/egress/step", "PORTAL", "/egress/step", "PORTAL", "/egress/step"];

// ── the starts ──

test("column: cached results answer at once (one POST /column/egress with column_id, page and size; no portal, no GET)", async () => {
  const k = await device((p, init) => (p.startsWith("/column/egress") && init.method === "POST" ? json({ results: COLUMN }) : undefined));
  const page = await catalog.browse(colRef("85163"));
  assert.equal(page.items.length, 1);
  assert.equal(page.next, "2", "45 in total, 30 a page");
  assert.deepEqual(paths(k), ["/column/egress"]);
  assert.match(k.seen[0].url, /\/column\/egress\?column_id=85163&page=1&size=30$/);
});

test("column: one step — the portal from this device (8 s, no cookies, the ticket's headers) and POST /egress/step with the raw answer", async () => {
  const k = await device((p) => {
    if (p.startsWith("/column/egress")) return json(TICKET(1));
    if (p === "/egress/step") return json({ results: COLUMN });
    return undefined;
  });
  const page = await catalog.browse(colRef("7"), "2");
  assert.equal(page.items.length, 1);
  assert.equal(page.next, null, "page 2 of 45 is the last");
  assert.match(k.seen[0].url, /column_id=7&page=2&size=30$/);
  assert.deepEqual(paths(k), ["/column/egress", "PORTAL", "/egress/step"]);
  const portal = k.seen[1];
  assert.equal(portal.url, PORTAL + "1");
  assert.equal(portal.init.method, "POST");
  assert.equal(portal.init.body, "cipher-1");
  assert.equal(portal.init.cookies, false);
  assert.equal(portal.init.timeoutMs, 8000);
  assert.equal(portal.init.headers.Cookie, "d=1; s=2");
  assert.deepEqual(bodyOf(k.seen[2]), { step: "s1", response: "raw-1" });
});

test("item: three steps (the backend's most) end in {detail, related}; content_id, language=en and the ref's type go in the start", async () => {
  let steps = 0;
  const k = await device((p) => {
    if (p.startsWith("/item/egress")) return json(TICKET(1));
    if (p === "/egress/step") { steps++; return json(steps < 3 ? TICKET(steps + 1) : { results: ITEM }); }
    return undefined;
  });
  const out = await catalog.episodes(itemRef("123", "0"));
  assert.equal(out.episodes.length, 2);
  assert.equal(out.series.title, "Serie");
  assert.match(k.seen[0].url, /\/item\/egress\?content_id=123&language=en&type=0$/);
  assert.deepEqual(paths(k), ["/item/egress", "PORTAL", "/egress/step", "PORTAL", "/egress/step", "PORTAL", "/egress/step"]);
  assert.deepEqual(k.seen.filter((r) => r.url.startsWith(PORTAL_HOST)).map((r) => r.init.body), ["cipher-1", "cipher-2", "cipher-3"]);
});

test("a backend that keeps answering tickets stops after 6 steps (anti-loop) and the call fails", async () => {
  let n = 0;
  const k = await device((p) => (p.startsWith("/item/egress") || p === "/egress/step" ? json(TICKET(++n)) : undefined));
  await assert.rejects(catalog.episodes(itemRef("1", "0")), /too many egress steps \(item\)/);
  assert.equal(paths(k).filter((p) => p === "PORTAL").length, 6);
});

// ── older backends ──

test("an older backend: 405 on POST /column/egress (GET /column/{id} takes the path) → GET /column for the rest of the runtime", async () => {
  const k = await device((p, init) => {
    if (p.startsWith("/column/egress")) return json({ detail: "Method Not Allowed" }, 405);
    if (p.startsWith("/column/85163") && init.method === "GET") return json(COLUMN);
    return undefined;
  });
  assert.equal((await catalog.browse(colRef("85163"))).items.length, 1);
  beginCall();
  assert.equal((await catalog.browse(colRef("85163"), "2")).items.length, 1);
  assert.deepEqual(paths(k), ["/column/egress", "/column/85163", "/column/85163"], "asked once");
  assert.match(k.seen[2].url, /\/column\/85163\?page=2&size=30$/);
});

test("an older backend: 404 'Not Found' on /item/egress → GET /item for the rest of the runtime", async () => {
  const k = await device((p, init) => {
    if (p.startsWith("/item/egress")) return json({ detail: "Not Found" }, 404);
    if (p === "/item/123" && init.method === "GET") return json(ITEM);
    return undefined;
  });
  assert.equal((await catalog.episodes(itemRef("123", "0"))).episodes.length, 2);
  beginCall();
  assert.equal((await catalog.episodes(itemRef("123", "0"))).episodes.length, 2);
  assert.deepEqual(paths(k), ["/item/egress", "/item/123", "/item/123"]);
});

test("item: a 404 that says the item does not exist throws (no GET); a 404 with no detail (unsure) takes GET /item this once", async () => {
  let k = await device((p) => (p.startsWith("/item/egress") ? json({ detail: "contenido no encontrado" }, 404) : p === "/item/9" ? json(ITEM) : undefined));
  await assert.rejects(catalog.episodes(itemRef("9", "0")), (e) => api.backendStatus(e) === 404);
  assert.deepEqual(paths(k), ["/item/egress"], "the backend's answer stands: no GET");

  k = await device((p) => (p.startsWith("/item/egress") ? res(404, "<html>nope</html>") : p === "/item/9" ? json(ITEM) : undefined));
  assert.equal((await catalog.episodes(itemRef("9", "0"))).episodes.length, 2);
  beginCall();
  await catalog.episodes(itemRef("9", "0"));
  assert.deepEqual(paths(k), ["/item/egress", "/item/9", "/item/egress", "/item/9"], "unsure: not latched");
});

test("a backend with the starts but no /egress/step (404 'Not Found') takes the step on its /search/step alias, and keeps it", async () => {
  const k = await device((p) => {
    if (p.startsWith("/column/egress")) return json(TICKET(1));
    if (p === "/egress/step") return json({ detail: "Not Found" }, 404);
    if (p === "/search/step") return json({ results: COLUMN });
    return undefined;
  });
  assert.equal((await catalog.browse(colRef("1"))).items.length, 1);
  beginCall();
  assert.equal((await catalog.browse(colRef("1"))).items.length, 1);
  assert.deepEqual(paths(k), ["/column/egress", "PORTAL", "/egress/step", "/search/step", "/column/egress", "PORTAL", "/search/step"]);
  assert.deepEqual(bodyOf(k.seen[3]), { step: "s1", response: "raw-1" }, "the same step, once more, on the alias");
});

// ── stale steps, upstream errors ──

test("bad_step / step_mismatch on /egress/step start the flow over once, never twice", async () => {
  for (const detail of ["bad_step", "step_mismatch"]) {
    let starts = 0;
    let k = await device((p) => {
      if (p.startsWith("/item/egress")) { starts++; return json(TICKET(starts)); }
      if (p === "/egress/step") return starts === 1 ? json({ detail }, 400) : json({ results: ITEM });
      return undefined;
    });
    assert.equal((await catalog.episodes(itemRef("5", "0"))).episodes.length, 2);
    assert.equal(starts, 2);
    let n = 0;
    k = await device((p) => {
      if (p.startsWith("/column/egress")) { n++; return json(TICKET(n)); }
      if (p === "/egress/step") return json({ detail }, 400);
      return undefined;
    });
    await assert.rejects(catalog.browse(colRef("1")), (e) => api.backendStatus(e) === 400);
    assert.equal(n, 2, "refused twice: no third start");
    assert.ok(!paths(k).includes("/column/1"), "a refused step is not a missing route: no GET");
  }
});

test("resolve: a stale step starts over once too (POST /resolve/<id> again)", async () => {
  let starts = 0;
  const k = await device((p) => {
    if (p.split("?")[0] === "/resolve/77") { starts++; return json(TICKET(starts)); }
    if (p === "/resolve/step") return starts === 1 ? json({ detail: "bad_step" }, 400) : json({ stream: { url: "https://cdn.example/v.ts" } });
    return undefined;
  });
  const out = await catalog.resolve(itemRef("77", "1"));
  assert.equal(out.url, "https://cdn.example/v.ts");
  assert.deepEqual(paths(k), ["/resolve/77", "PORTAL", "/resolve/step", "/resolve/77", "PORTAL", "/resolve/step"]);
});

test("502 upstream_error on a step is an error (no restart, no GET)", async () => {
  const k = await device((p) => {
    if (p.startsWith("/column/egress")) return json(TICKET(1));
    if (p === "/egress/step") return json({ detail: "upstream_error" }, 502);
    return undefined;
  });
  await assert.rejects(catalog.browse(colRef("1")), (e) => api.backendStatus(e) === 502);
  assert.deepEqual(paths(k), ["/column/egress", "PORTAL", "/egress/step"]);
});

// ── 429: the flow's family ──

test("a 429 on /egress/step counts against the flow's family (column), not 'egress': column waits, item and trial do not", async () => {
  const k = await device((p) => {
    if (p.startsWith("/column/egress")) return json(TICKET(1));
    if (p.startsWith("/item/egress")) return json({ results: ITEM });
    if (p === "/egress/step") return res(429, JSON.stringify({ detail: "rate_limited" }));
    return undefined;
  });
  await assert.rejects(catalog.browse(colRef("1")), (e) => api.isRateLimited(e) && /on column/.test(e.message));
  assert.ok(api.limitedUntil("column") > Date.now());
  assert.equal(api.limitedUntil("egress"), 0);
  assert.equal(api.limitedUntil("item"), 0);
  beginCall();
  assert.equal((await catalog.episodes(itemRef("5", "0"))).episodes.length, 2, "another family still answers");
  const before = k.seen.length;
  beginCall();
  await assert.rejects(catalog.browse(colRef("1")), (e) => api.isRateLimited(e));
  assert.equal(k.seen.length, before, "inside the column wait: no request");
});

// ── 409 trial_needed ──

test("409 trial_needed on a start: the trial flow (3 steps), then the start once more; the expiry is stored", async () => {
  const n = {};
  const expiresAt = Date.now() + 3 * H;
  let starts = 0;
  const trial = trialRoutes(n, expiresAt);
  const k = await device((p, init) => {
    if (p.startsWith("/column/egress")) return ++starts === 1 ? json({ detail: "trial_needed" }, 409) : json({ results: COLUMN });
    return trial(p, init);
  });
  assert.equal((await catalog.browse(colRef("1"))).items.length, 1);
  assert.deepEqual(paths(k), ["/column/egress", ...TRIAL_PATHS, "/column/egress"]);
  assert.equal(stamp(k).expiresAt, expiresAt);
  const trialPortal = k.seen.filter((r) => r.url.startsWith(PORTAL_HOST));
  assert.ok(trialPortal.every((r) => r.init.timeoutMs <= 6000 && r.init.cookies === false), "trial portal calls: ≤ 6 s, no cookies");
});

test("409 on a catalog GET (/section) and on /resolve: one trial, one retry each", async () => {
  {
    const n = {};
    let calls = 0;
    const trial = trialRoutes(n);
    const k = await device((p, init) => (p.startsWith("/section/") ? (++calls === 1 ? json({ detail: "trial_needed" }, 409) : json({ ok: 1 })) : trial(p, init)));
    assert.deepEqual(await api.authed("GET", "/section/peliculas?page=1&size=30"), { ok: 1 });
    assert.deepEqual(paths(k), ["/section/peliculas", ...TRIAL_PATHS, "/section/peliculas"]);
  }
  {
    const n = {};
    let calls = 0;
    const trial = trialRoutes(n);
    const k = await device((p, init) => {
      if (p.split("?")[0] === "/resolve/42") return ++calls === 1 ? json({ detail: "trial_needed" }, 409) : json({ stream: { url: "https://cdn.example/42.ts" } });
      return trial(p, init);
    });
    assert.equal((await catalog.resolve(itemRef("42", "1"))).url, "https://cdn.example/42.ts");
    assert.equal(n.starts, 1);
    assert.deepEqual(paths(k), ["/resolve/42", ...TRIAL_PATHS, "/resolve/42"]);
  }
});

test("409 on a resolve STEP: the trial, then POST /resolve/<id> again; the stale step is never sent twice", async () => {
  const n = {};
  let starts = 0;
  const trial = trialRoutes(n);
  const k = await device((p, init) => {
    if (p.split("?")[0] === "/resolve/77") return ++starts === 1 ? json(TICKET(1)) : json({ stream: { url: "https://cdn.example/77.ts" } });
    if (p === "/resolve/step") return json({ detail: "trial_needed" }, 409);
    return trial(p, init);
  });
  assert.equal((await catalog.resolve(itemRef("77", "1"))).url, "https://cdn.example/77.ts");
  assert.equal(n.starts, 1, "one trial");
  assert.deepEqual(paths(k), ["/resolve/77", "PORTAL", "/resolve/step", ...TRIAL_PATHS, "/resolve/77"]);
});

test("409 on a resolve step twice (the trial did not take): the trial error, after one fresh start", async () => {
  const n = {};
  const trial = trialRoutes(n);
  const k = await device((p, init) => {
    if (p.split("?")[0] === "/resolve/77") return json(TICKET(1));
    if (p === "/resolve/step") return json({ detail: "trial_needed" }, 409);
    return trial(p, init);
  });
  await assert.rejects(catalog.resolve(itemRef("77", "1")), (e) => e.status === 409 && e.detail === "trial_needed");
  assert.equal(paths(k).filter((p) => p === "/resolve/77").length, 2, "the first start and one fresh start");
  assert.equal(paths(k).filter((p) => p === "/resolve/step").length, 2, "each start's own step, never a repeat");
});

test("409 on search: the trial, then /search/egress once more", async () => {
  const n = {};
  let calls = 0;
  const trial = trialRoutes(n);
  const R = { programResult: { list: [{ contentId: "9", name: "Matrix", type: "1", posterList: [] }] } };
  const k = await device((p, init) => (p.startsWith("/search/egress") ? (++calls === 1 ? json({ detail: "trial_needed" }, 409) : json({ results: R })) : trial(p, init)));
  assert.equal((await catalog.search({ q: "trial uno" })).length, 1);
  assert.equal(n.starts, 1);
  assert.deepEqual(paths(k), ["/search/egress", ...TRIAL_PATHS, "/search/egress"]);
});

test("parallel calls that all get a 409 run ONE trial flow (single-flight per plugin call)", async () => {
  const n = {};
  const first = new Set();
  const trial = trialRoutes(n);
  await device((p, init) => {
    if (p.startsWith("/section/")) {
      if (!first.has(p)) { first.add(p); return json({ detail: "trial_needed" }, 409); }
      return json({ name: p });
    }
    return trial(p, init);
  });
  const out = await Promise.all(["a", "b", "c"].map((s) => api.authed("GET", "/section/" + s)));
  assert.deepEqual(out.map((o) => o.name), ["/section/a", "/section/b", "/section/c"]);
  assert.equal(n.starts, 1);
});

test("a trial that keeps failing never loops: one trial and no retry per plugin call; the call fails with the ES/EN sentence", async () => {
  for (const lang of ["es", "en"]) {
    let section = 0;
    let trials = 0;
    const k = await device((p) => {
      if (p.startsWith("/section/")) { section++; return json({ detail: "trial_needed" }, 409); }
      if (p === "/trial/egress") { trials++; return json(TICKET(1)); }
      if (p === "/egress/step") return json({ detail: "upstream_error" }, 502);
      return undefined;
    });
    k.kino.lang = lang;
    const sentence = lang === "en" ? "Could not prepare your Xuper session. Try again in a moment." : "No se pudo preparar tu sesión de Xuper. Inténtalo de nuevo en un momento.";
    await assert.rejects(api.authed("GET", "/section/a"), (e) => e.userMessage === sentence && api.backendStatus(e) === 409);
    await assert.rejects(api.authed("GET", "/section/b"), (e) => e.userMessage === sentence);
    assert.equal(trials, 1, "the failed flow is shared by the rest of the plugin call");
    assert.equal(section, 2, "no retry after a failed trial");
    beginCall();
    await assert.rejects(api.authed("GET", "/section/c"));
    assert.equal(trials, 2, "a new plugin call tries once more");
    assert.equal(api.trialFailedText(lang), sentence);
  }
});

test("a trial that is ready but the call still answers 409: one retry, then the trial sentence (never a second round)", async () => {
  const n = {};
  let section = 0;
  const trial = trialRoutes(n);
  await device((p, init) => (p.startsWith("/section/") ? (section++, json({ detail: "trial_needed" }, 409)) : trial(p, init)));
  await assert.rejects(api.authed("GET", "/section/a"), (e) => e.userMessage === api.trialFailedText());
  assert.equal(section, 2);
  assert.equal(n.starts, 1);
});

test("409 then the trial's own 429 / 401: the call fails with that error's sentence (wait / sign in again)", async () => {
  let k = await device((p) => {
    if (p.startsWith("/section/")) return json({ detail: "trial_needed" }, 409);
    if (p === "/trial/egress") return json(TICKET(1));
    if (p === "/egress/step") return res(429, JSON.stringify({ detail: "rate_limited" }));
    return undefined;
  });
  await assert.rejects(api.authed("GET", "/section/a"), (e) => api.isRateLimited(e));
  assert.ok(api.limitedUntil("trial") > Date.now(), "the trial's /egress/step counts as the trial family");
  assert.equal(api.limitedUntil("egress"), 0);
  assert.equal(api.limitedUntil("section"), 0);

  k = await device((p) => (p.startsWith("/section/") ? json({ detail: "trial_needed" }, 409) : p === "/trial/egress" ? json({ detail: "no_session" }, 401) : undefined));
  await assert.rejects(api.authed("GET", "/section/a"), (e) => e.userMessage === api.sessionExpiredText());
  assert.ok(!k.kino.storage.get("o2:bearer"), "the refused Bearer is dropped for the screen's sign-in");
});

test("a valid trial answers {results} at once: no portal call", async () => {
  const expiresAt = Date.now() + 5 * H;
  let calls = 0;
  const k = await device((p) => {
    if (p.startsWith("/section/")) return ++calls === 1 ? json({ detail: "trial_needed" }, 409) : json({ ok: 1 });
    if (p === "/trial/egress") return json({ results: { ready: true, expiresAt } });
    return undefined;
  });
  assert.deepEqual(await api.authed("GET", "/section/a"), { ok: 1 });
  assert.deepEqual(paths(k), ["/section/a", "/trial/egress", "/section/a"]);
  assert.equal(stamp(k).expiresAt, expiresAt);
});

// ── the trial at the screen's `open` ──

test("trialAtOpen: runs once, then skips while the expiry is ahead, and at most once every 6 h", async () => {
  const n = {};
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const k = await device(trialRoutes(n, now + 2 * H));
    assert.equal(await api.trialAtOpen(), "ready");
    assert.equal(n.starts, 1);
    assert.deepEqual(paths(k), TRIAL_PATHS);
    assert.equal(stamp(k).expiresAt, now + 2 * H);
    assert.equal(stamp(k).openAt, now);
    beginCall();
    assert.equal(await api.trialAtOpen(), "valid");
    now += 2 * H + 1;             // the trial ran out, but `open` tried 2 h ago
    beginCall();
    assert.equal(await api.trialAtOpen(), "recent");
    assert.equal(n.starts, 1);
    now += 4 * H;                 // 6 h since the last attempt
    beginCall();
    assert.equal(await api.trialAtOpen(), "ready");
    assert.equal(n.starts, 2);
  } finally { Date.now = realNow; }
});

test("trialAtOpen: a failed flow is not asked again for 6 h; an older backend (404 'Not Found') is skipped for the runtime; no Bearer → skip", async () => {
  let trials = 0;
  let k = await device((p) => (p === "/trial/egress" ? (trials++, json({ detail: "upstream_error" }, 502)) : undefined));
  assert.equal(await api.trialAtOpen(), "failed");
  beginCall();
  assert.equal(await api.trialAtOpen(), "recent");
  assert.equal(trials, 1);

  k = await device((p) => (p === "/trial/egress" ? json({ detail: "Not Found" }, 404) : undefined));
  assert.equal(await api.trialAtOpen(), "skip");
  k.kino.storage.remove(api.TRIAL_KEY);
  beginCall();
  assert.equal(await api.trialAtOpen(), "skip");
  assert.deepEqual(paths(k), ["/trial/egress"], "latched: asked once");

  k = await device(() => undefined);
  k.kino.storage.remove("o2:bearer");
  await api.clearBearer();
  assert.equal(await api.trialAtOpen(), "skip");
  assert.equal(k.seen.length, 0);
});

test("the screen's open event prepares the trial once (signed in, nothing valid stored) and not on the next open", async () => {
  const n = {};
  const k = await device((p, init) => {
    const t = trialRoutes(n)(p, init);
    if (t) return t;
    return res(503, "");
  }, undefined, {});
  await screenEvent({ name: "open", state: {} });
  assert.equal(n.starts, 1);
  assert.ok(stamp(k).expiresAt > Date.now());
  beginCall();
  await screenEvent({ name: "open", state: {} });
  assert.equal(n.starts, 1, "valid: the second open does not ask");
});

test("Desconectar forgets the trial stamp (the next account's open prepares its own)", async () => {
  const k = await device(() => undefined, undefined, { [api.TRIAL_KEY]: JSON.stringify({ expiresAt: Date.now() + H, openAt: Date.now() }) });
  assert.ok(api.trialValid());
  await api.clearBearer();
  assert.equal(k.kino.storage.get(api.TRIAL_KEY), null);
});
