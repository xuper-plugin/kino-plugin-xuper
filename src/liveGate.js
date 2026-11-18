// liveGate.js — the bounds of every live request in one plugin call.
//
// - At most 5 requests in flight, at most 4 of them to one host. Kino runs 6 requests per runtime, 4 per host
//   (FetchGate: a request takes its host's share, then a place), and a request's own timeout only starts once it holds
//   both, so a 6th — or a 5th to one host — would wait in Kino's queue with no bound (its `timeoutMs`, computed here,
//   would then run past the deadline it was cut to). Such a request waits here instead, and its `timeoutMs` and the
//   strict start floor are checked when it can really start.
// - A deadline per call (default: 16 s after the call started; Kino cuts live calls, resolve and screen events at
//   20 s). No request STARTS after it: `liveFetch` throws a `deadline` error instead.
// - Each request's `timeoutMs` = clamp(deadline − now, 1000, wanted), and at most `maxTimeoutMs` when a caller set
//   one (the first-ever category aggregation uses 4,000). A request that times out under a `timeoutMs` shorter than
//   it asked for fails with its `timeout` error marked `limited`: the call's own bound, not the source failing.
// - At most `MAX_STARTED` requests started per call: Kino refuses a call's 61st (`invalid_request`, redirect hops
//   counted), so past 50 `liveFetch` throws a `budget` error instead (never recorded as the source failing).
// - `within(ms, fn)`: a soft deadline for every request STARTED inside `fn` (a merged channel's members are tried one at
//   a time, each with its own share of the call): `liveFetch`, `timeoutFor`, `remaining` and `deadline` honour it.
//   `{ strict: true }`: inside it a request never starts with less than MIN_TIMEOUT_MS left (it would otherwise get
//   1,000 ms and end up to a second past the soft deadline): Kino's first page of a merged category refreshes its stale
//   lists within a budget that must hold.
// The gate is per call: `beginCall()` (src/flight.js) bumps the call sequence and the next use builds a fresh gate,
// so nothing (neither the queue nor the deadline) is shared between two calls.
import { callSeq, callStartedAt } from "./flight.js";

export const MAX_IN_FLIGHT = 5;
export const MAX_PER_HOST = 4;   // Kino's MAX_FETCHES_PER_HOST
export const CALL_BUDGET_MS = 16000;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_STARTED = 50;
const DEFAULT_TIMEOUT_MS = 10000;

let gate = null;

function current() {
  const seq = callSeq();
  if (!gate || gate.seq !== seq) {
    gate = { seq, deadline: callStartedAt() + CALL_BUDGET_MS, soft: 0, strict: false, maxTimeoutMs: 0, inFlight: 0, hosts: new Map(), waiters: [], peak: 0, started: 0 };
  }
  return gate;
}

/** The error a request gets when the call's deadline has passed (code "deadline"). */
export function deadlineError() {
  const e = new Error("live: past this call's deadline, request not started");
  e.code = "deadline";
  return e;
}

/** The error past this call's request budget (code "budget"): nothing is sent. */
function budgetError() {
  const e = new Error("live: this call's request budget is spent, request not started");
  e.code = "budget";
  return e;
}

/** The deadline that applies now: the soft one of a running `within`, else the call's. */
const limit = (g) => (g.soft > 0 ? Math.min(g.soft, g.deadline) : g.deadline);

/** The least time a request needs left to start: MIN_TIMEOUT_MS inside a strict `within`, else any. */
const startFloor = (g) => (g.soft > 0 && g.strict ? MIN_TIMEOUT_MS : 0);

/**
 * Runs `fn` with a soft deadline `min(call deadline, now + ms)` for every request it starts (one `within` at a time:
 * the members of a merged channel are tried in turn). `opts.strict`: no request starts with less than MIN_TIMEOUT_MS
 * left, so nothing it starts ends past the soft deadline. The previous soft deadline is restored afterwards.
 */
export async function within(ms, fn, opts) {
  const g = current();
  const before = g.soft, beforeStrict = g.strict;
  g.soft = Math.min(g.deadline, Date.now() + Math.max(0, ms));
  g.strict = !!(opts && opts.strict);
  try {
    return await fn();
  } finally {
    if (current() === g) { g.soft = before; g.strict = beforeStrict; }
  }
}

/**
 * Tightens this call's bounds: `deadline` (epoch ms) only moves earlier, `maxTimeoutMs` only goes down.
 * The first-ever aggregation: `tighten({ deadline: callStartedAt() + 12000, maxTimeoutMs: 4000 })`.
 */
export function tighten(opts) {
  const g = current();
  const o = opts || {};
  if (Number.isFinite(o.deadline)) g.deadline = Math.min(g.deadline, o.deadline);
  if (o.maxTimeoutMs > 0) g.maxTimeoutMs = g.maxTimeoutMs > 0 ? Math.min(g.maxTimeoutMs, o.maxTimeoutMs) : o.maxTimeoutMs;
}

