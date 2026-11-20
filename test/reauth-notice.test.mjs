// Xuper 3.1.1: the proactive Home-bell reminder to reautenticate. A scheduled job (capability "schedule") mirrors a stored
// flag to the bell (capability "notifications"), so a stuck access reaches the person without opening Xuper. Written
// against the entry points only, so it also runs against a built bundle:
//   XUPER_PLUGIN=/abs/path/plugin.js node --test test/reauth-notice.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { installKino } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import(process.env.XUPER_PLUGIN ? pathToFileURL(process.env.XUPER_PLUGIN).href : "../src/plugin.js");
const api = await import("../src/api.js");

/** Adds a kino.notifications stand-in to the fake Kino and records its calls. */
function withNotifications(k) {
  const posts = [], clears = [];
  k.kino.notifications = {
    post: async (o) => { posts.push(o); return "{}"; },
    clear: async (id) => { clears.push(id ?? null); return "{}"; },
  };
  return { posts, clears };
}

test("the job posts a Home-bell notice while a re-activation needs the person, and clears it otherwise", async () => {
  const k = installKino({ storage: {} });
  const { posts, clears } = withNotifications(k);
  api.clearReauthNeeded();

  // No flag: the job clears any stale notice, posts nothing.
  await P.job();
  assert.equal(posts.length, 0);
  assert.equal(clears.at(-1), "reauth");

  // A user-actionable failure marked the flag: the job posts the reminder, opening Xuper's screen on a tap.
  api.markReauthNeeded("consent");
  assert.equal(api.reauthNeeded(), true);
  await P.job();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "reauth");
  assert.match(posts[0].title, /Reaut/);
  assert.ok(posts[0].titleEn && posts[0].textEn, "carries English too");
  assert.deepEqual(posts[0].go, { screen: {} });

  // Signed in again (flag cleared): the job removes the notice.
  api.clearReauthNeeded();
  await P.job();
  assert.equal(posts.length, 1, "no second post");
  assert.equal(clears.at(-1), "reauth");
});

test("markReauthNeeded marks ONLY causes the person must act on", () => {
  installKino({ storage: {} });
  api.clearReauthNeeded();
  api.markReauthNeeded("server"); assert.equal(api.reauthNeeded(), false, "a transient server error is not a reminder");
  api.markReauthNeeded("consent"); assert.equal(api.reauthNeeded(), true, "identity off / needs re-link");
  api.clearReauthNeeded();
  api.markReauthNeeded("update"); assert.equal(api.reauthNeeded(), true, "an old Kino");
});

test("the job never throws when kino.notifications is absent (older Kino / permission off)", async () => {
  const k = installKino({ storage: {} });
  delete k.kino.notifications;
  api.markReauthNeeded("consent");
  await assert.doesNotReject(P.job());
});

test("the manifest declares schedule + notifications with the reauth-check job, and the plugin exports job", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.ok(m.capabilities.includes("notifications"), "notifications capability");
  assert.ok(m.capabilities.includes("schedule"), "schedule capability");
  assert.equal(m.jobs.length, 1);
  assert.equal(m.jobs[0].id, "reauth-check");
  assert.match(m.jobs[0].id, /^[a-z0-9-]{1,24}$/);
  assert.ok(m.jobs[0].label.es.length >= 1 && m.jobs[0].label.es.length <= 40);
  assert.ok(m.jobs[0].everyOptions.includes(m.jobs[0].everyMin), "everyMin is one of everyOptions");
  assert.ok(m.jobs[0].everyMin >= 15 && m.jobs[0].everyMin <= 1440);
  assert.equal(typeof P.job, "function", "plugin exports job");
});
