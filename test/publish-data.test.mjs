// The data-branch publisher (tools/publish-data.mjs) against a fake `gh` (test/helpers/fake-gh.mjs), plus the
// Release hash-skip and slot helpers of tools/publish-state.mjs. Nothing here runs the real gh or touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeGitHub } from "./helpers/fake-gh.mjs";
import {
  publishData, makeGhRunner, ghApi, gitBlobSha, canonicalIndex, indexPaths, readCandidate, main as publishMain,
  AUTHOR, GhError,
} from "../tools/publish-data.mjs";
import { toV2, writeOut } from "../tools/to-v2.mjs";
import * as state from "../tools/publish-state.mjs";

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

/** A synthetic payload whose `hash` follows the v2 rule (sha256 of the body without gen/hash, 16 hex). */
function payload(tag) {
  const body = { schema: 2, tag };
  return JSON.stringify({ schema: 2, hash: sha256(JSON.stringify(body)).slice(0, 16), tag });
}
const h12 = (text) => JSON.parse(text).hash.slice(0, 12);

/** A candidate as readCandidate returns it: catalog `catTag`, matches `matTag`. */
function cand(catTag, matTag, live = { off: [] }) {
  const c = payload("cat-" + catTag), m = payload("mat-" + matTag);
  const index = {
    schema: 2, minPlugin: "1.0.44", gen: 1, probeS: 300,
    catalog: { h: h12(c), n: Buffer.byteLength(c) }, matches: { h: h12(m), n: Buffer.byteLength(m) }, live,
  };
  return { index, files: new Map([[`v2/c/${h12(c)}.json`, c], [`v2/m/${h12(m)}.json`, m]]) };
}
const catPath = (tag) => `v2/c/${h12(payload("cat-" + tag))}.json`;
const matPath = (tag) => `v2/m/${h12(payload("mat-" + tag))}.json`;

let clock = T0;
/** One publish = one instant (publishData reads `now` for the index gen and the commit date). */
const opts = (fake, extra = {}) => { const t = (clock += 60000); return { gh: fake.gh, smoke: false, now: () => t, ...extra }; };
const count = (fake, method, rx) => fake.calls.filter((c) => c.method === method && rx.test(c.path)).length;

test("first run: an orphan commit creates the branch, authored by xuper-plugin with no co-author line", async () => {
  const fake = createFakeGitHub();
  const r = await publishData(cand("A", "a"), opts(fake));
  assert.equal(r.result, "published");
  const head = fake.head();
  assert.equal(head.sha, r.commit);
  assert.deepEqual(head.parents, [], "orphan: no parents");
  assert.equal(count(fake, "POST", /git\/refs$/), 1, "the branch is created with POST git/refs");
  assert.equal(count(fake, "PATCH", /git\/refs/), 0);
  for (const who of [head.author, head.committer]) {
    assert.equal(who.name, "xuper-plugin");
    assert.equal(who.email, "335105665+xuper-plugin@users.noreply.github.com");
  }
  assert.deepEqual(AUTHOR, { name: "xuper-plugin", email: "335105665+xuper-plugin@users.noreply.github.com" });
  assert.doesNotMatch(head.message, /co-authored-by/i);
  const files = fake.files();
  assert.deepEqual([...files.keys()].sort(), ["index.json", catPath("A"), matPath("a")].sort());
  const ix = JSON.parse(files.get("index.json"));
  assert.equal(ix.gen, clock, "gen = publish time");
  assert.equal(ix.catalog.h, h12(payload("cat-A")));
  assert.equal(files.get(catPath("A")), payload("cat-A"), "payload bytes as built");
});

test("unchanged index (only gen differs) → no blob, tree, commit or ref write", async () => {
  const fake = createFakeGitHub();
  await publishData(cand("A", "a"), opts(fake));
  const writes = fake.writes().length;
  const head = fake.head().sha;
  const r = await publishData(cand("A", "a"), opts(fake));
  assert.equal(r.result, "unchanged");
  assert.equal(fake.writes().length, writes, "no write at all");
  assert.equal(fake.head().sha, head);
  assert.equal(JSON.parse(fake.files().get("index.json")).gen, r.index.gen, "the published gen stays (devices keep their 304)");
});

