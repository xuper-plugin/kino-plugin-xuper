// The account states the configuration screen tells apart, each over the real session and a scripted portal, and the
// check that nothing personal ever reaches what the person or a log can see.
import assert from "node:assert/strict";
import { accountWorld, goodRoutes, refuse, SHARED } from "./accountWorld.mjs";
import { TABS } from "../../src/screenView.js";

export const PW = "stand-in-pw-9"; // never a real credential
export const EMAIL = "persona@ejemplo.test";
export const CODE = "482913";
export const DEVICES = ["phone", "tv"];
export const STATES = ["anonymous", "ownPending", "ownHeld", "ownRefused", "shared", "blocked"];

/** A world in account state `name`. */
export async function worldIn(name) {
  if (name === "anonymous") return accountWorld();
  if (name === "ownPending") return accountWorld({ saved: { email: EMAIL, password: PW } });
  if (name === "ownHeld") { const w = accountWorld({ saved: { email: EMAIL, password: PW } }); await w.settings.action("login"); return w; }
  if (name === "ownRefused") {
    const w = accountWorld({ saved: { email: EMAIL, password: PW }, routes: goodRoutes({ "v8/login": refuse() }) });
    await assert.rejects(w.settings.action("login"));
    return w;
  }
  if (name === "shared") { const w = accountWorld({ saved: { useSharedAccount: true } }); await w.session.useShared(); return w; }
  if (name === "blocked") return accountWorld({ storageExtra: { region: { blocked: true } } });
  throw new Error(name);
}

/** Everything personal a tree, a toast, a log line or a copied text must never carry. */
export function assertNoSecrets(texts, extra = []) {
  const all = Array.isArray(texts) ? texts.join("\n") : String(texts);
  for (const s of [EMAIL, PW, SHARED.email, SHARED.password, "tok-old", "tok-new", "tok-pend", "sn-old", "u-old", "jwt-new", ...extra]) {
    assert.ok(!all.includes(s), `"${s}" leaked`);
  }
}

/** Each tab of the main page, drawn. */
export async function tabs(h) {
  const out = {};
  for (const tab of TABS) {
    h.state.tab = tab;
    out[tab] = await h.render();
  }
  return out;
}
