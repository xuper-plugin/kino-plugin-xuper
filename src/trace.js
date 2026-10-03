// Breadcrumbs for Kino's error board: when a call fails, the app sends the plugin's last kino.log
// lines of that call with the report (scrubbed, 2 KB in all). Each line is `xuper:<area> <event> k=v ...`
// and carries codes, counts and indexes only: a value that is not a short plain word is written `?`,
// and a key that names a secret or an address is dropped, so a slip can never log a token, an sn,
// an email, a host or a url. Never throws.

export const MAX_LINE_CHARS = 160;
const NAME = /^[a-z][a-z0-9_-]{0,23}$/; // area and event: `decrypt-fail` too
const KEY = /^[a-z][a-zA-Z0-9]{0,11}$/;
// What a key may never be about (the app's scrubber also blanks `session=`, `token=`, `auth=`...).
const SENSITIVE_KEY = /pass|token|secret|cred|auth|bearer|cookie|session|key|mail|host|url|^sn$|user|license|sign/i;
const VALUE = /^[A-Za-z0-9_\/-]{1,32}$/;

function word(v) {
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v)) : "?";
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = typeof v === "string" ? v : "";
  return VALUE.test(s) ? s : "?";
}

/** Writes one breadcrumb. `fields`: { key: string | number | boolean }; null/undefined are left out. */
export function trace(kino, area, event, fields = {}) {
  try {
    const parts = [`xuper:${NAME.test(area) ? area : "?"}`, NAME.test(event) ? event : "?"];
    if (fields !== null && typeof fields === "object") {
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || v === null || !KEY.test(k) || SENSITIVE_KEY.test(k)) continue;
        parts.push(`${k}=${word(v)}`);
      }
    }
    kino.log(parts.join(" ").slice(0, MAX_LINE_CHARS));
  } catch (_) { /* a breadcrumb never fails a call */ }
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
 * Runs export `fn`'s body; when it fails, one `xuper:call fail fn=<fn> code=<code> ms=<elapsed>` line
 * (the error itself is rethrown untouched). A success writes nothing: its lines would never be sent.
 */
export async function traced(kino, clock, fn, body) {
  const t0 = clock.now();
  try {
    return await body();
  } catch (e) {
    trace(kino, "call", "fail", { fn, code: errCode(e), ms: clock.now() - t0 });
    throw e;
  }
}

/** 8 hex characters of a hash of a seed's sn: tells seeds apart in a report, never the sn. */
export function seedTag(kino, sn) {
  try {
    if (typeof sn !== "string" || sn === "") return "?";
    return String(kino.crypto.hash("sha256", "xuper-seed\n" + sn)).slice(0, 8);
  } catch (_) { return "?"; }
}
