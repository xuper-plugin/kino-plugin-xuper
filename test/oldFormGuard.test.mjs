// Guard: the configuration screen is ADDITIVE. The tests that pin the old settings form (the status line, the action
// buttons and their clearSettings, validateSettings' verdicts, the shared account, the account sentences, the relogin
// and sync paths, the seed contribution) must stay exactly as they were in 2.2.33 and keep passing. A change to one of
// them is a change to the old form's behaviour: it needs the owner's go-ahead and its own version, never this work.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { accountWorld } from "./helpers/accountWorld.mjs";

// sha256 of each file as of 2.2.33 (c7b1929), line endings normalised.
const PINNED = {
  "settings.test.mjs": "bea282b333bb76bc8b8c10dea8249f293367f6bee309184eb93e4a99d0d214ca",
  "registration.test.mjs": "477474bfc7e9840ad95717b0ee233eb0275c8e53058cd365f1aaaa4bd8de03ec",
  "sharedAccount.test.mjs": "7535f405e7c2d50249d58deaaf3395a18853da03cc43048e517dea3817dc59bb",
  "accountSentences.test.mjs": "4f0c08d6a8e149c1cb55d2f0d3610f6734a1fe45c61297d452685fa5ce60d362",
  "accountRelogin.test.mjs": "2ddc48b2ae5e3b392ef5dbe771c90b83778ec979521b9fd49d2a7a023bc21bcf",
  "accountSync.test.mjs": "ebad72271330a6fd90df2d7668f853e364d02266ea1826d76a3f05244563503d",
  "seedContrib.test.mjs": "b61aff8b097dc31da24b804be8eee6b6ff68067abb536b95b881cb6fed56095a",
};

test("the old form's tests are unchanged since 2.2.33", () => {
  for (const [file, want] of Object.entries(PINNED)) {
    const text = readFileSync(new URL("./" + file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.equal(createHash("sha256").update(text).digest("hex"), want, `${file} changed: the old form must stay as it is`);
  }
});

test("the old exports answer exactly what they answered (a few outputs, end to end over the real session)", async () => {
  const PW = "stand-in-pw-9";
  const w = accountWorld({ saved: { email: "ana@x.test", password: PW } });
  assert.deepEqual(await w.settings.settingsStatus(), { status: "Conectando con tu cuenta… Mientras tanto, sesión anónima" });
  assert.deepEqual(await w.settings.action("login"), { message: "Sesión iniciada", refresh: true });
  assert.deepEqual(await w.settings.settingsStatus(), { status: "Conectado como ana@x.test" });
  assert.equal(await w.settings.validateSettings({ email: "ana@x.test", password: PW }), null);
  assert.deepEqual(await w.settings.validateSettings({ email: "ana", password: PW }), { email: "Escribe un correo válido" });
  assert.deepEqual(await w.settings.validateSettings({ email: "ana@x.test", password: PW, useSharedAccount: true }),
    { useSharedAccount: "Quita tu cuenta o apaga la cuenta compartida" });
  assert.deepEqual(await w.settings.action("logout"),
    { message: "Sesión cerrada", refresh: true, clearSettings: ["email", "password", "regEmail", "regPassword", "useSharedAccount"] });
  assert.deepEqual(await w.settings.action("switchSeed"), { message: "Tu cuenta no usa semillas", refresh: true });
});
