// Which pool seed a live channel opens with after the CDN refused it with a conflict (port of the
// native LiveSeedRotation, native-magis.md §6.6). A seed is a shared session: the CDN answers 409
// when it sees one license in use twice, so the channel moves to ANOTHER untried seed, up to
// MAX_ROTATIONS, then back to the device's own session. It only chooses; it never changes the
// stored session.
//
// Bounded per channel per window (native 2d285106): a channel's budget lasts ROTATION_TTL_MS from
// its FIRST refusal; once spent, the channel stays on the device's own session for the rest of that
// window whatever more refusals come (`already_exhausted`), so it never cycles through the pool.
// The seed a rotation landed on is CARRIED to the channels opened next (same window): a device whose
// own seed is in use elsewhere would otherwise pay a 409 and a reopen on every channel it zaps to.
// A channel with no refusal of its own starts on the carried seed; if that one is refused there it
// rotates from it, never back to the sessions refused before it (they are `excluded`, not counted).
//
// Native keeps this in memory for the life of the process. The plugin's runtime can be discarded
// between calls, so the state is also kept in kino.storage (per channel, plus one carried entry)
// with the window's remaining ttl and only sns plus a digest of the refused key (never a license or
// a token). Every storage access is guarded: a full or refusing storage leaves the memory copy
// working and never fails the call.
import { isBlank } from "./util.js";

export const MAX_ROTATIONS = 3;
export const ROTATION_TTL_MS = 30 * 60_000;
/** How many refused sessions a carried seed remembers (the oldest are forgotten first). */
export const MAX_CARRIED_REFUSALS = 16;
const MAX_CHANNELS = 12; // each <= ~1 KB (tried + excluded sns): the whole state stays under 16 KB
const PREFIX = "liveRot:";
const CARRIED_KEY = "liveRotCarried";

const empty = (now) => ({ tried: [], excluded: [], active: null, last: null, at: now, started: now, exhausted: false });
const strings = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === "string") : []);

