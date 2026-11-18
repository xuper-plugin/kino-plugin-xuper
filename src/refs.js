// The plugin's OPAQUE refs (a string Kino hands back as it got it). Format "<kind>:<a>:<b>":
//   v:<contentId>:<type>      a VOD item (type: "1" = movie, "0" = series)
//   e:<episodeId>:<seriesId>  an episode of a series
//   cat:<name>                a whole section (pelicula/series/anime/ninos)
//   col:<columnId>[:a]        a column/collection (a row's "Ver más"); ":a" = its titles are 18+ (an Adultos row)
//   L:<source>:<channel>      an AGGREGATED live channel — <source> = the connector's id, <channel> URL-encoded.
//                             resolve dispatches to src/sources/<source>.resolve(<channel>).
//   M:<source>:<channel>,<source>:<channel>,…
//                             the same live channel in several sources (src/liveMerge.js): its members' `L:` refs
//                             without their "L:", best first. encodeURIComponent always encodes "," ":" and "|", and a
//                             source id has none of them, so the list splits safely. A live event whose own ref is too
//                             long to fit (a cncverse event carries its whole descriptor, 1–3 KB) is written as its
//                             Kino id `<source>_<hash>` instead (no ":"; [A-Za-z0-9._~-] only): src/live.js finds it in
//                             the stored lists of that source at resolve time.
// Every one of them has a ":". What Xuper 2.x gave Kino (src/legacy.js) never reads as one of them: decodeRef answers
// it as kind "legacy" (a masnew title or chapter: magis1:… or the gateway form) or "legacyLive" (a masnew channel code,
// bare or xlive1:…).

import { decodeMagis, legacyLiveCode } from "./legacy.js";

export function itemRef(contentId, type) {
  return `v:${contentId}:${type == null ? "" : type}`;
}
export function episodeRef(episodeId, seriesId) {
  return `e:${episodeId}:${seriesId || ""}`;
}
export function catRef(name) { return `cat:${name}`; }
/** A portal column's "Ver más". `adult`: the row is an Adultos one, so `browse` marks every title it pages as 18+. */
export function colRef(columnId, adult = false) { return `col:${columnId}${adult ? ":a" : ""}`; }
// An aggregated live channel: "L:<source>:<channel>". <channel> is URL-encoded (a URL, an Xtream id, a slug, a base64
// descriptor...), so it never collides with the ":" and "|" separators. <source> is a connector id with no ":"
// (e.g. "premiumtv", "supertv").
export function liveRef(source, channel) {
  return `L:${source}:${encodeURIComponent(channel == null ? "" : String(channel))}`;
}

// An orthogonal quality mark: `<ref>|<quality>` (e.g. "v:123:1|720p"). A "|" never appears in a contentId, type or
// series (they are ids), so it never collides. The quality picker uses it (lazy alternatives).
export function withQuality(ref, quality) {
  return quality ? `${ref}|${quality}` : ref;
}

/** A merged live channel's ref from its members (best first): each an `L:` ref, or a stored channel's Kino id. */
export function mergedRef(members) {
  return "M:" + members.map((r) => { const s = String(r); return s.startsWith("L:") ? s.slice(2) : s; }).join(",");
}

// A member written by its Kino id: "<source>_<hash>" (a source id has no "_"; the hash is base 36).
const MEMBER_ID = /^([a-z0-9-]{1,40})_([0-9a-z]{1,16})$/;

function liveMember(part) {
  const j = part.indexOf(":");
  if (j < 0) {
    const m = MEMBER_ID.exec(part);
    if (m) return { source: m[1], channel: null, id: part, ref: null };
  }
  const source = j < 0 ? part : part.slice(0, j);
  let channel = j < 0 ? "" : part.slice(j + 1);
  try { channel = decodeURIComponent(channel); } catch (_) { /* stays raw */ }
  return { source, channel, ref: "L:" + part };
}

export function decodeRef(ref) {
  const raw = String(ref || "");
  let s = raw;
  let quality = "";
  const bar = s.indexOf("|");
  if (bar >= 0) { quality = s.slice(bar + 1); s = s.slice(0, bar); }
  const i = s.indexOf(":");
  const kind = i < 0 ? s : s.slice(0, i);
  const rest = i < 0 ? "" : s.slice(i + 1);
  if (kind === "v") {
    const j = rest.lastIndexOf(":");
    const out = { kind: "item", id: j < 0 ? rest : rest.slice(0, j), type: j < 0 ? "" : rest.slice(j + 1) };
    if (quality) out.quality = quality;
    return out;
  }
  if (kind === "e") {
    const j = rest.indexOf(":");
    const out = { kind: "episode", id: j < 0 ? rest : rest.slice(0, j), series: j < 0 ? "" : rest.slice(j + 1) };
    if (quality) out.quality = quality;
    return out;
  }
  if (kind === "cat") return { kind: "category", name: rest };
  if (kind === "col") {
    const j = rest.indexOf(":");
    if (j < 0) return { kind: "column", columnId: rest };
    const out = { kind: "column", columnId: rest.slice(0, j) };
    if (rest.slice(j + 1) === "a") out.adult = true;
    return out;
  }
  if (kind === "L") {
    const m = liveMember(rest);
    return { kind: "live", source: m.source, channel: m.channel };
  }
  if (kind === "M") {
    // A merged channel: its first member is the one `catalog.resolve` routes on; `members` lists them all.
    const members = rest.split(",").filter(Boolean).map(liveMember);
    if (!members.length) return legacyRef(raw) || { kind: "unknown", raw: s };
    return { kind: "live", source: members[0].source, channel: members[0].channel, members };
  }
  return legacyRef(raw) || { kind: "unknown", raw: s };
}

/**
 * A ref Xuper 2.x gave Kino (src/legacy.js): `{ kind: "legacy", contentId, programType, episode, isSeries }` (a masnew
 * title or chapter) or `{ kind: "legacyLive", code }` (a masnew channel), else null.
 */
function legacyRef(raw) {
  const m = decodeMagis(raw);
  if (m) return { kind: "legacy", ...m };
  const code = legacyLiveCode(raw);
  return code !== null ? { kind: "legacyLive", code } : null;
}
