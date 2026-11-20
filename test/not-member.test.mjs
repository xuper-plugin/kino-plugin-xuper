// not_member (3.1.2): the backend (oleada) answers 403 {"detail":"not_member"} when the person left the Kino Telegram
// group — at POST /session or on any authenticated endpoint (per-request membership enforcement). The plugin freezes:
// authed calls fail FAST with the "join the group" message, the screen shows the group gate, and only a successful
// sign-in (a rejoin → /session passes) lifts it. 403 "blocked" stays generic (no freeze). Written against the entry
// points, so it also runs against a built bundle:
//   XUPER_PLUGIN=/abs/path/plugin.js node --test test/not-member.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import(process.env.XUPER_PLUGIN ? pathToFileURL(process.env.XUPER_PLUGIN).href : "../src/plugin.js");
const api = await import("../src/api.js");

const BACKEND = "https://x.xkplugins.site";

/** Kino's identity answer for a signed install. */
const identityOk = () => async () => ({ id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" });

/** A backend whose /session answers `sessionStatus` (200 mints "fresh-bearer"), and every other path answers `otherStatus`. */
function backend({ sessionStatus = 200, otherStatus = 200, detail = "not_member" } = {}) {
  const seen = [];
  const route = (url) => {
    if (!url.startsWith(BACKEND)) return undefined;
    const path = url.slice(BACKEND.length);
    seen.push(path);
    if (path === "/session/challenge") return res(200, JSON.stringify({ challenge: "c".repeat(32) }));
    if (path === "/session") return sessionStatus === 200 ? res(200, JSON.stringify({ session: "fresh-bearer" })) : res(sessionStatus, JSON.stringify({ detail }));
    return otherStatus === 200 ? res(200, JSON.stringify({ ok: true })) : res(otherStatus, JSON.stringify({ detail }));
  };
  return { route, seen };
}

/** A fresh fake Kino with the api's Bearer memo + freeze cleared, then `bearer` stored and identity wired. */
async function freshKino({ bearer, routes = [] } = {}) {
  const k = installKino({ storage: {}, routes });
  await api.clearBearer();            // clears stored Bearer, memo, and the not_member freeze
  if (bearer) k.store.set("o2:bearer", bearer);
  k.kino.identity = { telegram: identityOk() };
  k.requests.length = 0; k.logs.length = 0;
  return k;
}

test("a 403 not_member at POST /session freezes and shows the group gate", async () => {
  const be = backend({ sessionStatus: 403 });
  await freshKino({ routes: [be.route] });   // no Bearer: Activate mints

  const out = await P.screenEvent({ name: "activate", state: {} });

  assert.equal(out.state.actError, "member", "the welcome shows the group gate, not a generic error");
  assert.equal(api.notMemberActive(), true, "the freeze is set");
  assert.equal(await api.currentBearer(), null, "a failed mint stores no Bearer");
});

test("a 403 not_member on an authenticated call freezes; then authed calls fail FAST with no request", async () => {
  const be = backend({ otherStatus: 403 });
  const k = await freshKino({ bearer: "live-bearer", routes: [be.route] });

  await assert.rejects(api.authed("POST", "/resolve/abc", {}, 5000), (e) => api.isNotMember(e), "the 403 surfaces as not_member");
  assert.equal(api.notMemberActive(), true, "the freeze is set from the per-request 403");
  assert.equal(k.requests.length, 1, "exactly one request reached the backend");

  await assert.rejects(api.authed("POST", "/resolve/def", {}, 5000), (e) => api.isNotMember(e), "still not_member");
  assert.equal(k.requests.length, 1, "frozen: the second call never left the device (fail fast)");
  assert.equal(await api.currentBearer(), "live-bearer", "a 403 never drops the Bearer (unlike a 401)");
});

test("a successful sign-in (a rejoin) lifts the freeze", async () => {
  const be = backend({ otherStatus: 403 });
  await freshKino({ bearer: "live-bearer", routes: [be.route] });
  await assert.rejects(api.authed("POST", "/resolve/abc", {}, 5000));
  assert.equal(api.notMemberActive(), true);

  // They rejoined → /session passes now (the same runtime; reauth mints a fresh session).
  const ok = backend({ sessionStatus: 200 });
  const k = installKino({ storage: { "o2:notmember": "1", "o2:bearer": "live-bearer" }, routes: [ok.route] });
  k.kino.identity = { telegram: identityOk() };
  const out = await P.screenEvent({ name: "reauth", state: {} });

  assert.equal(out.toast.role, "success");
  assert.equal(api.notMemberActive(), false, "a successful /session lifted the freeze");
  assert.equal(await api.currentBearer(), "fresh-bearer");
});

test("403 blocked stays generic: no freeze, Bearer kept", async () => {
  const be = backend({ otherStatus: 403, detail: "blocked" });
  const k = await freshKino({ bearer: "live-bearer", routes: [be.route] });

  await assert.rejects(api.authed("POST", "/resolve/abc", {}, 5000), (e) => !api.isNotMember(e) && Number(e.status) === 403);
  assert.equal(api.notMemberActive(), false, "blocked does NOT freeze");
  assert.equal(await api.currentBearer(), "live-bearer", "blocked never drops the Bearer");
});

test("clearBearer (Desconectar) also lifts the freeze", async () => {
  installKino({ storage: { "o2:notmember": "1", "o2:bearer": "b" } });
  assert.equal(api.notMemberActive(), true);
  await api.clearBearer();
  assert.equal(api.notMemberActive(), false);
});

test("the pieces: isNotMember, the message, the group URL, the banner", () => {
  installKino({ storage: {} });
  const e = Object.assign(new Error("x"), { status: 403, detail: "not_member" });
  assert.equal(api.isNotMember(e), true);
  assert.equal(api.isNotMember(Object.assign(new Error("x"), { status: 403, detail: "blocked" })), false);
  assert.equal(api.activateBanner(e), "member");
  assert.match(api.notMemberText("es"), /grupo de Kino/i);
  assert.match(api.notMemberText("en"), /Kino group/i);
  assert.match(api.KINO_GROUP_URL, /^https:\/\/t\.me\//);
});
