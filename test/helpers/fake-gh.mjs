// A fake `gh` for the publisher tests: an in-memory model of the GitHub git data API (blobs, trees, commits, refs,
// contents) behind the runner signature tools/publish-data.mjs uses: `(args, {input}) → {code, stdout, stderr}`.
// Errors look like gh's own: exit code 1 and "gh: <message> (HTTP <status>)" on stderr. Nothing touches the network.
import { createHash } from "node:crypto";

const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const blobSha = (buf) => sha1(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]));

/**
 * opts.repo   "owner/name" the fake serves (other repos → 404)
 * opts.login  what `gh api user` answers (default xuper-plugin)
 * opts.failures  [{ method, path (string or RegExp), status, times = 1 }] answered before the model runs
 * opts.before    (method, path, body, fake) => void, runs before each call (e.g. a concurrent push)
 */
export function createFakeGitHub(opts = {}) {
  const repo = opts.repo || "xuper-plugin/kino-plugin-xuper";
  const blobs = new Map();     // sha → Buffer
  const trees = new Map();     // sha → [{path, mode, type:"blob", sha, size}] (full paths)
  const commits = new Map();   // sha → {tree, parents, message, author, committer}
  const refs = new Map();      // "heads/data" → sha
  const calls = [];
  const failures = (opts.failures || []).map((f) => ({ times: 1, ...f }));
  let seq = 0;
  if (opts.snapshot) {   // state saved by `fake.snapshot()` (a gh shim that lives across processes)
    const s = opts.snapshot;
    for (const [k, v] of Object.entries(s.blobs || {})) blobs.set(k, Buffer.from(v, "base64"));
    for (const [k, v] of Object.entries(s.trees || {})) trees.set(k, v);
    for (const [k, v] of Object.entries(s.commits || {})) commits.set(k, v);
    for (const [k, v] of Object.entries(s.refs || {})) refs.set(k, v);
    seq = s.seq || 0;
  }

  const fail = (status, msg) => ({ code: 1, stdout: JSON.stringify({ message: msg }), stderr: `gh: ${msg} (HTTP ${status})\n` });
  const ok = (obj) => ({ code: 0, stdout: JSON.stringify(obj), stderr: "" });

  function putBlob(buf) { const s = blobSha(buf); blobs.set(s, buf); return s; }
  function putTree(entries) {
    const flat = entries.map((e) => ({ path: e.path, mode: e.mode || "100644", type: "blob", sha: e.sha, size: (blobs.get(e.sha) || Buffer.alloc(0)).length }));
    flat.sort((a, b) => (a.path < b.path ? -1 : 1));
    const s = sha1(Buffer.from("tree " + JSON.stringify(flat.map((e) => [e.path, e.mode, e.sha]))));
    trees.set(s, flat);
    return s;
  }
  function putCommit(c) {
    const s = sha1(Buffer.from("commit " + JSON.stringify([c.tree, c.parents, c.message, c.author, c.committer, ++seq])));
    commits.set(s, c);
    return s;
  }
  function isAncestor(anc, sha) {
    const seen = new Set();
    const stack = [sha];
    while (stack.length) {
      const s = stack.pop();
      if (s === anc) return true;
      if (!s || seen.has(s)) continue;
      seen.add(s);
      for (const p of (commits.get(s) || { parents: [] }).parents) stack.push(p);
    }
    return false;
  }
  function treeListing(treeSha) {
    const flat = trees.get(treeSha) || [];
    const dirs = new Set();
    for (const e of flat) { const parts = e.path.split("/"); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/")); }
    // like GitHub: directories appear as "tree" entries next to the blobs
    const out = [...[...dirs].map((d) => ({ path: d, mode: "040000", type: "tree", sha: sha1(Buffer.from("dir " + d)) })), ...flat];
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }
  function fileAt(commitSha, path) {
    const c = commits.get(commitSha);
    if (!c) return null;
    const e = (trees.get(c.tree) || []).find((x) => x.path === path);
    return e ? blobs.get(e.sha) : null;
  }

  function api(method, rawPath, body) {
    const [path, query = ""] = rawPath.split("?");
    const q = new URLSearchParams(query);
    if (path === "user" && method === "GET") return ok({ login: opts.login || "xuper-plugin" });
    const pre = `repos/${repo}/`;
    if (!path.startsWith(pre)) return fail(404, "Not Found");
    const p = path.slice(pre.length);
    let m;
    if (method === "GET" && (m = /^git\/ref\/(heads\/[^/]+)$/.exec(p))) {
      const s = refs.get(m[1]);
      return s ? ok({ ref: "refs/" + m[1], object: { sha: s, type: "commit" } }) : fail(404, "Not Found");
    }
    if (method === "GET" && (m = /^git\/commits\/([0-9a-f]{40})$/.exec(p))) {
      const c = commits.get(m[1]);
      return c ? ok({ sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })), message: c.message, author: c.author, committer: c.committer }) : fail(404, "Not Found");
    }
    if (method === "GET" && (m = /^git\/trees\/([0-9a-f]{40})$/.exec(p))) {
      if (!trees.has(m[1])) return fail(404, "Not Found");
      return ok({ sha: m[1], tree: q.get("recursive") ? treeListing(m[1]) : [], truncated: false });
    }
    if (method === "GET" && (m = /^contents\/(.+)$/.exec(p))) {
      const ref = q.get("ref") || refs.get("heads/main");
      const sha = /^[0-9a-f]{40}$/.test(ref || "") ? ref : refs.get("heads/" + ref);
      const buf = sha ? fileAt(sha, m[1]) : null;
      return buf ? ok({ path: m[1], encoding: "base64", content: buf.toString("base64").replace(/(.{60})/g, "$1\n"), sha: blobSha(buf) }) : fail(404, "Not Found");
    }
    if (method === "POST" && p === "git/blobs") {
      const buf = body.encoding === "base64" ? Buffer.from(body.content, "base64") : Buffer.from(String(body.content), "utf8");
      return ok({ sha: putBlob(buf) });
    }
    if (method === "POST" && p === "git/trees") {
      if (body.base_tree) return fail(422, "base_tree not supported by the fake");
      for (const e of body.tree) if (!blobs.has(e.sha)) return fail(422, "GitRPC::BadObjectState");
      return ok({ sha: putTree(body.tree) });
    }
    if (method === "POST" && p === "git/commits") {
      if (!trees.has(body.tree)) return fail(422, "Tree SHA does not exist");
      for (const s of body.parents || []) if (!commits.has(s)) return fail(422, "Parent SHA does not exist");
      const c = { tree: body.tree, parents: body.parents || [], message: body.message, author: body.author, committer: body.committer };
      return ok({ sha: putCommit(c), ...c });
    }
    if (method === "POST" && p === "git/refs") {
      const name = String(body.ref || "").replace(/^refs\//, "");
      if (refs.has(name)) return fail(422, "Reference already exists");
      if (!commits.has(body.sha)) return fail(422, "Object does not exist");
      refs.set(name, body.sha);
      return ok({ ref: body.ref, object: { sha: body.sha } });
    }
    if (method === "PATCH" && (m = /^git\/refs\/(heads\/[^/]+)$/.exec(p))) {
      const cur = refs.get(m[1]);
      if (!cur) return fail(422, "Reference does not exist");
      if (!commits.has(body.sha)) return fail(422, "Object does not exist");
      if (!body.force && !isAncestor(cur, body.sha)) return fail(422, "Update is not a fast forward");
      refs.set(m[1], body.sha);
      return ok({ ref: "refs/" + m[1], object: { sha: body.sha } });
    }
    return fail(404, "Not Found (fake: " + method + " " + p + ")");
  }

  async function gh(args, { input } = {}) {
    if (args[0] !== "api") return fail(1, "fake gh supports only `gh api`");
    let method = "GET", path = null, hasInput = false;
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--method" || a === "-X") method = args[++i];
      else if (a === "-H" || a === "--header") i++;
      else if (a === "--input") { hasInput = args[++i] === "-"; }
      else if (!a.startsWith("-") && path === null) path = a;
    }
    const body = hasInput ? JSON.parse(input) : undefined;
    calls.push({ method, path, body });
    if (opts.before) opts.before(method, path, body, fake);
    const f = failures.find((x) => x.times > 0 && x.method === method && (x.path instanceof RegExp ? x.path.test(path) : x.path === path));
    if (f) { f.times--; return fail(f.status, "Injected failure"); }
    return api(method, path, body);
  }

  const fake = {
    gh, calls, refs, commits, trees, blobs,
    /** The files on a branch: Map(path → text). */
    files(branch = "data") {
      const s = refs.get("heads/" + branch);
      const c = s && commits.get(s);
      const out = new Map();
      if (!c) return out;
      for (const e of trees.get(c.tree) || []) out.set(e.path, blobs.get(e.sha).toString("utf8"));
      return out;
    },
    head(branch = "data") { const s = refs.get("heads/" + branch); return s ? { sha: s, ...commits.get(s) } : null; },
    /** Seeds a branch with files (an owner-made commit), returns its sha. */
    commitFiles(branch, files, message = "seed", parents) {
      const entries = Object.entries(files).map(([path, text]) => ({ path, sha: putBlob(Buffer.from(text, "utf8")) }));
      const tree = putTree(entries);
      const cur = refs.get("heads/" + branch);
      const who = { name: "someone", email: "someone@example.invalid", date: "2026-01-01T00:00:00Z" };
      const s = putCommit({ tree, parents: parents || (cur ? [cur] : []), message, author: who, committer: who });
      refs.set("heads/" + branch, s);
      return s;
    },
    writes() { return calls.filter((c) => c.method !== "GET"); },
    /** Plain-JSON state, for `createFakeGitHub({ snapshot })`. */
    snapshot() {
      return {
        seq,
        blobs: Object.fromEntries([...blobs].map(([k, v]) => [k, v.toString("base64")])),
        trees: Object.fromEntries(trees), commits: Object.fromEntries(commits), refs: Object.fromEntries(refs),
      };
    },
  };
  return fake;
}
