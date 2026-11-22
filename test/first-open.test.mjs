// The first open of Xuper (owner, 2026-11-22): no Kino setup step, so Kino never sends the person to Configurar after the
// install. Xuper's own first screen is the welcome with "Ingresar" (where Kino's identity is asked); a sign-in that works
// goes straight to Xuper's Home (its catalog). Entry points only, so it also runs against a built bundle:
//   XUPER_PLUGIN=/abs/path/plugin.js node --test test/first-open.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import(process.env.XUPER_PLUGIN ? pathToFileURL(process.env.XUPER_PLUGIN).href : "../src/plugin.js");

const BACKEND = "https://x.xkplugins.site";
const OK = async () => ({ id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" });
const text = (v) => JSON.stringify(v);

async function firstOpen(identity = OK) {
  const route = (url) => {
    if (!url.startsWith(BACKEND)) return undefined;
    const path = url.slice(BACKEND.length);
    if (path === "/session/challenge") return res(200, JSON.stringify({ challenge: "c".repeat(32) }));
    if (path === "/session") return res(200, JSON.stringify({ session: "fresh" }));
    return res(200, "{}");
  };
  const k = installKino({ storage: {}, routes: [route] });
  k.kino.appVersion = "0.9.91";
  await P.screenEvent({ name: "disconnect", state: {} });   // no Bearer, the welcome not passed yet
  k.kino.identity = { telegram: identity };
  k.kino.log.report = () => {};
  return k;
}

test("manifest: no Kino setup step (Kino would open Configurar after the install), and no setup exports", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.equal(m.setup, undefined);
  assert.equal(m.enhancements, undefined);
  assert.equal(m.apiVersion, 30);
  assert.equal(P.setupStatus, undefined);
  assert.equal(P.setupRun, undefined);
});

test("first open: the welcome with Ingresar; a sign-in that works goes straight to Xuper's Home", async () => {
  await firstOpen();
  const welcome = await P.screen({ state: {}, device: "phone" });
  assert.match(text(welcome), /"event":"enter"/, "Ingresar is the first screen");

  const out = await P.screenEvent({ name: "enter", state: {} });
  assert.equal(out.state.actError, null);

  const home = text(await P.screen({ state: out.state, device: "phone" }));
  assert.doesNotMatch(home, /"event":"enter"|Xuper está listo|Preparar todo/);
  assert.match(home, /NavigationBar|TabBar/, "Xuper's Home, with its sections");
});

test("first open with no Telegram identity: Ingresar leads to the 'Valida tu Telegram' gate, not Home", async () => {
  await firstOpen(async () => { throw Object.assign(new Error("kino.identity: this device was never validated with a Telegram account"), { code: "not_available" }); });
  const out = await P.screenEvent({ name: "enter", state: {} });
  assert.equal(out.state.actError, "link");
  assert.match(text(await P.screen({ state: out.state, device: "phone" })), /Valida tu Telegram/);
});

test("Ajustes has no Preparar todo", async () => {
  await firstOpen();
  await P.screenEvent({ name: "enter", state: {} });
  assert.doesNotMatch(text(await P.screen({ state: { nav: "config" }, device: "phone" })), /Preparar todo|prepareAll|Prepare everything/);
});

const KIT = process.env.KINO_SCREEN_KIT || "C:/dev/kino-app/plugins/sdk/screen.mjs";
test("Kino's screen rules drop no node of Ajustes (ES/EN × phone/TV)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  const { configView } = await import("../src/screenView.js");
  for (const lang of ["es", "en"]) for (const device of ["phone", "tv"]) {
    globalThis.kino.lang = lang;
    assert.deepEqual(checkScreenTree(configView({ version: "3.1.12", device }), lang, undefined, { apiVersion: 30 }).dropped, [], `${lang} ${device}`);
  }
  globalThis.kino.lang = "es";
});
