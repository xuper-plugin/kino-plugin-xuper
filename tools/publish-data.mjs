// publish-data.mjs — publishes a to-v2 build to the `data` branch of xuper-plugin/kino-plugin-xuper as ONE commit
// made through the git data API (blobs → tree → commit → ref), with no clone and no SSH.
//
//   node tools/publish-data.mjs --dir <to-v2 out dir> [--repo owner/name] [--branch data]
//                               [--dry-run] [--no-smoke] [--reset-history]
//
// - Identity: every `gh` call runs with GH_TOKEN = `gh auth token --user xuper-plugin` (six accounts are logged in on
//   the Mac); the script checks `gh api user` answers xuper-plugin before anything else. Commits are authored and
//   committed by xuper-plugin <335105665+xuper-plugin@users.noreply.github.com>, with no co-author trailer.
// - No-op: when the candidate index equals the published one WITHOUT `gen` (and every file it names is in the
//   tree), nothing is written: devices keep getting a 304.
// - Immutable payloads: a `v2/<c|m>/<h12>.json` already in the tree is never uploaded again (its `n` comes from the
//   tree); only new names get a blob.
// - Retention (keep-set): the new tree holds every file named by the new index and by the indexes of the last two
//   commits (the one being replaced and the one before it). Other `v2/**` files are dropped; any other path is kept.
// - First run: no branch → an orphan commit (no parents) and `POST git/refs`. `--reset-history` (about once a year)
//   writes an orphan commit over the branch with `force: true`; the paths do not change.
// - A 422 on the ref update (someone moved the branch) is retried once, from a fresh read of the branch.
// - Smoke check: raw.githubusercontent.com must serve the new index.json (retried while raw's cache catches up) and
//   each new payload with its hash.
//
// stdout: one JSON summary line ({result: "published"|"unchanged"|"dry-run", …}). Exit 0 = published, unchanged or
// dry-run; 1 = nothing published (error); 3 = published, but the smoke check failed.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = "xuper-plugin/kino-plugin-xuper";
export const BRANCH = "data";
export const GH_USER = "xuper-plugin";
export const AUTHOR = Object.freeze({ name: "xuper-plugin", email: "335105665+xuper-plugin@users.noreply.github.com" });
export const KEEP_PREVIOUS = 2;
export const RAW_BASE = "https://raw.githubusercontent.com/";
const H12 = /^[0-9a-f]{12}$/;
const PARTS = { catalog: "c", matches: "m" };

export class GhError extends Error {
  constructor(message, status) { super(message); this.name = "GhError"; this.status = status; }
}

// ── gh runners ──

/** spawn → { code, stdout, stderr }; `input` goes to stdin. */
function spawnExec(cmd, args, { env, input } = {}) {
  return new Promise((resolveP, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) => resolveP({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
    p.stdin.end(input === undefined ? "" : input);
  });
}

/**
 * The real `gh` runner: `(args, {input}) → {code, stdout, stderr}`. The token is read once with
 * `gh auth token --user <user>` (any GH_TOKEN/GITHUB_TOKEN already in the environment is ignored for that read, so the
 * keyring account decides), then passed as GH_TOKEN to every call. `exec` is injectable for tests.
 */
export function makeGhRunner({ user = GH_USER, env = process.env, exec = spawnExec, bin = "gh" } = {}) {
  let token = null;
  const base = { ...env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" };
  delete base.GH_TOKEN; delete base.GITHUB_TOKEN; delete base.GH_ENTERPRISE_TOKEN; delete base.GITHUB_ENTERPRISE_TOKEN;
  return async function gh(args, opts = {}) {
    if (token === null) {
      const r = await exec(bin, ["auth", "token", "--user", user], { env: base });
      const t = String(r.stdout || "").trim();
      if (r.code !== 0 || !t) throw new GhError(`gh has no token for ${user}: ${String(r.stderr || "").trim()}`, 0);
      token = t;
    }
    return exec(bin, args, { env: { ...base, GH_TOKEN: token }, input: opts.input });
  };
}

/** `gh api` as a JSON client. Errors become GhError with the HTTP status gh prints ("… (HTTP 422)"). */
export function ghApi(gh) {
  return async function call(method, path, body) {
    const args = ["api", "--method", method, "-H", "Accept: application/vnd.github+json", path];
    if (body !== undefined) args.push("--input", "-");
    const r = await gh(args, body !== undefined ? { input: JSON.stringify(body) } : {});
    if (r.code === 0) {
      const t = String(r.stdout || "").trim();
      return t ? JSON.parse(t) : null;
    }
    const m = /\(HTTP (\d{3})\)/.exec(String(r.stderr || "") + " " + String(r.stdout || ""));
    throw new GhError(`${method} ${path}: ${String(r.stderr || r.stdout || "").trim().slice(0, 300)}`, m ? Number(m[1]) : 0);
  };
}

// ── pure helpers ──

/** The id git gives a blob: sha1("blob <bytes>\0" + content). */
export function gitBlobSha(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), "utf8");
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]); return o; }
  return v;
}

