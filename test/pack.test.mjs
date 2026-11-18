import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import JSZip from "jszip";

import { pack } from "../tools/pack.mjs";

// Re-verifies the invariants Kino's PluginFileReader enforces on a .kinoplugin file.
test("pack produces a valid .kinoplugin", async () => {
  const { fileName, bytes } = await pack();

  assert.match(fileName, /^xuper-\d+\.\d+\.\d+\.kinoplugin$/);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
  assert.ok(bytes.length <= 8 * 1024 * 1024);

  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  assert.ok(names.length <= 64);
  assert.ok(names.every((n) => !zip.files[n].dir && !n.endsWith("/"))); // no directory entries
  assert.ok(names.includes("kino-export.json"));

  const info = JSON.parse(await zip.file("kino-export.json").async("string"));
  const m = JSON.parse(await zip.file("kino-plugin.json").async("string"));
  assert.equal(info.format, 1);
  assert.equal(info.originalAddress, null);
  assert.equal(info.pluginId, m.id);
  assert.equal(info.version, m.version);
  assert.ok(typeof info.kinoVersion === "string" && info.kinoVersion.length <= 40);

  const entries = names.filter((n) => n !== "kino-export.json");
  assert.deepEqual(Object.keys(info.files).sort(), [...entries].sort()); // files == non-export entries
  for (const n of entries) {
    const data = Buffer.from(await zip.file(n).async("uint8array"));
    assert.equal(createHash("sha256").update(data).digest("hex"), info.files[n]); // sha256 matches
  }

  assert.deepEqual([...entries].sort(), ["icon.png", "kino-plugin.json", "plugin.js"]);
});