test("canonicalIndex ignores gen and key order, not content", () => {
  const a = { schema: 2, gen: 1, catalog: { h: "aaaaaaaaaaaa", n: 3 }, live: { off: [] } };
  const b = { live: { off: [] }, catalog: { n: 3, h: "aaaaaaaaaaaa" }, gen: 99, schema: 2 };
  assert.equal(canonicalIndex(a), canonicalIndex(b));
  assert.notEqual(canonicalIndex(a), canonicalIndex({ ...b, live: { off: ["supertv"] } }));
});

test("a changed part uploads only its new file; a published name is never uploaded again", async () => {
  const fake = createFakeGitHub();
  await publishData(cand("A", "a"), opts(fake));
  const before = count(fake, "POST", /git\/blobs$/);
  const r = await publishData(cand("A", "b"), opts(fake));
  assert.equal(r.result, "published");
  assert.deepEqual(r.uploaded, [matPath("b"), "index.json"]);
  assert.equal(count(fake, "POST", /git\/blobs$/) - before, 2);
  assert.equal(fake.head().parents.length, 1, "a normal commit on top of the previous one");
  assert.ok(fake.files().has(catPath("A")));
});

test("keep-set = files of the new index + the indexes of the last two commits; older v2 files are dropped", async () => {
  const fake = createFakeGitHub();
  for (const tag of ["A", "B", "C"]) await publishData(cand(tag, "a"), opts(fake));
  const r = await publishData(cand("D", "a"), opts(fake));
  const files = fake.files();
  for (const tag of ["D", "C", "B"]) assert.ok(files.has(catPath(tag)), "kept " + tag);
  assert.ok(!files.has(catPath("A")), "A is three indexes old: dropped");
  assert.ok(files.has(matPath("a")));
  assert.deepEqual(r.dropped, [catPath("A")]);
  assert.deepEqual(r.kept.sort(), [catPath("B"), catPath("C"), matPath("a")].sort());
  // every index the keep-set covers still finds its files
  const head = fake.head();
  assert.equal(head.parents.length, 1);
});

test("paths outside v2/ (a README the owner added) are kept untouched", async () => {
  const fake = createFakeGitHub();
  fake.commitFiles("data", { "README.md": "datos publicados\n" });
  const r = await publishData(cand("A", "a"), opts(fake));
  assert.equal(r.result, "published");
  assert.equal(count(fake, "PATCH", /git\/refs\/heads\/data$/), 1, "existing branch → fast-forward PATCH");
  assert.equal(fake.files().get("README.md"), "datos publicados\n");
});

test("a 422 on the ref update (the branch moved) is retried once from a fresh read, on top of the new head", async () => {
  let raced = false;
  const fake = createFakeGitHub({
    before: (method, path, body, f) => {
      if (method === "PATCH" && !raced) {
        raced = true;   // someone else commits between our read and our ref update
        f.commitFiles("data", { ...Object.fromEntries(f.files()), "NOTE.md": "x" });
      }
    },
  });
  await publishData(cand("A", "a"), opts(fake));   // first run: POST refs, no PATCH
  const racer = () => fake.head().sha;
  const getsBefore = count(fake, "GET", /git\/ref\/heads\/data$/);
  const r = await publishData(cand("B", "a"), opts(fake));
  assert.equal(r.result, "published");
  assert.equal(r.attempts, 2);
  assert.equal(count(fake, "PATCH", /git\/refs\/heads\/data$/), 2, "one refused, one accepted");
  assert.equal(count(fake, "GET", /git\/ref\/heads\/data$/) - getsBefore, 2, "the branch is read again before the retry");
  const head = fake.head();
  assert.equal(head.sha, racer());
  assert.ok(fake.files().has("NOTE.md"), "the concurrent commit is kept (fast-forward on top of it)");
  assert.ok(fake.files().has(catPath("B")));
});

