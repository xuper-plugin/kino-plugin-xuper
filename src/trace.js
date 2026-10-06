// Breadcrumbs for Kino's error board: when a call fails, the app sends the plugin's last kino.log
// lines of that call with the report (scrubbed, 2 KB in all). Each line is `xuper:<area> <event> k=v ...`
// and carries codes, counts and indexes only: a value that is not a short plain word is written `?`,
// and a key that names a secret or an address is dropped, so a slip can never log a token, an sn,
// an email, a host or a url. Never throws.

export const MAX_LINE_CHARS = 160;
const NAME = /^[a-z][a-z0-9_-]{0,19}$/; // area and event: `decrypt-fail` too
const KEY = /^[a-z][a-zA-Z0-9]{0,11}$/;
// What a key may never be about (the app's scrubber also blanks `session=`, `token=`, `auth=`...).
const SENSITIVE_KEY = /pass|token|secret|cred|auth|bearer|cookie|session|key|mail|host|url|^sn$|user|license|sign/i;
// A value is a short plain word: at most 20 characters, and never something shaped like an id even
// when a caller passes one by mistake (a 32-hex token, an sn, a userId): no run of 12+ hex
// characters or 10+ digits.
const VALUE = /^[A-Za-z0-9_\/-]{1,20}$/;
const ID_SHAPED = /[0-9a-fA-F]{12}|[0-9]{10}/;
// The app's scrubber turns any 24+ run of [A-Za-z0-9+/_=-] (the `k=` included) and any 16+ word
// with a digit into `[id]`: such a field would reach the board blanked, so it is written `?`.
const APP_BLOB_CHARS = 24;
const APP_LONG_TOKEN = /(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}/;

function word(v) {
  let s;
  if (typeof v === "number") s = Number.isFinite(v) ? String(Math.round(v)) : "?";
  else if (typeof v === "boolean") return v ? "1" : "0";
  else s = typeof v === "string" ? v : "";
  return VALUE.test(s) && !ID_SHAPED.test(s) ? s : "?";
}

/** `k=v`, or `k=?` when the app's scrubber would blank it. */
function field(k, v) {
  const w = word(v);
  return (k.length + 1 + w.length >= APP_BLOB_CHARS || APP_LONG_TOKEN.test(w)) ? `${k}=?` : `${k}=${w}`;
}

function lineOf(area, event, fields) {
  const parts = [`xuper:${NAME.test(area) ? area : "?"}`, NAME.test(event) ? event : "?"];
  if (fields !== null && typeof fields === "object") {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null || !KEY.test(k) || SENSITIVE_KEY.test(k)) continue;
      parts.push(field(k, v));
    }
  }
  return parts.join(" ").slice(0, MAX_LINE_CHARS);
}

/** Writes one breadcrumb. `fields`: { key: string | number | boolean }; null/undefined are left out. */
export function trace(kino, area, event, fields = {}) {
  try {
    kino.log(lineOf(area, event, fields));
  } catch (_) { /* a breadcrumb never fails a call */ }
}

/**
 * The same breadcrumb, for a call that WORKED in a degraded way (a seed session, anonymous after a failed
 * login): written with `kino.log.report` (apiVersion 6, manifest `"telemetry": true`), so the app also sends
 * it to the error board as a warning, at most once an hour per area (the line's first word, `xuper:<area>`).
 * An app without `kino.log.report` gets a plain log line. Never throws.
 */
export function report(kino, area, event, fields = {}) {
  try {
    const line = lineOf(area, event, fields);
    if (kino.log && typeof kino.log.report === "function") kino.log.report(line);
    else kino.log(line);
  } catch (_) { /* a breadcrumb never fails a call */ }
}

// ---- performance reports (2.2.9) ----------------------------------------------------------------
// Sent with kino.log.report (the manifest declares "telemetry": "verbose"), so they reach Kino's error
// board even when the call worked; Kino keeps one a minute per area and 60 per run. Codes, counts and
// time buckets only. The areas, to query them on the board:
//   xuper:perf_slow     a call that took 8 s or more:       fn, b (time bucket), ok
//   xuper:perf_timeout  a call that took 20 s or more (Kino had already given up on it): fn, b, ok
//   xuper:perf_cold     a start that stored roots of a catalog not complete yet: stored, of, b; `done` once complete
//   xuper:perf_store    a snapshot write: b, kb (size bucket), step (how it was trimmed)
//   xuper:perf_decode   the first big portal answer of a sandbox: how (host|engine), kb, b
export const PERF_AREAS = Object.freeze({ slow: "perf_slow", timeout: "perf_timeout", cold: "perf_cold", store: "perf_store", decode: "perf_decode" });
export const SLOW_CALL_MS = 8_000;
export const TIMEOUT_CALL_MS = 20_000;

