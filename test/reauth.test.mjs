// Ajustes ▸ "Reautenticar" (3.1.0): a fresh session with the current Kino identity, for a device the backend still
// trusts but whose session went stale — the real-world fix of a reinstall + re-link, without the reinstall. Written
// against the entry points only, so it also runs against a built bundle:
//   XUPER_PLUGIN=/abs/path/plugin.js node --test test/reauth.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import(process.env.XUPER_PLUGIN ? pathToFileURL(process.env.XUPER_PLUGIN).href : "../src/plugin.js");

const BACKEND = "https://x.xkplugins.site";

/** A connected device: a fresh fake Kino with this runtime's Bearer memo cleared, then `bearer` stored and `identity` wired. */
async function device({ bearer = "old-bearer", identity, routes = [] } = {}) {
  const k = installKino({ storage: {}, routes });
  await P.screenEvent({ name: "disconnect", state: {} });
  if (bearer) k.store.set("o2:bearer", bearer);
  if (identity) k.kino.identity = { telegram: identity };
  k.requests.length = 0; k.writes.length = 0; k.logs.length = 0;
  return k;
}

/** Kino's identity answer for a signed install. */
const identityOk = (calls) => async (opts) => {
  calls.push(opts);
  return { id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" };
};

/** A backend that mints `newBearer` for any challenge + /session. */
function mintBackend(newBearer = "fresh-bearer") {
  const seen = [];
  const route = (url) => {
    if (!url.startsWith(BACKEND)) return undefined;
    const path = url.slice(BACKEND.length);
    seen.push(path);
    if (path === "/session/challenge") return res(200, JSON.stringify({ challenge: "c".repeat(32) }));
    if (path === "/session") return res(200, JSON.stringify({ session: newBearer }));
    return res(404, "");
  };
  return { route, seen };
}

test("reauth: mints a fresh session even with a Bearer stored, replaces it, stays connected", async () => {
  const ids = [];
  const be = mintBackend("fresh-bearer");
  const k = await device({ bearer: "stale-bearer", identity: identityOk(ids), routes: [be.route] });

  const out = await P.screenEvent({ name: "reauth", state: {} });

  assert.equal(ids.length, 1, "one identity call (reauth always mints, unlike ensureBearer)");
  assert.equal(k.store.get("o2:bearer"), "fresh-bearer", "the old session is replaced by the new one");
  assert.ok(be.seen.includes("/session/challenge") && be.seen.includes("/session"), "a full mint ran");
  assert.equal(out.toast.role, "success");
  assert.ok(out.state && out.state.actError === null, "no error state: Xuper stays connected");
});

test("reauth: identity off does NOT disconnect — keeps the session and shows the re-link-Telegram toast", async () => {
  const be = mintBackend();
  const refused = async () => { throw Object.assign(new Error("switched off"), { code: "permission_denied" }); };
  const k = await device({ bearer: "keep-bearer", identity: refused, routes: [be.route] });

  const out = await P.screenEvent({ name: "reauth", state: {} });

  assert.equal(k.store.get("o2:bearer"), "keep-bearer", "a failed reauth never drops the working session");
  assert.equal(out.toast.role, "error");
  assert.match(out.toast.text, /Revincula tu Telegram/, "the ES toast points at re-linking Telegram in Kino");
  assert.match(out.toast.textEn, /Re-link your Telegram/);
  assert.ok(!out.state || out.state.actError === undefined, "no welcome bounce: the person is still connected");
});

test("reauth: a backend failure shows a retry toast, not the identity one, and keeps the session", async () => {
  const ids = [];
  const down = (url) => url.startsWith(BACKEND) ? res(503, '{"detail":"down"}') : undefined;
  const k = await device({ bearer: "keep-bearer", identity: identityOk(ids), routes: [down] });

  const out = await P.screenEvent({ name: "reauth", state: {} });

  assert.equal(k.store.get("o2:bearer"), "keep-bearer");
  assert.equal(out.toast.role, "error");
  assert.match(out.toast.text, /Inténtalo de nuevo/, "a server failure is a retry, not a re-link message");
});
