// src/sources/panels.js — whether two Xtream accounts sit on one panel (pure: no storage, no fetch).
//
// The bootstrap's ~50 hostnames are far fewer back-ends: one panel shows up under several hostnames, each with its own
// account (zee-ott, krishkaz and tmpes are one). Two accounts of one panel share their stream ids and their refusals, so
// only accounts on DIFFERENT panels are real failover for each other.
//
// The fingerprint is the set of (category_id, folded category_name) pairs of an account's get_live_categories, which
// the probe already fetched (0 extra requests). Resellers on one panel cannot rename its categories, their bouquets only
// pick subsets, so "same panel" = a high overlap coefficient |A∩B| / min(|A|, |B|) (a smaller bouquet is a subset);
// independent panels number their categories their own way (2026-11-17: 0 shared pairs in all 33 measured pairs, while
// same-panel pairs share 98–100 %). Bare ids would mislead: zee-ott and tresinl share 6 ids with other names.
//
// Each pair is an FNV-1a 32-bit hash. A stored fingerprint is a bottom-k sketch: `{ n, k }` = the number of pairs and the
// K smallest hashes in base 36 joined by "." (about 1 KB); below K pairs it is the whole set, so comparisons are exact.
// Two fingerprints (full or sketch) are compared below τ = the smaller of their largest kept hashes: every pair of
// either set under τ is known, so the overlap there is exact for that sample.
//   - same panel when the sample's overlap is ≥ SAME_RATIO, or ≥ SAME_MIN_SHARED pairs are shared;
//   - nothing to compare (m = 0) counts as the same panel: an account is never taken for independent on no evidence
//     (the cost of a false "same" is only trying the next candidate).

const K = 128;
const SAME_RATIO = 0.2;
const SAME_MIN_SHARED = 8;

const fold = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function fnv32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** An account's key: its server and user, never its password (stored and compared; never logged). */
export function accountKey(acc) {
  return acc ? fnv32(String(acc.url) + "|" + String(acc.username)).toString(36) : "";
}

/** The fingerprint of a raw get_live_categories answer: `{ n, h (sorted unique hashes), tau: Infinity }` (whole set). */
export function fingerprint(raw) {
  const set = new Set();
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || c.category_id == null) continue;
    set.add(fnv32(String(c.category_id) + "\u0001" + fold(c.category_name)));
  }
  const h = [...set].sort((a, b) => a - b);
  return { n: h.length, h, tau: Infinity };
}

/** What is stored of a fingerprint: `{ n, k }` (the K smallest hashes, base 36, ascending, "."-joined). */
export function sketchOf(fp) {
  return { n: fp.n, k: fp.h.slice(0, K).map((x) => x.toString(36)).join(".") };
}

/** A stored sketch back to a fingerprint `{ n, h, tau }` (tau = its largest hash when it is cut), or null. */
export function readSketch(s) {
  if (!s || typeof s.k !== "string" || !(Number(s.n) >= 0)) return null;
  const n = Number(s.n);
  const h = s.k ? s.k.split(".").map((x) => parseInt(x, 36)) : [];
  if (h.some((x) => !Number.isFinite(x) || x < 0) || h.length > K || h.length > n || (n <= K && h.length !== n)) return null;
  for (let i = 1; i < h.length; i++) if (!(h[i - 1] < h[i])) return null;
  return { n, h, tau: n > h.length ? h[h.length - 1] : Infinity };
}

/** `{ m, i }`: below τ, the size of the smaller sample and how many pairs both share. */
export function overlap(a, b) {
  const tau = Math.min(a.tau, b.tau);
  let i = 0, ma = 0, mb = 0, x = 0, y = 0;
  const A = a.h, B = b.h;
  while (x < A.length && A[x] <= tau) { ma++; x++; }
  while (y < B.length && B[y] <= tau) { mb++; y++; }
  for (let p = 0, q = 0; p < ma && q < mb;) {
    if (A[p] === B[q]) { i++; p++; q++; } else if (A[p] < B[q]) p++; else q++;
  }
  return { m: Math.min(ma, mb), i };
}

/**
 * Whether two fingerprints (full or sketch) are one panel. Nothing to compare (m = 0) counts as one panel, unless
 * `unknownIsSame` is false: releasing an account already held needs evidence, taking a new one needs independence.
 */
export function samePanel(a, b, unknownIsSame = true) {
  const { m, i } = overlap(a, b);
  if (m === 0) return unknownIsSame;
  return i >= SAME_MIN_SHARED || i / m >= SAME_RATIO;
}
