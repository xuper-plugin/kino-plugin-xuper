// 451 {"detail":"region_blocked"} (backend region.py): the portal blocks the person's region and the backend could not
// get around it. Every backend call carries the region sentence (ES/EN), never the generic error, and the trial's 409
// recovery does not hide it behind "could not prepare your session". Against a fake backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const api = await import("../src/api.js");
const { beginCall } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });
const ES = "Xuper no está disponible en tu región en este momento. Prueba más tarde.";
const EN = "Xuper is not available in your region right now. Try again later.";

async function device(backend, lang = "es") {
  const seen = [];
  const k = installKino({ lang, storage: { "o2:mig": "1" }, routes: [(url, init) => {
    seen.push(url);
    return url.startsWith(BACKEND) ? backend(url.slice(BACKEND.length), init || {}) : undefined;
  }] });
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  globalThis.kino.lang = lang;
  api._resetRateLimit();
  api._resetEgress();
  beginCall();
  k.seen = seen;
  return k;
}

test("a 451 region_blocked on a backend call: the region sentence (ES and EN), status 451, never retried", async () => {
  for (const [lang, text] of [["es", ES], ["en", EN]]) {
    const k = await device(() => json({ detail: "region_blocked" }, 451), lang);
    const e = await api.authed("GET", "/section/home").then(() => null, (x) => x);
    assert.ok(e, "throws");
    assert.equal(e.userMessage, text);
    assert.equal(api.backendStatus(e), 451);
    assert.equal(k.seen.length, 1, "no retry");
  }
  globalThis.kino.lang = "es";
});

test("the trial's 409 recovery: a 451 from the trial flow keeps the region sentence, not 'could not prepare your session'", async () => {
  const k = await device((p) => {
    if (p.startsWith("/column/egress")) return json({ detail: "trial_needed" }, 409);
    if (p === "/trial/egress") return json({ detail: "region_blocked" }, 451);
    return undefined;
  });
  const e = await api.egressColumn("7", 1, 30).then(() => null, (x) => x);
  assert.ok(e, "throws");
  assert.equal(e.userMessage, ES);
  assert.equal(api.backendStatus(e), 451);
  assert.ok(k.seen.some((u) => u.endsWith("/trial/egress")));
});