/** This call's deadline (epoch ms), or the soft one of a running `within`. */
export function deadline() { return limit(current()); }

/** Milliseconds left before this call's deadline (or a running `within`'s), ≤ 0 once past it. */
export function remaining() { return limit(current()) - Date.now(); }

/** How many requests this call has started (0: it never went to the network). */
export function startedInCall() { return current().started; }

/** Whether a strict `within` is running (Kino's first page refreshing stale lists within a budget that must hold). */
export function inStrictBudget() { const g = current(); return g.soft > 0 && g.strict; }

/**
 * The `timeoutMs` a request started now should carry: clamp(deadline − now, 1000, min(wanted, maxTimeoutMs)).
 * Throws the `deadline` error when the deadline has passed. For calls that do not go through `liveFetch`
 * (the backend's `authed(…, timeoutMs)`).
 */
export function timeoutFor(wantedMs) {
  const g = current();
  const left = limit(g) - Date.now();
  if (left <= 0 || left < startFloor(g)) throw deadlineError();
  const want = wantedMs > 0 ? wantedMs : DEFAULT_TIMEOUT_MS;
  const cap = g.maxTimeoutMs > 0 ? Math.min(want, g.maxTimeoutMs) : want;
  return Math.max(Math.min(MIN_TIMEOUT_MS, cap), Math.min(left, cap));
}

/** The host Kino's FetchGate keys a request by (OkHttp's `HttpUrl.host`: lower case, no port, no user info). */
export function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(String(url == null ? "" : url));
  return m ? m[1].toLowerCase() : "";
}

const fits = (g, host) => g.inFlight < MAX_IN_FLIGHT && (g.hosts.get(host) || 0) < MAX_PER_HOST;

function take(g, host) {
  g.inFlight++;
  g.hosts.set(host, (g.hosts.get(host) || 0) + 1);
  g.peak = Math.max(g.peak, g.inFlight);
}

/** A place for one request to `host`: at once when both its host's share and a place are free, else in turn. */
function acquire(g, host) {
  // A waiter never fits (release starts every one that does), so one that fits now overtakes only requests waiting
  // for another host's share: Kino's order too (a request waiting for its host holds no place).
  if (fits(g, host)) { take(g, host); return Promise.resolve(); }
  return new Promise((resolve) => g.waiters.push({ host, resolve }));
}

function release(g, host) {
  g.inFlight--;
  const n = (g.hosts.get(host) || 1) - 1;
  if (n > 0) g.hosts.set(host, n); else g.hosts.delete(host);
  // The places pass straight to the waiters that fit, first come first: none is left for a newcomer to take.
  for (let i = 0; i < g.waiters.length && g.inFlight < MAX_IN_FLIGHT;) {
    const w = g.waiters[i];
    if (fits(g, w.host)) { g.waiters.splice(i, 1); take(g, w.host); w.resolve(); } else i++;
  }
}

/**
 * `kino.fetch` under this call's bounds: waits for one of the 5 places (at most 4 per host, as Kino), refuses to start
 * past the deadline (throws the `deadline` error, nothing is sent) or past the request budget (`budget`), and clamps
 * `init.timeoutMs` (default 10,000) to what is left when it starts.
 * Everything else in `init` passes through unchanged.
 */
export async function liveFetch(url, init) {
  const g = current();
  if (Date.now() >= limit(g) - startFloor(g)) throw deadlineError();
  if (g.started >= MAX_STARTED) throw budgetError();
  const host = hostOf(url);
  await acquire(g, host);
  try {
    const wanted = init && init.timeoutMs > 0 ? init.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutMs = timeoutFor(wanted);
    if (g.started >= MAX_STARTED) throw budgetError();
    g.started++;
    try {
      return await kino.fetch(url, { ...(init || {}), timeoutMs });
    } catch (e) {
      throw timeoutMs < wanted ? limitedTimeout(e) : e;
    }
  } finally {
    release(g, host);
  }
}

/**
 * A `timeout` of a request whose `timeoutMs` this call's bounds made shorter than it asked for: the error marked
 * `limited` (the same object when it can be), so the framework does not count it as the source failing.
 */
function limitedTimeout(e) {
  if (!e || e.code !== "timeout") return e;
  try { e.limited = true; } catch (_) { /* a frozen error: copied below */ }
  if (e.limited === true) return e;
  return Object.assign(new Error(String(e.message || "timeout")), { code: "timeout", limited: true });
}

/** Test helper: this call's counters ({ inFlight, peak, started, deadline, maxTimeoutMs }). */
export function _gateStats() {
  const g = current();
  return { inFlight: g.inFlight, peak: g.peak, started: g.started, deadline: g.deadline, maxTimeoutMs: g.maxTimeoutMs };
}
