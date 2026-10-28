// The configuration screen reaches Kino through `enhancements."14"` only: the plugin keeps apiVersion 8, its base settings
// list (the old form) is exactly 2.2.33's, and the enhanced list is the same keys with the same types, in the same order,
// with English texts added. An older Kino never reads the block; a Kino of apiVersion 14 merges it and never drops it.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateManifest, validateManifestWithoutEnhancements, settingsApiVersion } from "../sdk/contract.mjs";

const TEXT = readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8");
const M = JSON.parse(TEXT);
const BLOCK = M.enhancements["14"];
// sha256 of JSON.stringify(settings) in 2.2.33's manifest (c7b1929).
const BASE_SETTINGS_SHA = "937cab177137dd3079fab7dbedfb6d186167da7e7294a01d9c997ef5a12ea636";
const ENGLISH = new Set(["labelEn", "hintEn", "confirmEn"]);

test("the plugin keeps apiVersion 8 and its base settings list is 2.2.33's, byte for byte", () => {
  assert.equal(M.apiVersion, 8);
  assert.equal(createHash("sha256").update(JSON.stringify(M.settings)).digest("hex"), BASE_SETTINGS_SHA);
  assert.equal(M.settings.length, 20);
  assert.deepEqual(Object.keys(M.enhancements), ["14"]);
});

test("the enhanced list is the base list (same keys, order, types, Spanish texts, defaults, options) plus English only", () => {
  const base = M.settings;
  const enh = BLOCK.settings;
  assert.deepEqual(enh.map((s) => s.key), base.map((s) => s.key), "same keys in the same order, none added or left out");
  for (const [i, s] of enh.entries()) {
    const b = base[i];
    assert.equal(s.type, b.type, s.key);
    const stripped = Object.fromEntries(Object.entries(s).filter(([k]) => !ENGLISH.has(k)));
    if (stripped.options) stripped.options = stripped.options.map(({ labelEn, ...o }) => o);
    assert.deepEqual(stripped, b, `${s.key}: only English texts are added`);
    assert.equal(typeof s.labelEn, "string", `${s.key} has an English label`);
    if (b.hint !== undefined) assert.equal(typeof s.hintEn, "string", `${s.key} has an English hint`);
    if (b.confirm !== undefined) assert.equal(typeof s.confirmEn, "string", `${s.key} has an English confirm`);
    for (const forbidden of ["sync", "devices", "unlockWith", "required", "linkOnly"]) assert.equal(s[forbidden], undefined, `${s.key}.${forbidden}`);
    for (const t of [s.labelEn, s.hintEn, s.confirmEn].filter(Boolean)) assert.ok(t.length <= 80, `${s.key}: "${t}" fits 80`);
  }
  const country = enh.find((s) => s.key === "homeCountry");
  assert.ok(country.options.every((o) => typeof o.labelEn === "string" && o.labelEn !== ""));
});

test("the block adds only the screen, opened from the plugin's settings page, the old form still shown beside it", () => {
  assert.deepEqual(Object.keys(BLOCK).sort(), ["capabilities", "screen", "settings"]);
  assert.deepEqual(BLOCK.capabilities, ["screen"]);
  assert.deepEqual(BLOCK.screen.opensFrom, ["settings"]);
  assert.equal(BLOCK.screen.settingsIn, "both");
  assert.equal(BLOCK.screen.menuOpens, undefined, "the menu keeps opening the section");
  assert.ok(BLOCK.screen.label.length <= 20 && BLOCK.screen.labelEn.length <= 20);
  assert.ok(BLOCK.screen.settingsButton.label.length <= 40 && BLOCK.screen.settingsButton.labelEn.length <= 40);
  assert.equal(M.capabilities.includes("screen"), false, "never a base capability: an older Kino would refuse it");
});

test("the manifest stays under 16 KB and Kino merges the block without dropping it; an older Kino reads the base", () => {
  assert.ok(Buffer.byteLength(TEXT, "utf8") < 16 * 1024, `${Buffer.byteLength(TEXT, "utf8")} bytes`);
  const merged = validateManifest(TEXT);
  assert.equal(merged.ok, true, merged.message);
  assert.deepEqual(merged.manifest.enhancementsDropped, []);
  assert.deepEqual(merged.manifest.enhancementsApplied, [14]);
  assert.ok(merged.manifest.capabilities.includes("screen"));
  assert.equal(merged.manifest.apiVersion, 8);
  assert.equal(settingsApiVersion(merged.manifest), 14);
  assert.deepEqual(merged.manifest.settings.map((s) => [s.key, s.type]), M.settings.map((s) => [s.key, s.type]));
  const old = validateManifestWithoutEnhancements(TEXT);
  assert.equal(old.ok, true, old.message);
  assert.equal(old.manifest.capabilities.includes("screen"), false);
  assert.deepEqual(old.manifest.settings.map((s) => s.key), M.settings.map((s) => s.key));
});