test("two 422s in a row → error after exactly one retry", async () => {
  const fake = createFakeGitHub({ failures: [{ method: "PATCH", path: /git\/refs\/heads\/data$/, status: 422, times: 5 }] });
  fake.commitFiles("data", { "README.md": "x" });
  await assert.rejects(() => publishData(cand("A", "a"), opts(fake)), (e) => e instanceof GhError && e.status === 422);
  assert.equal(count(fake, "PATCH", /git\/refs\/heads\/data$/), 2);
});

test("other errors are not retried", async () => {
  const fake = createFakeGitHub({ failures: [{ method: "POST", path: /git\/trees$/, status: 500 }] });
  await assert.rejects(() => publishData(cand("A", "a"), opts(fake)), (e) => e.status === 500);
  assert.equal(count(fake, "POST", /git\/trees$/), 1);
  assert.equal(fake.head(), null, "no branch was created");
});

test("refuses to publish when gh is authenticated as another account", async () => {
  const fake = createFakeGitHub({ login: "someone-else" });
  await assert.rejects(() => publishData(cand("A", "a"), opts(fake)), /not xuper-plugin/);
  assert.equal(fake.writes().length, 0);
});

test("dry-run reads but writes nothing", async () => {
  const fake = createFakeGitHub();
  await publishData(cand("A", "a"), opts(fake));
  const writes = fake.writes().length;
  const r = await publishData(cand("B", "a"), opts(fake, { dryRun: true }));
  assert.equal(r.result, "dry-run");
  assert.deepEqual(r.uploaded, [catPath("B"), "index.json"]);
  assert.equal(fake.writes().length, writes);
});

test("--reset-history: an orphan commit forced over the branch, keeping the keep-set's files", async () => {
  const fake = createFakeGitHub();
  for (const tag of ["A", "B"]) await publishData(cand(tag, "a"), opts(fake));
  const r = await publishData(cand("B", "a"), opts(fake, { resetHistory: true }));
  assert.equal(r.result, "published");
  const head = fake.head();
  assert.deepEqual(head.parents, []);
  const patch = fake.calls.filter((c) => c.method === "PATCH").pop();
  assert.equal(patch.body.force, true);
  assert.ok(fake.files().has(catPath("A")) && fake.files().has(catPath("B")));
});

