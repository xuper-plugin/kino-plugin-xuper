// A linked account's dead session (port of main 2d285106 + 6ea24757, MagisSession.withValidSession):
// one more REAL login when the renewal's own login failed transiently (network, or the portal
// answering "not logged in" to the login), one more login + try when the account is still dead
// right after a renewal, never a second login for a refused credential or an account open on
// another device, and the account sentences the native bridge shows. Real portal + session over a
// scripted fetch (test/helpers/portalWorld.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { portalWorld, STORED } from "./helpers/portalWorld.mjs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { mapPortalError, ACCOUNT_SESSION_LOST, ACCOUNT_IN_USE_ELSEWHERE_TEXT } from "../src/portal.js";

const EMAIL = "ana@x.test";
const PW = "stand-in-pw";
const DEAD = { returnCode: "aaa100028", errorMessage: "未登录" };
const ELSEWHERE = { returnCode: "aaa100083", errorMessage: "您的账号已经在其他设备登录" };
const query = { q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 };
const found = { searchItemList: [{ itemList: [{ contentId: "D1", name: "Dune Test", programType: "movie" }] }] };

// The account is linked and its token is the stored one (`acct` = its key).
function linked(routes) {
  const w = portalWorld({ hosts: ["a.test"], config: { email: EMAIL, password: PW }, routes });
  w.kino.storage.set("session", JSON.stringify({ ...STORED, userToken: "tok-old", acct: w.session.accountKey(EMAIL, PW) }));
  assert.equal(w.session.kind(), "account");
  return w;
}

// Logins answer these in order (an Error = no answer at all), then the last one again.
function logins(...answers) {
  let i = 0;
  return () => answers[Math.min(i++, answers.length - 1)];
}

const authWith = (text) => (e) => {
  assert.equal(e.name, "KinoError_auth_required", e.message);
  assert.equal(e.userMessage, text);
  return true;
};

test("the native account sentences, pointing to the plugin's own settings tab", () => {
  assert.equal(ACCOUNT_SESSION_LOST,
    "Tu sesión de Xuper se cerró y no pudimos volver a entrar con tu cuenta. Vuelve a vincularla en Ajustes ▸ Xuper.");
  assert.equal(ACCOUNT_IN_USE_ELSEWHERE_TEXT,
    "Tu cuenta de Xuper se abrió en otro dispositivo, y solo puede usarse en uno a la vez. Vuelve a intentarlo, o vincúlala de nuevo en Ajustes ▸ Xuper.");
});

test("mapPortalError: with a linked account the session codes and aaa100083 ask to re-link; without one they keep the old mapping", () => {
  const kino = fakeKino();
  for (const code of ["aaa100027", "aaa100028"]) {
    const e = mapPortalError(code, "未登录", kino, { accountLinked: true });
    assert.equal(e.name, "KinoError_auth_required");
    assert.equal(e.userMessage, ACCOUNT_SESSION_LOST);
    assert.equal(mapPortalError(code, "未登录", kino).message, "Configura Xuper en Ajustes ▸ Plugins");
  }
  const elsewhere = mapPortalError("aaa100083", "x", kino, { accountLinked: true });
  assert.equal(elsewhere.name, "KinoError_auth_required");
  assert.equal(elsewhere.userMessage, ACCOUNT_IN_USE_ELSEWHERE_TEXT);
  assert.equal(mapPortalError("aaa100083", "x", kino).name, "KinoError_unavailable");
});

test("the renewal's login gets no answer: one more real login, and the call is served", async () => {
  const w = linked({
    "v8/login": logins(new Error("offline"), { userId: "u-acct", userToken: "tok-new" }),
    "v3/searchByName": (bean) => (bean.userToken === "tok-new" ? found : DEAD),
  });
  const out = await w.catalog.search(query);
  assert.equal(out[0].id, "D1");
  assert.deepEqual(w.paths(), ["v3/searchByName", "v8/login", "v8/login", "v3/searchByName"]);
  assert.equal(w.stored().userToken, "tok-new");
});

test("the portal answers \"not logged in\" to the renewal's login itself: one more login, and it is not remembered as a refusal", async () => {
  const w = linked({
    "v8/login": logins(DEAD, { userId: "u-acct", userToken: "tok-new" }),
    "v3/searchByName": (bean) => (bean.userToken === "tok-new" ? found : DEAD),
  });
  assert.equal((await w.catalog.search(query))[0].id, "D1");
  assert.deepEqual(w.paths(), ["v3/searchByName", "v8/login", "v8/login", "v3/searchByName"]);
  assert.equal(w.session.accountState(), "held");
});

test("a refused credential is never logged in twice", async () => {
  const w = linked({
    "v8/login": logins({ returnCode: "aaa100099", errorMessage: "contraseña" }),
    "v3/searchByName": (bean) => (bean.userToken === "tok-new" ? found : DEAD),
  });
  await w.catalog.search(query).catch(() => {});
  assert.equal(w.paths().filter((p) => p === "v8/login").length, 1);
});

test("the account opened on another device: no second login (it would only fight the other device), and the person is told so", async () => {
  const w = linked({ "v8/login": logins(ELSEWHERE), "v3/searchByName": DEAD });
  await assert.rejects(w.catalog.search(query), authWith(ACCOUNT_IN_USE_ELSEWHERE_TEXT));
  assert.deepEqual(w.paths(), ["v3/searchByName", "v8/login"]);
});

