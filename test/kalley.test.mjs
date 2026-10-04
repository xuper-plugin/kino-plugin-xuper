// Xuper on the KALLEY, modelled (test/kalley/sim.js): the plugin's real modules under QuickJS, the
// engine Kino uses, with time scaled to that TV (calibrated on 2.2.7's device run). Every call is timed
// as Kino gets it. The budgets are Kino's 20 s per call with room to spare, on a model that scales the
// engine's native work like interpreted code (pessimistic). Skipped where `qjs` is not installed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

let qjs = null;
try { execFileSync("qjs", ["-q"], { stdio: "ignore" }); qjs = "qjs"; } catch (_) { /* not installed */ }

function run(scenario) {
  const out = join(mkdtempSync(join(tmpdir(), "kalley-")), "sim.js");
  buildSync({ entryPoints: [fileURLToPath(new URL("./kalley/sim.js", import.meta.url))], bundle: true, format: "esm", target: "es2022", external: ["os"], outfile: out, logLevel: "silent" });
  return JSON.parse(execFileSync(qjs, ["--std", "-m", out, scenario], { encoding: "utf8", maxBuffer: 1 << 24 }));
}
const byLabel = (calls, label) => calls.find((c) => c.label === label);

test("KALLEY model: the update from 2.2.3 — every start's categories stays well inside 20 s, the 5th start answers from storage", { skip: !qjs && "qjs not installed", timeout: 600_000 }, () => {
  const { calls, stored } = run("fresh");
  for (const c of calls) {
    assert.equal(c.error, undefined, `${c.label}: ${c.error}`);
    assert.ok(c.ms <= 15_000, `${c.label}: ${c.ms} ms on the TV (model)`);
  }
  assert.ok(byLabel(calls, "next start: categories").ms <= 1_000, "a start with every root stored costs nothing");
  assert.ok(byLabel(calls, "next start: section, same tab again").ms <= 1_000, "a warm section costs nothing");
  assert.ok(stored.includes("rows:meta") && !stored.some((k) => k.startsWith("tree:")), stored.join(","));
});

test("KALLEY model: En vivo's Todos lists its 1037 channels, each page well inside 20 s", { skip: !qjs && "qjs not installed", timeout: 600_000 }, () => {
  const { calls } = run("live");
  const pages = calls.filter((c) => c.label.startsWith("live: Todos page"));
  assert.ok(pages.length >= 5);
  for (const p of pages) assert.ok(p.ms <= 8_000, `${p.label}: ${p.ms} ms on the TV (model)`);
  assert.equal(byLabel(calls, "live: Todos channels").count, 1037);
});