/** The index as compared for "unchanged": without the top-level `gen` (diagnostics only), keys sorted. */
export function canonicalIndex(ix) {
  if (!ix || typeof ix !== "object") return "";
  const rest = {};
  for (const k of Object.keys(ix)) if (k !== "gen") rest[k] = ix[k];
  return JSON.stringify(sortKeys(rest));
}

/** Every payload path an index names: v2/c/<h>.json, v2/m/<h>.json, v2/l/<src>.<h>.json. */
export function indexPaths(ix) {
  const out = [];
  if (!ix || typeof ix !== "object") return out;
  for (const [k, d] of Object.entries(PARTS)) {
    const h = ix[k] && ix[k].h;
    if (H12.test(String(h || ""))) out.push(`v2/${d}/${h}.json`);
  }
  const snap = ix.live && ix.live.snap;
  if (snap && typeof snap === "object") {
    for (const [src, e] of Object.entries(snap)) {
      if (/^[a-z0-9-]{1,40}$/.test(src) && e && H12.test(String(e.h || ""))) out.push(`v2/l/${src}.${e.h}.json`);
    }
  }
  return out;
}

/** Reads a to-v2 output dir: the candidate index plus the text of every payload it names (light checks only). */
export function readCandidate(dir) {
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  if (!index || index.schema !== 2) throw new Error("candidate index.json: schema is not 2");
  const files = new Map();
  for (const path of indexPaths(index)) {
    const text = readFileSync(join(dir, path), "utf8");
    const h = path.match(/([0-9a-f]{12})\.json$/)[1];
    let body;
    try { body = JSON.parse(text); } catch (e) { throw new Error(`${path} is not JSON`); }
    if (!body || body.schema !== 2 || String(body.hash || "").slice(0, 12) !== h) throw new Error(`${path}: hash/schema do not match its name`);
    files.set(path, text);
  }
  for (const k of Object.keys(PARTS)) if (!index[k] || !H12.test(String(index[k].h || ""))) throw new Error(`candidate index.json: ${k}.h missing`);
  return { index, files };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// ── the publish ──

/**
 * Publishes `candidate` ({index, files: Map(path → text)}). Options:
 *   gh (required)  runner `(args, {input}) → {code, stdout, stderr}`; tests pass a fake.
 *   repo, branch, now, dryRun, resetHistory, keepPrevious, smoke (false to skip), fetch, smokeTries, smokeWaitMs, log.
 * → { result: "published"|"unchanged"|"dry-run", commit?, index, uploaded, kept, dropped, smoke?, attempts }.
 * Throws when nothing could be published.
 */
export async function publishData(candidate, opts = {}) {
  const {
    gh, repo = REPO, branch = BRANCH, now = Date.now, dryRun = false, resetHistory = false,
    keepPrevious = KEEP_PREVIOUS, smoke = true, fetch: fetchFn = globalThis.fetch, smokeTries = 4, smokeWaitMs = 20000,
    log = () => {}, user = GH_USER,
  } = opts;
  if (typeof gh !== "function") throw new Error("publishData needs a gh runner");
  const call = ghApi(gh);
  const me = await call("GET", "user");
  if (!me || me.login !== user) throw new Error(`gh is authenticated as ${me && me.login}, not ${user}: refusing to publish`);

  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      const r = await attempt(call, candidate, { repo, branch, now, dryRun, resetHistory, keepPrevious, log });
      r.attempts = attempts;
      if (r.result === "published" && smoke) {
        r.smoke = await smokeCheck({ repo, branch, indexText: r.indexText, uploaded: r.uploaded, files: candidate.files, commit: r.commit, fetchFn, tries: smokeTries, waitMs: smokeWaitMs, log });
      }
      delete r.indexText;
      return r;
    } catch (e) {
      if (e instanceof GhError && e.status === 422 && e.refUpdate && attempts < 2) {
        log(`ref update refused (422): the branch moved, retrying once from a fresh read`);
        continue;
      }
      throw e;
    }
  }
}

