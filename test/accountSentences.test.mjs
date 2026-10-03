// Task 16 (plugin 2.0): the sentences the person reads go through `kino.error(code, message,
// { userMessage })` and pass the app's sentence filter (the kit's shownSentence mirrors it); the
// account sentences send the person to the plugin's own settings tab ("Ajustes ▸ Plugins ▸ Xuper"),
// never to the app's old "Ajustes, Cuenta"; and the SHARED account never gets a re-link sentence:
// its refused or dead session falls to the anonymous session / seeds (Ruling R33), and what is left
// is the generic `unavailable`. Real portal + session over a scripted fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { portalWorld, STORED } from "./helpers/portalWorld.mjs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { shownSentence } from "../sdk/kino-shim.mjs";
import {
  mapPortalError, ACCOUNT_SESSION_LOST, ACCOUNT_IN_USE_ELSEWHERE_TEXT, EPISODE_GONE, SERIES_GONE, PortalError,
} from "../src/portal.js";
import { makeLive } from "../src/live.js";
import { encode, encodeChapter } from "../src/refs.js";

const ROOT = new URL("../", import.meta.url);
const contract = JSON.parse(readFileSync(new URL("contract.json", ROOT), "utf8"));
const MAX = contract.errors.maxUserMessageChars;
const PLACE = "Ajustes ▸ Plugins ▸ Xuper";

const EMAIL = "ana@x.test";
const PW = "stand-in-pw";
const DEAD = { returnCode: "aaa100028", errorMessage: "未登录" };
const ELSEWHERE = { returnCode: "aaa100083", errorMessage: "您的账号已经在其他设备登录" };
const GONE = { returnCode: "portal100006", errorMessage: "剧集不存在" };
const query = { q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 };
const found = { searchItemList: [{ itemList: [{ contentId: "D1", name: "Dune Test", programType: "movie" }] }] };
const NO_ACCOUNT_TEXT = "Este canal necesita una cuenta de Xuper (para películas y series no hace falta). Vincúlala en Ajustes ▸ Plugins ▸ Xuper.";

function linked(routes) {
  const w = portalWorld({ hosts: ["a.test"], config: { email: EMAIL, password: PW }, routes });
  w.kino.storage.set("session", JSON.stringify({ ...STORED, userToken: "tok-old", acct: w.session.accountKey(EMAIL, PW) }));
  return w;
}
const SHARED = { email: "compartida@x.test", password: "stand-in-shared" };
function onShared(routes) {
  const w = portalWorld({ hosts: ["a.test"], shared: SHARED, config: { useSharedAccount: true }, seedsText: "[]", routes });
  w.kino.storage.set("session", JSON.stringify({ ...STORED, userToken: "tok-sh", acct: "shared" }));
  assert.equal(w.session.usingShared(), true);
  return w;
}
const logins = (...answers) => { let i = 0; return () => answers[Math.min(i++, answers.length - 1)]; };

/** The error is `code`, carries `sentence` as its userMessage, and the app would show it. */
const shows = (code, sentence) => (e) => {
  assert.equal(e.name, "KinoError_" + code, e.message);
  assert.equal(e.userMessage, sentence);
  assert.equal(shownSentence(e), sentence, "the app's filter lets it through");
  return true;
};
/** The shared account's failure: generic `unavailable`, nothing about linking or the account. */
const noRelink = (e) => {
  assert.equal(e.name, "KinoError_unavailable", e.message);
  for (const text of [e.message, e.userMessage ?? ""]) assert.doesNotMatch(text, /vincul|cuenta|otro dispositivo/i);
  return true;
};

test("no sentence anywhere in the bundle or the sources sends the person to Ajustes, Cuenta", () => {
  // `ok(!includes)`, not doesNotMatch: a failure must not print the whole bundle.
  assert.ok(!readFileSync(new URL("plugin.js", ROOT), "utf8").includes("Ajustes, Cuenta"), "plugin.js");
  for (const f of readdirSync(new URL("src/", ROOT))) {
    assert.ok(!readFileSync(new URL("src/" + f, ROOT), "utf8").includes("Ajustes, Cuenta"), f);
  }
});

test("every person-facing sentence fits the contract and passes the app's filter", () => {
  const kino = fakeKino();
  for (const s of [ACCOUNT_SESSION_LOST, ACCOUNT_IN_USE_ELSEWHERE_TEXT, EPISODE_GONE, SERIES_GONE, NO_ACCOUNT_TEXT]) {
    assert.ok(s.length <= MAX, `${s.length} > ${MAX}: ${s}`);
    assert.equal(shownSentence(kino.error("auth_required", "x", { userMessage: s })), s);
  }
  for (const s of [ACCOUNT_SESSION_LOST, ACCOUNT_IN_USE_ELSEWHERE_TEXT]) assert.ok(s.includes(PLACE), s);
});

