// Xuper only on the latest Kino (owner rule, 2026-11-22): below the minimum (the shipped floor, or the backend's 426
// X-Min-Kino when higher) the screen is "Actualiza Kino" and no content call works. Entry points only, so it also runs
// against a built bundle:   XUPER_PLUGIN=/abs/path/plugin.js node --test test/kino-gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import(process.env.XUPER_PLUGIN ? pathToFileURL(process.env.XUPER_PLUGIN).href : "../src/plugin.js");

const BACKEND = "https://x.xkplugins.site";
const OK_IDENTITY = async () => ({ id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" });

/** A device on Kino `version`, whose backend answers /session with `session` (a function of the request). */
async function device(version, session = () => res(200, JSON.stringify({ session: "fresh" }))) {
  const route = (url, init) => {
    if (!url.startsWith(BACKEND)) return undefined;
    const path = url.slice(BACKEND.length);
    if (path === "/session/challenge") return res(200, JSON.stringify({ challenge: "c".repeat(32) }));
    if (path === "/session") return session(init);
    return res(404, "");
  };
  const k = installKino({ storage: {}, routes: [route] });
  k.kino.appVersion = "0.9.91";
  await P.screenEvent({ name: "disconnect", state: {} });   // no Bearer (module state is shared between tests)
  k.kino.appVersion = version;
  k.kino.identity = { telegram: OK_IDENTITY };
  const reports = [];
  k.kino.log.report = (line) => reports.push(line);
  k.requests.length = 0; k.logs.length = 0;
  return { k, reports };
}

const text = (v) => JSON.stringify(v);

test("Kino 0.9.90 (below the 0.9.91 floor): the screen is 'Actualiza Kino', nothing else works, nothing reaches the backend", async () => {
  const { k } = await device("0.9.90");

  const view = text(await P.screen({ state: {}, device: "phone" }));
  assert.match(view, /Actualiza Kino/);
  assert.match(view, /Kino 0\.9\.91 o más reciente/);
  assert.match(view, /Buscar actualizaciones/);
  assert.match(view, /Update Kino/, "the English twin is there too");

  assert.deepEqual(await P.home(), []);
  assert.deepEqual(await P.search({ q: "batman" }), []);
  await assert.rejects(P.resolve("vod:1"), (e) => /0\.9\.91/.test(e.userMessage || e.message));
  await assert.rejects(P.episodes("vod:1"));
  const status = await P.setupStatus();
  assert.equal(status.ready, false);
  assert.match(status.label, /Actualiza|Kino 0\.9\.91/);
  await assert.rejects(P.setupRun({}));
  assert.equal(k.requests.filter((r) => r.url.startsWith(BACKEND)).length, 0, "no backend request on a too-old Kino");
});

test("Kino 0.9.91: not blocked; every backend request names the Kino version", async () => {
  const { k, reports } = await device("0.9.91");
  const out = await P.screenEvent({ name: "enter", state: {} });
  assert.equal(out.state.actError, null);
  assert.deepEqual(reports, []);
  const sent = k.requests.filter((r) => r.url.startsWith(BACKEND)).map((r) => r.headers["X-Kino-Version"]);
  assert.ok(sent.length >= 2);
  for (const v of sent) assert.equal(v, "0.9.91");
});

test("the backend raises the minimum (426 update_kino, X-Min-Kino 0.9.92): the update banner, then the gate with 0.9.92", async () => {
  const { k, reports } = await device("0.9.91", () => res(426, JSON.stringify({ detail: "update_kino" }), { "x-min-kino": "0.9.92" }));

  const out = await P.screenEvent({ name: "enter", state: {} });

  assert.equal(out.state.actError, "update", "the 'update Kino' banner, not a server error");
  assert.equal(reports.length, 1);
  assert.match(reports[0], /^activate_fail cause=update_kino via=in at=se /);
  assert.match(k.logs.join("\n"), /backend: 426 update_kino on \/session \(Kino 0\.9\.91, minimum 0\.9\.92\)/);
  // From now on this device is below the minimum the backend named.
  const view = text(await P.screen({ state: {}, device: "phone" }));
  assert.match(view, /Kino 0\.9\.92 o más reciente/);
  await assert.rejects(P.resolve("vod:1"), (e) => /0\.9\.92/.test(e.userMessage || e.message));
});

test("a Kino that names no version is never blocked by Xuper itself (the backend still decides)", async () => {
  const { k } = await device(undefined);
  const view = text(await P.screen({ state: {}, device: "phone" }));
  assert.doesNotMatch(view, /Actualiza Kino/);
  await P.screenEvent({ name: "enter", state: {} });
  assert.ok(k.requests.filter((r) => r.url.startsWith(BACKEND)).every((r) => !("X-Kino-Version" in r.headers)));
});
