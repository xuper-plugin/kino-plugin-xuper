// The account side of the plugin over a scripted portal: the REAL makePortal + makeCrypto + makeSession +
// makeRegistration + makeSettings, as src/plugin.js builds them for the settings form and the configuration screen.
// Requests are decrypted with the stand-in key; answers go out plain ({ returnCode: "0", ...fields }), which the portal
// accepts as is. `saved` is a plain map the test edits like Kino's settings store (the kit's config is frozen).
import { fakeKino } from "./fakeKino.mjs";
import { makeCrypto } from "../../src/crypto.js";
import { makePortal } from "../../src/portal.js";
import { makeSession } from "../../src/session.js";
import { makeSettings } from "../../src/settings.js";
import { makeRegistration } from "../../src/registration.js";

export const STORED = { userId: "u-old", userToken: "tok-old", jwtToken: "", sn: "sn-old", acct: "" };
export const SHARED = { email: "shared@pool.test", password: "stand-in-shared-pw" };
const reply = (obj) => ({ ok: true, status: 200, text: () => JSON.stringify(obj) });
const hexToText = (hex) => Buffer.from(hex, "hex").toString("utf8");

export const goodRoutes = (over = {}) => ({
  "v3/snToken": { snToken: "SNTOK-P" },
  "v8/active": { userId: "u-pend", userToken: "tok-pend", jwtToken: "" },
  "v2/sendEmailVerifyCode": {},
  "v2/validateVerifyCode": {},
  "v2/bindEmail": {},
  "v8/login": { userId: "u-new", userToken: "tok-new", jwtToken: "jwt-new" },
  "v5/loginOut": {},
  ...over,
});
export const refuse = (errorMessage = "no") => ({ returnCode: "aaa100099", errorMessage });

/**
 * `routes`: portal path -> answer | (bean, req) => answer (an Error throws, `{ returnCode }` is a portal error).
 * `saved`: the settings. `seeds`: the stored pool; `seedsAnswer`: what the pool URL answers (a function may throw).
 * `requestMs`: what an answered request costs on the injected clock. `lang`: Kino's language.
 */
export function accountWorld({
  routes = goodRoutes(), saved = {}, session = STORED, seeds = null, seedsAnswer = null, requestMs = 100, lang = "es-CO",
  appVersion = "0.9.74", storageExtra = {},
} = {}) {
  const clock = { t: 5_000_000, now() { return this.t; } };
  const requests = [];
  const seedDownloads = [];
  const base = fakeKino({ config: {} });
  const decrypt = (wire) => base.crypto.decrypt("des-ede3-ecb", { key: base.secret("magisKey"), data: hexToText(wire), padding: "pkcs7" });
  const config = Object.freeze({ get: (k) => saved[k], all: () => ({ ...saved }) });
  const logs = [];
  const log = Object.assign((...a) => logs.push(a.map(String).join(" ")), { report: (...a) => logs.push(a.map(String).join(" ")) });
  const kino = Object.freeze({
    ...base, config, lang, appVersion, log, sleep: async () => {},
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      if (u.host === "raw.githubusercontent.com") {
        seedDownloads.push({ at: clock.t, timeoutMs: opts.timeoutMs });
        clock.t += requestMs;
        if (typeof seedsAnswer === "function") return seedsAnswer();
        return seedsAnswer ?? { ok: true, status: 200, text: () => "[]" };
      }
      const path = u.pathname.replace("/api/portalCore/", "");
      const bean = JSON.parse(decrypt(opts.body));
      const req = { path, bean, timeoutMs: opts.timeoutMs, at: clock.t };
      requests.push(req);
      const route = routes[path];
      if (route === undefined) throw new Error("unscripted portal path " + path);
      const out = typeof route === "function" ? route(bean, req, clock) : route;
      clock.t += requestMs;
      if (out instanceof Error) throw out;
      if (out && out.returnCode !== undefined) return reply(out);
      return reply({ returnCode: "0", ...out });
    },
  });
  if (session) base.storage.set("session", JSON.stringify(session));
  if (seeds) base.storage.set("seeds", JSON.stringify(seeds));
  for (const [k, v] of Object.entries(storageExtra)) base.storage.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const crypto = makeCrypto(kino);
  let sess = null;
  const portal = makePortal({ kino, crypto, clock, snProvider: () => sess.current().sn, config: { hosts: ["h1.test"], appId: "app-1", apkVersion: "9.9" } });
  sess = makeSession({ kino, portal, clock, random: () => 0, shared: SHARED });
  const registration = makeRegistration({ kino, portal, session: sess, clock });
  const settings = makeSettings({ kino, session: sess, clock, registration });
  return {
    kino, base, clock, saved, requests, seedDownloads, logs, portal, session: sess, registration, settings,
    paths: () => requests.map((r) => r.path),
    stored: () => JSON.parse(base.storage.get("session")),
  };
}