test("mapPortalError: the own account's session codes and aaa100083 carry the sentence as userMessage", () => {
  const kino = fakeKino();
  for (const code of ["aaa100027", "aaa100028"]) {
    shows("auth_required", ACCOUNT_SESSION_LOST)(mapPortalError(code, "未登录", kino, { accountLinked: true }));
  }
  shows("auth_required", ACCOUNT_IN_USE_ELSEWHERE_TEXT)(mapPortalError("aaa100083", "x", kino, { accountLinked: true }));
});

test("mapPortalError: on the shared account the same codes are the generic unavailable, with no re-link sentence", () => {
  const kino = fakeKino();
  for (const code of ["aaa100027", "aaa100028", "aaa100083"]) noRelink(mapPortalError(code, "未登录", kino, { sharedAccount: true }));
});

test("mapPortalError: portal100006 carries the chapter (or series) sentence as userMessage", () => {
  const kino = fakeKino();
  shows("not_found", EPISODE_GONE)(mapPortalError("portal100006", "剧集不存在", kino));
  shows("not_found", SERIES_GONE)(mapPortalError("portal100006", "剧集不存在", kino, { goneMessage: SERIES_GONE }));
});

test("own account opened on another device: auth_required whose userMessage points to the plugin's tab", async () => {
  const w = linked({ "v8/login": logins(ELSEWHERE), "v3/searchByName": DEAD });
  await assert.rejects(w.catalog.search(query), shows("auth_required", ACCOUNT_IN_USE_ELSEWHERE_TEXT));
  const content = linked({ "v8/login": () => ({ userId: "u-acct", userToken: "tok-acct" }), "v3/searchByName": ELSEWHERE });
  await assert.rejects(content.catalog.search(query), shows("auth_required", ACCOUNT_IN_USE_ELSEWHERE_TEXT));
});

test("own account still dead after every re-login: the re-link sentence as userMessage", async () => {
  const w = linked({ "v8/login": () => ({ userId: "u-acct", userToken: "tok-acct" }), "v3/searchByName": DEAD });
  await assert.rejects(w.catalog.search(query), shows("auth_required", ACCOUNT_SESSION_LOST));
  const live = linked({ "v8/login": () => ({ userId: "u-acct", userToken: "tok-acct" }), "v4/startPlayLive": DEAD });
  await assert.rejects(live.resolve.resolve("cyx-RCNHD"), shows("auth_required", ACCOUNT_SESSION_LOST));
});

test("shared account, aaa100083 or dead on the renewal's login: falls to the anonymous session (R33), which serves", async () => {
  for (const answer of [ELSEWHERE, DEAD]) {
    const w = onShared({ "v8/login": logins(answer), "v3/searchByName": (bean) => (bean.userToken === "tok-new" ? found : DEAD) });
    assert.equal((await w.catalog.search(query))[0].id, "D1", answer.returnCode);
    assert.ok(w.paths().includes("v8/active"), "the anonymous session took over");
  }
});

test("shared account still dead, or aaa100083 on content, with no seed to fall to: generic unavailable, never a re-link sentence", async () => {
  const dead = onShared({ "v8/login": () => ({ userId: "u-sh", userToken: "tok-sh2" }), "v3/searchByName": DEAD });
  await assert.rejects(dead.catalog.search(query), noRelink);
  const elsewhere = onShared({ "v8/login": () => ({ userId: "u-sh", userToken: "tok-sh2" }), "v3/searchByName": ELSEWHERE });
  await assert.rejects(elsewhere.catalog.search(query), noRelink);
  const live = onShared({ "v8/login": () => ({ userId: "u-sh", userToken: "tok-sh2" }), "v4/startPlayLive": DEAD });
  await assert.rejects(live.resolve.resolve("cyx-RCNHD"), noRelink);
});

test("a gone chapter, title or series: not_found with the sentence as userMessage", async () => {
  const chapter = portalWorld({ hosts: ["a.test"], routes: { "v4/getItemData": GONE } });
  await assert.rejects(chapter.resolve.resolve(encodeChapter(3, "S1")), shows("not_found", EPISODE_GONE));
  const title = portalWorld({ hosts: ["a.test"], routes: { "v10/startPlayVOD": GONE } });
  await assert.rejects(title.resolve.resolve(encode({ contentId: "M1", programType: "movie" })), shows("not_found", EPISODE_GONE));
  const series = portalWorld({ hosts: ["a.test"], routes: { "v4/getItemData": GONE } });
  await assert.rejects(series.catalog.episodes(encode({ contentId: "S1", programType: "teleplay" })), shows("not_found", SERIES_GONE));
});

test("a channel that needs an account (no account in use): its sentence is a userMessage", async () => {
  const kino = fakeKino();
  const portal = { async call(path) { if (path === "v4/startPlayLive") throw new PortalError("aaa100028", "未登录！"); throw new Error(path); } };
  const session = { ensure: async () => {}, withValidSession: async (block) => block({ userId: "u", userToken: "t" }), kind: () => "anonymous", current: () => ({ sn: "sn" }), seedPool: () => [] };
  const live = makeLive({ kino, portal, session, clock: { now: () => 1_000_000 }, config: { apkVersion: "49902" }, random: () => 0 });
  await assert.rejects(live.resolveLive("c"), shows("auth_required", NO_ACCOUNT_TEXT));
});
