// Which pool seed a live channel opens with after the CDN refused it with a conflict (port of the
// native LiveSeedRotation, native-magis.md §6.6). A seed is a shared session: the CDN answers 409
// when it sees one license in use twice, so the channel moves to ANOTHER untried seed, up to
// MAX_ROTATIONS, then back to the device's own session. It only chooses; it never changes the
// stored session.
//
// Native keeps this in memory for the life of the process. The plugin's runtime can be discarded
// between calls, so the state is also kept in kino.storage, per channel, with a short ttl and only
// sns plus a digest of the refused key (never a license or a token). Every storage access is
// guarded: a full or refusing storage leaves the memory copy working and never fails the call.

export const MAX_ROTATIONS = 3;
export const ROTATION_TTL_MS = 30 * 60_000;
const MAX_CHANNELS = 12; // ~250 bytes each: the whole rotation state stays near 3 KB
const PREFIX = "liveRot:";

const isBlank = (s) => typeof s !== "string" || s.trim() === "";
const empty = () => ({ tried: [], active: null, last: null, at: 0 });

export function makeLiveRotation({ kino, clock, random, maxRotations = MAX_ROTATIONS, ttlMs = ROTATION_TTL_MS }) {
  const memory = new Map(); // channel -> state, insertion order = age

  const keyOf = (channel) => PREFIX + channel;
  const fresh = (state) => state && clock.now() - state.at < ttlMs;
  // What was refused, as a short digest: the refused key is a license.
  const digest = (key) => {
    try { return String(kino.crypto.hash("md5", String(key))).slice(0, 16); } catch (_) { return String(key).slice(0, 16); }
  };

  function parse(raw) {
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object" || !Array.isArray(o.t)) return null;
      return {
        tried: o.t.filter((s) => typeof s === "string"),
        active: typeof o.a === "string" ? o.a : null,
        last: typeof o.k === "string" ? o.k : null,
        at: typeof o.at === "number" ? o.at : 0,
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
    // The storage ttl is the real expiry; `at` is only for the memory copy and for eviction.
    const stored = typeof raw === "string" ? parse(raw) : null;
    if (stored) remember(channel, stored);
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
      kino.storage.set(keyOf(channel), JSON.stringify({ t: state.tried, a: state.active, k: state.last, at: state.at }), { ttlMs });
    } catch (_) { /* quota or refusal: the memory copy still holds for this runtime */ }
  }

  /** The sn of the seed [channel] should open with now, or null for the device's own session. */
  const activeSn = (channel) => read(channel)?.active ?? null;

  /** How many sessions were refused on [channel] so far, the device's own included. */
  const triedCount = (channel) => read(channel)?.tried.length ?? 0;

  /**
   * [channel] was refused while it used [currentSn] (the device's own, or the rotated seed). Picks an
   * untried pool seed with an sn; false when the budget is spent or nothing new is left (then the
   * channel goes back to the device's own session). The same [refusedKey] twice in a row counts once.
   */
  function onRefused(channel, currentSn, pool, refusedKey) {
    const state = read(channel) || empty();
    const key = digest(refusedKey);
    if (state.last === key) return state.active !== null;
    state.last = key;
    const refused = state.active ?? currentSn;
    if (!state.tried.includes(refused)) state.tried.push(refused);
    const rotationsSoFar = state.tried.length - 1;
    let next = null;
    if (rotationsSoFar < maxRotations) {
      const candidates = (Array.isArray(pool) ? pool : []).filter((e) => e && !isBlank(e.sn) && !state.tried.includes(e.sn));
      if (candidates.length > 0) next = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))].sn;
    }
    state.active = next;
    write(channel, state);
    return next !== null;
  }

  /** Forgets [channel]: back to the device's own session with a fresh budget. */
  function reset(channel) {
    memory.delete(channel);
    try { kino.storage.remove(keyOf(channel)); } catch (_) { /* nothing to undo */ }
  }

  return { activeSn, triedCount, onRefused, reset };
}