async function readIndexAt(call, repo, sha) {
  try {
    const c = await call("GET", `repos/${repo}/contents/index.json?ref=${sha}`);
    if (!c || typeof c.content !== "string") return null;
    return JSON.parse(Buffer.from(c.content, c.encoding === "base64" ? "base64" : "utf8").toString("utf8"));
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return null;
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

async function attempt(call, candidate, { repo, branch, now, dryRun, resetHistory, keepPrevious, log }) {
  // 1. Where the branch is now (404 = first run).
  let head = null;
  try {
    const ref = await call("GET", `repos/${repo}/git/ref/heads/${branch}`);
    head = ref && ref.object && ref.object.sha;
  } catch (e) {
    if (!(e instanceof GhError && e.status === 404)) throw e;
  }
  let tree = [];
  const previous = [];   // indexes of the last `keepPrevious` commits, newest first (null when a commit has none)
  if (head) {
    const headCommit = await call("GET", `repos/${repo}/git/commits/${head}`);
    const t = await call("GET", `repos/${repo}/git/trees/${headCommit.tree.sha}?recursive=1`);
    if (t.truncated) throw new Error("the data branch tree is truncated: refusing to rebuild it");
    tree = (t.tree || []).filter((e) => e.type === "blob");
    let sha = head, commit = headCommit;
    for (let i = 0; i < keepPrevious && sha; i++) {
      previous.push(await readIndexAt(call, repo, sha));
      if (i + 1 >= keepPrevious) break;
      if (!commit) commit = await call("GET", `repos/${repo}/git/commits/${sha}`);
      sha = commit.parents && commit.parents[0] ? commit.parents[0].sha : null;
      commit = null;
    }
  }
  const current = previous[0] || null;
  const byPath = new Map(tree.map((e) => [e.path, e]));

  // 2. The new index: the candidate, with `n` taken from the tree for a file that is already published.
  const index = JSON.parse(JSON.stringify(candidate.index));
  index.gen = Math.floor(now());
  for (const [k, d] of Object.entries(PARTS)) {
    const e = byPath.get(`v2/${d}/${index[k].h}.json`);
    if (e && Number.isInteger(e.size)) index[k].n = e.size;
  }
  const newPaths = indexPaths(index);
  const unchanged = current && canonicalIndex(current) === canonicalIndex(index) && newPaths.every((p) => byPath.has(p)) && byPath.has("index.json");
  if (unchanged && !resetHistory) {
    log(`index unchanged (catalog ${index.catalog.h}, matches ${index.matches.h}): nothing to publish`);
    return { result: "unchanged", head, index: current, uploaded: [], kept: [], dropped: [] };
  }

  // 3. Keep-set and the new tree.
  const keep = new Set(newPaths);
  for (const ix of previous) for (const p of indexPaths(ix)) keep.add(p);
  const entries = [], kept = [], dropped = [], uploads = [];
  for (const e of tree) {
    if (e.path === "index.json") continue;
    if (!e.path.startsWith("v2/")) { entries.push({ path: e.path, mode: e.mode, type: "blob", sha: e.sha }); continue; }
    if (keep.has(e.path)) { entries.push({ path: e.path, mode: e.mode, type: "blob", sha: e.sha }); kept.push(e.path); }
    else dropped.push(e.path);
  }
  for (const p of newPaths) {
    if (byPath.has(p)) continue;   // immutable: an existing name is never uploaded again
    const text = candidate.files.get(p);
    if (typeof text !== "string") throw new Error(`the candidate has no file for ${p}`);
    uploads.push({ path: p, text });
  }
  const indexText = JSON.stringify(index, null, 2) + "\n";
  uploads.push({ path: "index.json", text: indexText });
  const uploaded = uploads.map((u) => u.path);
  const message = `data: catalog ${index.catalog.h}, matches ${index.matches.h}`;
  if (dryRun) {
    log(`dry-run: would commit "${message}" on ${head ? head.slice(0, 12) : "a new orphan branch"}; upload ${uploaded.join(", ")}; drop ${dropped.length}`);
    return { result: "dry-run", head, index, uploaded, kept, dropped, message };
  }

  // 4. Blobs (each checked against the id git would give it), tree, commit.
  for (const u of uploads) {
    const want = gitBlobSha(u.text);
    const b = await call("POST", `repos/${repo}/git/blobs`, { content: b64(u.text), encoding: "base64" });
    if (!b || b.sha !== want) throw new Error(`blob ${u.path}: GitHub answered ${b && b.sha}, expected ${want}`);
    entries.push({ path: u.path, mode: "100644", type: "blob", sha: want });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const newTree = await call("POST", `repos/${repo}/git/trees`, { tree: entries });
  const date = new Date(now()).toISOString();
  const parents = head && !resetHistory ? [head] : [];
  const commit = await call("POST", `repos/${repo}/git/commits`, {
    message, tree: newTree.sha, parents,
    author: { ...AUTHOR, date }, committer: { ...AUTHOR, date },
  });

  // 5. Move the branch: fast-forward only (create it on the first run; force only for --reset-history).
  try {
    if (!head) await call("POST", `repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
    else await call("PATCH", `repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: !!resetHistory });
  } catch (e) {
    if (e instanceof GhError) e.refUpdate = true;
    throw e;
  }
  log(`published ${commit.sha.slice(0, 12)}: ${message}; uploaded ${uploaded.length}, kept ${kept.length}, dropped ${dropped.length}`);
  return { result: "published", head, commit: commit.sha, index, uploaded, kept, dropped, message, indexText };
}

/** raw.githubusercontent.com serves the new index.json and each new payload. → { ok, tries, problems }. */
export async function smokeCheck({ repo, branch, indexText, uploaded, files, commit, fetchFn, tries = 4, waitMs = 20000, log = () => {} }) {
  if (typeof fetchFn !== "function") return { ok: false, tries: 0, problems: ["no fetch available"] };
  const get = async (url) => {
    try {
      const r = await fetchFn(url, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(15000) });
      return { status: r.status, text: r.status === 200 ? await r.text() : "" };
    } catch (e) { return { status: 0, text: "", error: String((e && e.message) || e) }; }
  };
  const base = `${RAW_BASE}${repo}/${branch}/`;
  const problems = [];
  let n = 0, indexOk = false;
  for (; n < tries && !indexOk; n++) {
    if (n) await sleep(waitMs);
    const r = await get(`${base}index.json?v=${String(commit || "").slice(0, 12)}`);
    indexOk = r.status === 200 && r.text === indexText;
    if (!indexOk) log(`smoke: raw index.json not current yet (try ${n + 1}/${tries}, status ${r.status})`);
  }
  if (!indexOk) problems.push("raw index.json is not the published one");
  for (const p of uploaded) {
    if (p === "index.json") continue;
    const r = await get(base + p);
    const h = p.match(/([0-9a-f]{12})\.json$/)[1];
    let ok = false;
    try { ok = r.status === 200 && String(JSON.parse(r.text).hash || "").slice(0, 12) === h && r.text === files.get(p); } catch (_) { ok = false; }
    if (!ok) problems.push(`raw ${p}: status ${r.status}, content not the published one`);
  }
  return { ok: problems.length === 0, tries: n, problems };
}

// ── CLI ──

function parseArgs(argv) {
  const o = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--no-smoke" || a === "--reset-history") o.flags.add(a.slice(2));
    else if (a === "--dir" || a === "--repo" || a === "--branch") {
      if (i + 1 >= argv.length) throw new Error("missing value for " + a);
      o[a.slice(2)] = argv[++i];
    } else throw new Error("unexpected argument " + a);
  }
  if (!o.dir) throw new Error("--dir is required");
  return o;
}

