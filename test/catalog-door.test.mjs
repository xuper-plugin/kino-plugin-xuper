// The catalog door (Kino's plugin protocol): Da-Video's search reaches Xuper through it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the manifest provides the catalog door and plugin.js exports proto_catalog_search", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
  assert.deepEqual(Object.keys(m.provides), ["catalog"]);
  assert.deepEqual(Object.keys(m.provides.catalog.calls), ["search"]);
  const src = readFileSync(new URL("../src/plugin.js", import.meta.url), "utf8");
  assert.match(src, /export const proto_catalog_search = catalogDoor\(search\);/);
});
