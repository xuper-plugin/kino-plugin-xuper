// flight.js — per-call single-flight.
//
// Kino serializes the calls of one plugin inside one runtime, so every export clears the table first
// (`beginCall()`): a flight never spans two calls and no promise is ever reused across calls. Inside one call,
// `once(key, fn)` runs `fn` at most once and every caller of the same key shares its promise (a rejection too).
// `once(key, fn, { force: true })` starts a fresh run even when the key already ran in this call; later callers
// of that key then share the forced run (a re-list after "no streams", a reload).

const flights = new Map();
let seq = 0;
let startedAt = 0;

/** Starts a new plugin call: forgets every flight of the previous one. */
export function beginCall() {
  flights.clear();
  seq++;
  startedAt = Date.now();
}

/** Runs `fn` once per call for `key`; `{ force: true }` re-runs it and replaces the shared flight. */
export function once(key, fn, opts) {
  const force = !!(opts && opts.force);
  let p = force ? undefined : flights.get(key);
  if (!p) {
    p = Promise.resolve().then(fn);
    flights.set(key, p);
  }
  return p;
}

/** Whether `once(key, …)` already ran (or is running) in this call: its result costs nothing more. */
export function inFlight(key) { return flights.has(key); }

/** Epoch ms of the current call's `beginCall()` (0 before the first one): the base for per-call deadlines. */
export function callStartedAt() { return startedAt || Date.now(); }

/** How far in the future a stored timestamp may be before it counts as a clock that ran ahead and was set back. */
export const CLOCK_SKEW_MS = 60 * 1000;

/**
 * A stored timestamp (epoch ms), or 0 when it is more than `CLOCK_SKEW_MS` in the future. A device whose clock ran
 * ahead (a wrong date, then an NTP correction) leaves every stored `at` / `checkedAt` / `failAt` in the future: read
 * as-is, every age would be negative (always fresh), every write would look "newer elsewhere" and every backoff
 * would last until real time caught up. Read through this, such a stamp means "never": stale, refetched once, and
 * rewritten with a sane stamp.
 */
export function saneAt(at, now) {
  const n = Number(at) || 0;
  return n > (now === undefined ? Date.now() : now) + CLOCK_SKEW_MS ? 0 : n;
}

/** A counter bumped by every `beginCall()` (tests use it to prove each export starts a call). */
export function callSeq() { return seq; }

// The export that started the current call ("resolve", "liveChannels", "screenEvent"…): set by src/plugin.js right after
// `beginCall()`, read by src/seeds.js (only some calls may ask the backend for a seed). Unset for this call: "".
let purpose = { seq: -1, name: "" };

/** Names the export that started this call. */
export function callFor(name) { purpose = { seq, name: String(name || "") }; }

/** The export that started this call, or "" when it was not named. */
export function callName() { return purpose.seq === seq ? purpose.name : ""; }