export async function main(argv = process.argv.slice(2), {
  gh = makeGhRunner(), fetchFn = globalThis.fetch, out = console.log, err = console.error, smokeTries, smokeWaitMs,
} = {}) {
  let a;
  try { a = parseArgs(argv); } catch (e) {
    err("publish-data: " + e.message);
    err("usage: node tools/publish-data.mjs --dir <to-v2 out> [--repo owner/name] [--branch data] [--dry-run] [--no-smoke] [--reset-history]");
    return 2;
  }
  const t0 = Date.now();
  try {
    const candidate = readCandidate(resolve(a.dir));
    const r = await publishData(candidate, {
      gh, repo: a.repo || REPO, branch: a.branch || BRANCH, fetch: fetchFn,
      dryRun: a.flags.has("dry-run"), smoke: !a.flags.has("no-smoke"), resetHistory: a.flags.has("reset-history"),
      ...(smokeTries !== undefined ? { smokeTries } : {}), ...(smokeWaitMs !== undefined ? { smokeWaitMs } : {}),
      log: (m) => err("publish-data: " + m),
    });
    out(JSON.stringify({ ...r, ms: Date.now() - t0 }));
    return r.smoke && !r.smoke.ok ? 3 : 0;
  } catch (e) {
    err("publish-data: nothing published: " + ((e && e.message) || e));
    out(JSON.stringify({ result: "error", error: String((e && e.message) || e), status: (e && e.status) || null, ms: Date.now() - t0 }));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