test("still \"not logged in\" right after a renewal: one more real login and one more try", async () => {
  let n = 0;
  const w = linked({
    "v8/login": () => ({ userId: "u-acct", userToken: "tok-acct" + ++n }),
    "v3/searchByName": (bean) => (bean.userToken === "tok-acct2" ? found : DEAD),
  });
  assert.equal((await w.catalog.search(query))[0].id, "D1");
  assert.deepEqual(w.paths(), ["v3/searchByName", "v8/login", "v3/searchByName", "v8/login", "v3/searchByName"]);
});

test("a linked account still dead after every re-login says to re-link it, after a bounded number of logins", async () => {
  const w = linked({ "v8/login": () => ({ userId: "u-acct", userToken: "tok-acct" }), "v3/searchByName": DEAD });
  await assert.rejects(w.catalog.search(query), authWith(ACCOUNT_SESSION_LOST));
  assert.deepEqual(w.paths(), ["v3/searchByName", "v8/login", "v3/searchByName", "v8/login", "v3/searchByName"]);
});

test("a content call answering aaa100083 on a linked account says the account is open elsewhere", async () => {
  const w = linked({ "v8/login": () => ({ userId: "u-acct", userToken: "tok-acct" }), "v3/searchByName": ELSEWHERE });
  await assert.rejects(w.catalog.search(query), authWith(ACCOUNT_IN_USE_ELSEWHERE_TEXT));
});

test("without an account, \"not logged in\" keeps its old message (the seed rescue owns that case)", async () => {
  const w = portalWorld({ hosts: ["a.test"], seedsText: "[]", routes: { "v3/searchByName": DEAD } });
  // No sentence of its own: the person reads Kino's line for auth_required.
  await assert.rejects(w.catalog.search(query), (e) => {
    assert.equal(e.name, "KinoError_auth_required");
    assert.equal(e.message, "Configura Xuper en Ajustes ▸ Plugins");
    assert.equal(e.userMessage, undefined);
    return true;
  });
  assert.equal(w.paths().filter((p) => p === "v8/login").length, 0);
});

test("a live channel on a linked account still dead after the re-logins keeps the account sentence", async () => {
  const w = linked({ "v8/login": () => ({ userId: "u-acct", userToken: "tok-acct" }), "v4/startPlayLive": DEAD });
  await assert.rejects(w.resolve.resolve("cyx-RCNHD"), authWith(ACCOUNT_SESSION_LOST));
});

// ---- review I1/M1: the SHARED account keeps its old fallback chain and never gets "re-link" sentences ----

const SHARED = { email: "compartida@x.test", password: "stand-in-shared" };
function onShared(routes) {
  const w = portalWorld({ hosts: ["a.test"], shared: SHARED, config: { useSharedAccount: true }, seedsText: "[]", routes });
  w.kino.storage.set("session", JSON.stringify({ ...STORED, userToken: "tok-sh", acct: "shared" }));
  assert.equal(w.session.usingShared(), true);
  return w;
}
const notAnAccountSentence = (e) => {
  assert.ok(e.name.startsWith("KinoError_"), e.message);
  for (const t of [e.message, e.userMessage]) assert.ok(t !== ACCOUNT_SESSION_LOST && t !== ACCOUNT_IN_USE_ELSEWHERE_TEXT, e.message);
  return true;
};

test("shared account: a renewal login answered aaa100083 or \"not logged in\" falls back to the anonymous session, which serves the call", async () => {
  for (const answer of [ELSEWHERE, DEAD]) {
    const w = onShared({
      "v8/login": logins(answer),
      "v3/searchByName": (bean) => (bean.userToken === "tok-new" ? found : DEAD),
    });
    const out = await w.catalog.search(query);
    assert.equal(out[0].id, "D1", answer.returnCode);
    assert.equal(w.paths().filter((p) => p === "v8/login").length, 1, "no second login on the shared pair");
    assert.ok(w.paths().includes("v8/active"), "the anonymous session took over");
  }
});

test("own account, same aaa100083 renewal answer: the native account sentence (unchanged)", async () => {
  const w = linked({ "v8/login": logins(ELSEWHERE), "v3/searchByName": (bean) => (bean.userToken === "tok-new" ? found : DEAD) });
  await assert.rejects(w.catalog.search(query), authWith(ACCOUNT_IN_USE_ELSEWHERE_TEXT));
});

test("shared account still dead after its renewal, or answered aaa100083 on content: never a \"re-link\" sentence", async () => {
  const dead = onShared({ "v8/login": () => ({ userId: "u-sh", userToken: "tok-sh2" }), "v3/searchByName": DEAD });
  await assert.rejects(dead.catalog.search(query), notAnAccountSentence);
  assert.equal(dead.paths().filter((p) => p === "v8/login").length, 1, "no extra login on the shared pair");
  const elsewhere = onShared({ "v8/login": () => ({ userId: "u-sh", userToken: "tok-sh2" }), "v3/searchByName": ELSEWHERE });
  await assert.rejects(elsewhere.catalog.search(query), notAnAccountSentence);
});