/** A time as a bucket word: lt1s, 1-2s, 2-4s, 4-8s, 8-12s, 12-16s, 16-20s, 20-30s, 30-60s, ge60s. */
export function msBucket(ms) {
  const s = Number.isFinite(ms) ? ms / 1000 : 0;
  const edges = [[1, "lt1s"], [2, "1-2s"], [4, "2-4s"], [8, "4-8s"], [12, "8-12s"], [16, "12-16s"], [20, "16-20s"], [30, "20-30s"], [60, "30-60s"]];
  for (const [limit, word] of edges) if (s < limit) return word;
  return "ge60s";
}

/** A size in bytes as a bucket word: lt256k, 256-512k, 512k-1m, 1-2m, 2-4m, ge4m. */
export function kbBucket(bytes) {
  const kb = Number.isFinite(bytes) ? bytes / 1024 : 0;
  const edges = [[256, "lt256k"], [512, "256-512k"], [1024, "512k-1m"], [2048, "1-2m"], [4096, "2-4m"]];
  for (const [limit, word] of edges) if (kb < limit) return word;
  return "ge4m";
}

/**
 * A call's time, reported when slow (and again when Kino had already given up on it). `more`: short fields
 * of the call's own (`served=cache got=0 fail=1`), counts and words only. Never throws.
 */
export function reportCallTime(kino, fn, ms, ok, more = {}) {
  if (!(ms >= SLOW_CALL_MS)) return;
  report(kino, PERF_AREAS.slow, "call", { fn, b: msBucket(ms), ok, ...more });
  if (ms >= TIMEOUT_CALL_MS) report(kino, PERF_AREAS.timeout, "call", { fn, b: msBucket(ms), ok, ...more });
}

/** The crypto's onDecode: one report per sandbox, for its first answer of 1 MB or more. */
export function makeDecodeReporter(kino) {
  let done = false;
  return ({ how, bytes, ms }) => {
    if (done || !(bytes >= 1_000_000)) return;
    done = true;
    report(kino, PERF_AREAS.decode, "wire", { how, kb: kbBucket(bytes), b: msBucket(ms) });
  };
}

/** A short code for an error: the portal's returnCode, a kino error's code, else its name. Never its message. */
export function errCode(e) {
  if (e === null || typeof e !== "object") return "error";
  const name = typeof e.name === "string" ? e.name : "";
  let c = "";
  if (name === "PortalError" && typeof e.code === "string") c = e.code;
  else if (name.startsWith("KinoError_")) c = name.slice("KinoError_".length);
  else c = name;
  return VALUE.test(c) ? c : "error";
}

/**
 * Runs export `fn`'s body between two breadcrumbs: `xuper:call start fn=<fn>` and, at its end,
 * `xuper:call ok fn=<fn> ms=<elapsed>` (with `n=<count>` for a list) or `xuper:call fail fn=<fn> code=<code> ms=<elapsed>`
 * (the error itself is rethrown untouched). [extra]: short fields of Kino's own (`kind=live`) on both lines.
 * A success's lines never reach the board on their own (only a failed call's travel), but a debug install reads them in
 * its Registro and in logcat (`KinoPlugin/xuper`). [late]: a function answering fields known only once the body ended
 * (`served=fresh|cache|partial got= fail=`, 2.2.14), added to the end line and the perf reports; it never fails the call.
 */
export async function traced(kino, clock, fn, body, extra = {}, late = null) {
  const t0 = clock.now();
  trace(kino, "call", "start", { fn, ...extra });
  const lateFields = () => {
    if (typeof late !== "function") return {};
    try { const f = late(); return f !== null && typeof f === "object" ? f : {}; } catch (_) { return {}; }
  };
  let out;
  try {
    out = await body();
  } catch (e) {
    const ms = clock.now() - t0;
    const more = lateFields();
    trace(kino, "call", "fail", { fn, ...extra, code: errCode(e), ms, ...more });
    reportCallTime(kino, fn, ms, false, more);
    throw e;
  }
  const ms = clock.now() - t0;
  const more = lateFields();
  trace(kino, "call", "ok", { fn, ...extra, ms, n: Array.isArray(out) ? out.length : undefined, ...more });
  reportCallTime(kino, fn, ms, true, more);
  return out;
}

/** 8 hex characters of a hash of a seed's sn: tells seeds apart in a report, never the sn. */
export function seedTag(kino, sn) {
  try {
    if (typeof sn !== "string" || sn === "") return "?";
    return String(kino.crypto.hash("sha256", "xuper-seed\n" + sn)).slice(0, 8);
  } catch (_) { return "?"; }
}