test("smoke check: waits for raw to serve the new index, then checks each new payload", async () => {
  const fake = createFakeGitHub();
  let n = 0;
  const fetch = async (url) => {
    const path = url.replace(/^https:\/\/raw\.githubusercontent\.com\/xuper-plugin\/kino-plugin-xuper\/data\//, "").replace(/\?.*$/, "");
    if (path === "index.json" && n++ === 0) return { status: 200, text: async () => "{\"stale\":true}" };
    const f = fake.files().get(path);
    return f ? { status: 200, text: async () => f } : { status: 404, text: async () => "" };
  };
  const r = await publishData(cand("A", "a"), opts(fake, { smoke: true, fetch, smokeWaitMs: 0 }));
  assert.equal(r.smoke.ok, true);
  assert.equal(r.smoke.tries, 2, "retried while raw's cache caught up");
  const r2 = await publishData(cand("B", "a"), opts(fake, { smoke: true, fetch: async () => ({ status: 404, text: async () => "" }), smokeTries: 2, smokeWaitMs: 0 }));
  assert.equal(r2.result, "published");
  assert.equal(r2.smoke.ok, false);
  assert.ok(r2.smoke.problems.length >= 2);
});

test("the real runner reads the xuper-plugin token with GH_TOKEN removed, then passes it to every call", async () => {
  const seen = [];
  const exec = async (cmd, args, { env, input }) => {
    seen.push({ cmd, args, env, input });
    if (args[0] === "auth") return { code: 0, stdout: "tok-xuper\n", stderr: "" };
    return { code: 0, stdout: "{\"login\":\"xuper-plugin\"}", stderr: "" };
  };
  const gh = makeGhRunner({ exec, env: { PATH: "/usr/bin", GH_TOKEN: "tok-other", GITHUB_TOKEN: "tok-other2" } });
  const call = ghApi(gh);
  await call("GET", "user");
  await call("POST", "repos/x/y/git/blobs", { content: "e30=", encoding: "base64" });
  assert.deepEqual(seen[0].args, ["auth", "token", "--user", "xuper-plugin"]);
  assert.equal(seen[0].cmd, "gh");
  assert.equal(seen[0].env.GH_TOKEN, undefined);
  assert.equal(seen[0].env.GITHUB_TOKEN, undefined);
  assert.equal(seen.filter((s) => s.args[0] === "auth").length, 1, "the token is read once");
  for (const s of seen.slice(1)) {
    assert.equal(s.env.GH_TOKEN, "tok-xuper");
    assert.equal(s.args[0], "api");
  }
  assert.deepEqual(JSON.parse(seen[2].input), { content: "e30=", encoding: "base64" });
  assert.ok(seen[2].args.includes("--input"));
});

test("gh errors carry the HTTP status gh prints", async () => {
  const call = ghApi(async () => ({ code: 1, stdout: "{\"message\":\"Not Found\"}", stderr: "gh: Not Found (HTTP 404)\n" }));
  await assert.rejects(() => call("GET", "repos/x/y/git/ref/heads/data"), (e) => e instanceof GhError && e.status === 404);
});

test("gitBlobSha matches git's blob id", () => {
  assert.equal(gitBlobSha(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  assert.equal(gitBlobSha("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
});

test("indexPaths names catalog, matches and (step 5) live snapshots, ignoring malformed hashes", () => {
  assert.deepEqual(indexPaths({
    catalog: { h: "0123456789ab" }, matches: { h: "ba9876543210" },
    live: { off: [], snap: { xuper: { h: "aaaaaaaaaaaa" }, bad: { h: "../../x" } } },
  }), ["v2/c/0123456789ab.json", "v2/m/ba9876543210.json", "v2/l/xuper.aaaaaaaaaaaa.json"]);
  assert.deepEqual(indexPaths({ catalog: { h: "../evil" } }), []);
});

test("CLI: a real to-v2 build is published once, then found unchanged", async () => {
  const home = JSON.parse(readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8"));
  const matches = JSON.parse(readFileSync(new URL("./fixtures/matches.reduced.json", import.meta.url), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "xuper-pubdata-"));
  try {
    writeOut(dir, toV2({ home, matches, gen: T0 }));
    const cnd = readCandidate(dir);
    assert.equal(cnd.files.size, 2);
    const fake = createFakeGitHub();
    const out = [], err = [];
    const io = { gh: fake.gh, fetchFn: null, out: (l) => out.push(l), err: (l) => err.push(l) };
    assert.equal(await publishMain(["--dir", dir, "--no-smoke"], io), 0);
    assert.equal(JSON.parse(out.pop()).result, "published");
    assert.equal(fake.files().get(`v2/c/${cnd.index.catalog.h}.json`), cnd.files.get(`v2/c/${cnd.index.catalog.h}.json`));
    writeOut(dir, toV2({ home, matches, gen: T0 + 7200000 }));   // the next run: same content, new gen
    assert.equal(await publishMain(["--dir", dir, "--no-smoke"], io), 0);
    assert.equal(JSON.parse(out.pop()).result, "unchanged");
    assert.equal(await publishMain(["--dir", join(dir, "missing")], io), 1, "no candidate → error, exit 1");
    assert.equal(JSON.parse(out.pop()).result, "error");
    assert.equal(await publishMain(["--bogus"], io), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: exit 3 when published but raw never serves it", async () => {
  const home = JSON.parse(readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8"));
  const matches = JSON.parse(readFileSync(new URL("./fixtures/matches.reduced.json", import.meta.url), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "xuper-pubdata-"));
  try {
    writeOut(dir, toV2({ home, matches, gen: T0 }));
    const fake = createFakeGitHub();
    const out = [];
    const fetchFn = async () => { throw new Error("offline"); };
    const code = await publishMain(["--dir", dir], { gh: fake.gh, fetchFn, out: (l) => out.push(l), err: () => {}, smokeTries: 2, smokeWaitMs: 0 });
    assert.equal(code, 3);
    const r = JSON.parse(out.pop());
    assert.equal(r.result, "published");
    assert.equal(r.smoke.ok, false);
    assert.equal(r.smoke.tries, 2);
    assert.ok(fake.head(), "the commit stands: a re-run finds it unchanged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── tools/publish-state.mjs: the Release hash-skip and the catalog slots ──

test("legacyHash ignores generatedAt and key order, not content", () => {
  const a = { version: 1, generatedAt: 1, sections: { x: { rows: [1, 2] } } };
  const b = { sections: { x: { rows: [1, 2] } }, generatedAt: 999, version: 1 };
  assert.equal(state.legacyHash(a), state.legacyHash(b));
  assert.match(state.legacyHash(a), /^[0-9a-f]{16}$/);
  assert.notEqual(state.legacyHash(a), state.legacyHash({ ...a, sections: { x: { rows: [2, 1] } } }));
});

test("changed/mark: an asset is uploaded again only when its canonical hash changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "xuper-state-"));
  try {
    const env = { XUPER_STATE_DIR: join(dir, "state") };
    const f = join(dir, "home.json");
    const out = [], err = [];
    const run = (...argv) => state.main(argv, env, (l) => out.push(l), (l) => err.push(l));
    writeFileSync(f, JSON.stringify({ version: 1, generatedAt: 1, sections: { a: 1 } }));
    assert.equal(run("changed", "home.json", f), 0, "nothing recorded yet → changed");
    assert.equal(run("mark", "home.json", f), 0);
    assert.ok(existsSync(join(dir, "state", "home.json.hash")));
    writeFileSync(f, JSON.stringify({ generatedAt: 2, sections: { a: 1 }, version: 1 }));
    assert.equal(run("changed", "home.json", f), 1, "regenerated, same content → unchanged");
    writeFileSync(f, JSON.stringify({ version: 1, generatedAt: 3, sections: { a: 2 } }));
    assert.equal(run("changed", "home.json", f), 0, "new content → changed");
    writeFileSync(f, "not json");
    assert.equal(run("changed", "home.json", f), 3, "unreadable → error code, never 'unchanged'");
    assert.equal(run("changed", "../x", f), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("catalog slots: due once after 06:00 and once after 18:00 (local time)", () => {
  const at = (h, m = 0, dayDelta = 0) => new Date(2026, 10, 16 + dayDelta, h, m).getTime();
  assert.equal(state.lastSlot(at(7)), at(6));
  assert.equal(state.lastSlot(at(18)), at(18));
  assert.equal(state.lastSlot(at(3)), at(18, 0, -1));
  assert.equal(state.catalogDue({}, at(7)), true, "never generated");
  assert.equal(state.catalogDue({ catalogAt: at(6, 5) }, at(17, 59)), false);
  assert.equal(state.catalogDue({ catalogAt: at(6, 5) }, at(18, 1)), true);
  assert.equal(state.catalogDue({ catalogAt: at(18, 2) }, at(5, 59, 1)), false);
  assert.equal(state.catalogDue({ catalogAt: at(18, 2) }, at(6, 0, 1)), true);
});

test("status writes publish-status.json from the step outputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "xuper-state-"));
  try {
    const tv = join(dir, "to-v2.json"); writeFileSync(tv, JSON.stringify({ catalog: { h: "x" } }));
    const f = join(dir, "publish-status.json");
    assert.equal(state.main(["status", "--file", f, "--mode", "data", "--started", String(Date.now() - 5), "--exit", "0",
      "--to-v2", tv, "--data", join(dir, "missing.json"), "--release", "home.json=unchanged", "--release", "matches.json=uploaded"], {}, () => {}, () => {}), 0);
    const s = JSON.parse(readFileSync(f, "utf8"));
    assert.equal(s.mode, "data");
    assert.deepEqual(s.toV2, { catalog: { h: "x" } });
    assert.equal(s.data, null);
    assert.deepEqual(s.release, { "home.json": "unchanged", "matches.json": "uploaded" });
    assert.ok(s.ms >= 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
