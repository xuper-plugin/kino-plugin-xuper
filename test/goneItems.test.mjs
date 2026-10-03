// A gone item (port of main 2d285106, XuperErrorMapping): the portal's `portal100006` ("剧集不存在",
// the series behind a chapter is gone) says so in Spanish, word for word as the native bridge:
// "Este capítulo ya no está disponible." for a playback, "Esta serie ya no está disponible." for
// the chapter list. Real portal + session over a scripted fetch (test/helpers/portalWorld.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { portalWorld } from "./helpers/portalWorld.mjs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { mapPortalError, EPISODE_GONE, SERIES_GONE } from "../src/portal.js";
import { encode, encodeChapter } from "../src/refs.js";

const GONE = { returnCode: "portal100006", errorMessage: "剧集不存在" };
const goneWith = (text) => (e) => {
  assert.equal(e.name, "KinoError_not_found", e.message);
  assert.equal(e.message, text);
  return true;
};

test("the native sentences, word for word", () => {
  assert.equal(EPISODE_GONE, "Este capítulo ya no está disponible.");
  assert.equal(SERIES_GONE, "Esta serie ya no está disponible.");
});

test("mapPortalError: portal100006 is not_found with the chapter sentence by default, the series one when asked; portal100004 unchanged", () => {
  const kino = fakeKino();
  const chapter = mapPortalError("portal100006", "剧集不存在", kino);
  assert.equal(chapter.name, "KinoError_not_found");
  assert.equal(chapter.message, EPISODE_GONE);
  assert.equal(mapPortalError("portal100006", "剧集不存在", kino, { goneMessage: SERIES_GONE }).message, SERIES_GONE);
  assert.equal(mapPortalError("portal100004", "不存在", kino).message, "No se encontró en Xuper");
});

test("playing a chapter of a gone series says the chapter is no longer available", async () => {
  const w = portalWorld({ hosts: ["a.test"], routes: { "v4/getItemData": GONE } });
  await assert.rejects(w.resolve.resolve(encodeChapter(3, "S1")), goneWith(EPISODE_GONE));
});

test("playing a gone title (startPlayVOD answers portal100006) says the same", async () => {
  const w = portalWorld({ hosts: ["a.test"], routes: { "v10/startPlayVOD": GONE } });
  await assert.rejects(w.resolve.resolve(encode({ contentId: "M1", programType: "movie" })), goneWith(EPISODE_GONE));
});

test("listing the chapters of a gone series says the series is no longer available", async () => {
  const w = portalWorld({ hosts: ["a.test"], routes: { "v4/getItemData": GONE } });
  await assert.rejects(w.catalog.episodes(encode({ contentId: "S1", programType: "teleplay" })), goneWith(SERIES_GONE));
});

test("a live channel keeps its own not-found sentence", async () => {
  const w = portalWorld({ hosts: ["a.test"], routes: { "v4/startPlayLive": GONE } });
  await assert.rejects(w.resolve.resolve("cyx-RCNHD"), (e) => e.name === "KinoError_not_found" && e.message !== EPISODE_GONE);
});