export function makeLiveRotation({ kino, clock, random, maxRotations = MAX_ROTATIONS, ttlMs = ROTATION_TTL_MS }) {
  const memory = new Map(); // channel -> state, insertion order = age
  let carriedMemory; // undefined = not read yet in this runtime, null = none

  const keyOf = (channel) => PREFIX + channel;
  const inWindow = (since) => { const age = clock.now() - since; return age >= 0 && age < ttlMs; };
  const fresh = (state) => Boolean(state) && inWindow(state.started);
  const ttlLeft = (since) => Math.max(1, ttlMs - Math.max(0, clock.now() - since));
  // What was refused, as a short digest: the refused key is a license, so it is never stored as it
  // is. If the host cannot hash, the digest is `null` ("unknown"): nothing is stored and the
  // "same refusal twice counts once" shortcut is simply not applied.
  const digest = (key) => {
    try {
      const d = kino.crypto.hash("md5", String(key));
      return typeof d === "string" && d !== "" ? d.slice(0, 16) : null;
    } catch (_) { return null; }
  };

  function parse(raw) {
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object" || !Array.isArray(o.t)) return null;
      const at = typeof o.at === "number" ? o.at : 0;
      return {
        tried: strings(o.t),
        excluded: strings(o.x),
        active: typeof o.a === "string" ? o.a : null,
        last: typeof o.k === "string" ? o.k : null,
        at,
        started: typeof o.s === "number" ? o.s : at, // an older entry has no start: its last write
        exhausted: o.e === true,
      };
    } catch (_) { return null; }
  }

  function read(channel) {
    const mem = memory.get(channel);
    if (mem) {
      if (fresh(mem)) return mem;
      memory.delete(channel);
    }
    let raw = null;
    try { raw = kino.storage.get(keyOf(channel)); } catch (_) { /* unreadable: nothing kept */ }
    const stored = typeof raw === "string" ? parse(raw) : null;
    if (!fresh(stored)) return null;
    remember(channel, stored);
    return stored;
  }

  function remember(channel, state) {
    memory.delete(channel);
    memory.set(channel, state);
    while (memory.size > MAX_CHANNELS) memory.delete(memory.keys().next().value);
  }

  // Before a channel's first write: the oldest stored states go, so at most MAX_CHANNELS are kept.
  function evictFor(channel) {
    try {
      const own = keyOf(channel);
      const keys = kino.storage.keys().filter((k) => k.startsWith(PREFIX) && k !== own);
      if (keys.length < MAX_CHANNELS) return;
      const aged = keys.map((k) => {
        let at = 0;
        try { at = parse(kino.storage.get(k))?.at ?? 0; } catch (_) { /* treated as oldest */ }
        return { k, at };
      }).sort((x, y) => x.at - y.at);
      for (const { k } of aged.slice(0, keys.length - MAX_CHANNELS + 1)) kino.storage.remove(k);
    } catch (_) { /* best effort */ }
  }

  function write(channel, state) {
    state.at = clock.now();
    remember(channel, state);
    try {
      let exists = false;
      try { exists = kino.storage.get(keyOf(channel)) !== null; } catch (_) { /* unknown: evict to be safe */ }
      if (!exists) evictFor(channel);
      const o = { t: state.tried, a: state.active, k: state.last, at: state.at, s: state.started };
      if (state.excluded.length > 0) o.x = state.excluded;
      if (state.exhausted) o.e = true;
      kino.storage.set(keyOf(channel), JSON.stringify(o), { ttlMs: ttlLeft(state.started) });
    } catch (_) { /* quota or refusal: the memory copy still holds for this runtime */ }
  }

  /** The carried seed while its window is open: `{ sn, at, refused }`, or null. */
  function carried() {
    if (carriedMemory === undefined) {
      carriedMemory = null;
      try {
        const raw = kino.storage.get(CARRIED_KEY);
        const o = typeof raw === "string" ? JSON.parse(raw) : null;
        if (o && typeof o.a === "string" && typeof o.at === "number") carriedMemory = { sn: o.a, at: o.at, refused: strings(o.r) };
      } catch (_) { /* nothing carried */ }
    }
    return carriedMemory && inWindow(carriedMemory.at) ? carriedMemory : null;
  }

  function setCarried(value) {
    carriedMemory = value;
    try {
      if (value === null) kino.storage.remove(CARRIED_KEY);
      else kino.storage.set(CARRIED_KEY, JSON.stringify({ a: value.sn, at: value.at, r: value.refused }), { ttlMs: ttlLeft(value.at) });
    } catch (_) { /* the memory copy still holds for this runtime */ }
  }

  /** The sn of the seed [channel] should open with now (its own rotation, else the carried seed), or null for the device's own session. */
  function activeSn(channel) {
    const state = read(channel);
    if (state) return state.active;
    return carried()?.sn ?? null;
  }

  /** How many sessions were refused on [channel] in its window, the device's own included. */
  const triedCount = (channel) => read(channel)?.tried.length ?? 0;

  /**
   * [channel] was refused while it used [currentSn] (the device's own, or the seed in use). Says what
   * happened: "rotated" (moved to an untried pool seed with an sn), "exhausted" (this refusal spent
   * the budget or nothing new was left: back to the own session), "already_exhausted" (the budget was
   * already spent in this window: nothing changes) or "repeated" (the same [refusedKey] again: the
   * player retries the playlist, it counts once).
   */
  function refuse(channel, currentSn, pool, refusedKey) {
    let state = read(channel);
    if (!state) {
      state = empty(clock.now());
      // Starting on the carried seed: the sessions refused before it (the device's own) are known bad.
      const c = carried();
      if (c) { state.active = c.sn; state.excluded = c.refused.slice(); }
    }
    if (state.exhausted) return "already_exhausted";
    const key = digest(refusedKey);
    if (key !== null && state.last === key) return "repeated";
    state.last = key;
    const refused = state.active ?? currentSn;
    if (!state.tried.includes(refused)) state.tried.push(refused);
    // The device's own session counts as the first try, whichever way the channel started.
    const rotationsSoFar = state.tried.length - 1;
    let next = null;
    if (rotationsSoFar < maxRotations) {
      const candidates = (Array.isArray(pool) ? pool : [])
        .filter((e) => e && !isBlank(e.sn) && !state.tried.includes(e.sn) && !state.excluded.includes(e.sn));
      if (candidates.length > 0) next = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))].sn;
    }
    state.active = next;
    const c = carried();
    let outcome;
    if (next !== null) {
      const refusedSns = c ? c.refused.slice() : [];
      if (!refusedSns.includes(refused)) refusedSns.push(refused);
      setCarried({ sn: next, at: clock.now(), refused: refusedSns.slice(-MAX_CARRIED_REFUSALS) });
      outcome = "rotated";
    } else {
      state.exhausted = true;
      // A carried seed refused here with nothing left to move to is not offered to the next channel either.
      if (c && state.tried.includes(c.sn)) setCarried(null);
      outcome = "exhausted";
    }
    write(channel, state);
    return outcome;
  }

  /** [refuse] as a boolean: true while the channel is on a seed after this refusal. */
  function onRefused(channel, currentSn, pool, refusedKey) {
    const outcome = refuse(channel, currentSn, pool, refusedKey);
    if (outcome === "rotated") return true;
    if (outcome === "repeated") return activeSn(channel) !== null;
    return false;
  }

  return { activeSn, triedCount, refuse, onRefused };
}
