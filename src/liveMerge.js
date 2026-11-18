// liveMerge.js — the same channel shown once (pure: no storage, no network). Inside ONE exposed category
// (src/liveMap.js), channels that are the same channel in several sources, or one source's HD / SD / "[Opc.2]" copies,
// become one channel: it keeps its primary member's id, title (without copy markers, below) and logo, and its ref
// lists every member (`M:` refs, src/refs.js) so `resolveLive` can fall through them. A channel with one member keeps
// its own `L:` ref.
//
// The name key is conservative: "ESPN" ≠ "ESPN 2", "Fox Sports" ≠ "Fox Sports 2", "ESPN (MX)" ≠ "ESPN" outside Mexico's
// category, "MX: ESPN" ≠ "CL: ESPN", a match or an event slot never merges, and a bare number ("Canal 13") merges only
// inside a single-country category. It ignores spaces ("BluRadio" = "Blu Radio", "ESPN2" = "ESPN 2"; a space between
// two numbers still counts), knows a few brand renames ("Directv Sports" = "DSports", "Win Sports Plus" = "Win+",
// "LaLiga TV 2" = "LaLiga 2"; inside Spain's category "Movistar LaLiga" = "M+ LaLiga"), takes backup copies for copies
// ("(FHD REPUESTO)", a bare "ALTERNATIVA"), and reads a bare country code at the end as that country's name ("ESPN CO" =
// "ESPN Colombia"; inside Colombia's own category both are just "ESPN").
//
// Live events (`opts.events`, "Eventos en vivo") merge by their own rule: the same event title (decorations off: "LIVE:",
// a slot number, a channel and time suffix, a league suffix) in two sources when both start within 15 min; two rows of
// ONE source only when both carry the same start time (two NPL matches, an FP1 and a race under one title stay apart).
// A row with no start joins a match ("A vs B", "A - B") of another source only while that one is on (started, or
// starting within 15 min, and not over), the one that started closest to now: never tomorrow's session of it. A source
// that aggregates upstream providers names each row's (`origin`: nuvio's dlv / ak47, cncverse's SKTech / PlayFy…): two
// providers count as two sources. An event whose own ref is too long for an `M:` ref (cncverse's carry their whole
// descriptor) joins by its Kino id (src/refs.js). An event that is over is not listed: past the latest end any of its
// rows stores (+30 min), else 14 h after its latest start (a whole day of tennis, a cricket day: 8–12 h by the
// providers' own schedules).
//
// A secondary member (`memberList.secondary`: one of supertv's other panels) joins the primary's channels by name only,
// never by stream id (each panel numbers its streams its own way), after every primary member and at most
// SEC_PER_GROUP copies per panel (its best): it is failover for when the primary's account refuses. Its rows that are
// a match, an event or a numbered feed of its own ("PPV 04:", "DAZN EVENTOS 3", "ALTERNATIVA 2", "REPLAY 3": what each
// panel puts on them differs), or that carry something only during events ("(Solo Eventos)"), are not listed, and copies that would not fit in the merged ref are left out instead of making a
// second row. A channel only secondary panels list is not listed at all: its id and ref would encode the slot's
// current account, which changes on any refusal, so a favourite of it could never survive (and those panels are there
// for failover, not for channels of their own).
//
// Shown titles (src/liveTitles.js) lose the panels' decorations ("┃ES┃", "ES ▎", "|MX|", "UK:", "(BR)", "(HD)") in every
// category, and their copy markers ("[Opc.1]", "(Opc.2)", a trailing "(2)") in a category that merges; whatever would
// make two channels of the category look the same comes back for those (copies left apart keep "[Opc.1]" / "[Opc.2]").
// A category that never merges (an old `<src>.<hex>` id, a "Más canales" bucket, Xuper's whole list) keeps the copy
// markers. Ids and refs never change, so Kino still finds a saved channel by its id and name, else by its ref (a merged
// one once Kino healed it to the `M:` ref), and plays a favourite from its own ref when no listing holds it.
import { mergedRef } from "./refs.js";
import { flagCountry } from "./liveMap.js";
import { shownTitles } from "./liveTitles.js";

/** A merged ref stays under this many characters: Kino stores a favourite's ref only while its wrapped form
 * (`plg1:xuper:` + base64url of `{"id","k","r"}`, about 4/3 longer) is ≤ 2048. */
export const MERGED_REF_MAX = 1400;
/** A member whose own ref is longer could not be a lazy alternative (Kino: ≤ 512): it never merges (an event joins by
 * its Kino id instead). */
const MEMBER_REF_MAX = 512;
/** Two rows of one source are the same event only when they start within this (providers' clocks differ by seconds). */
const SAME_SOURCE_START_MS = 60 * 1000;
/** The same event in two sources: both start times known and this close. */
const CROSS_SOURCE_START_MS = 15 * 60 * 1000;
/** A live event is over this long after the latest end its rows store… */
const EVENT_OVER_AFTER_END_MS = 30 * 60 * 1000;
/** … else this long after its latest start (no row stores an end). */
const EVENT_OVER_AFTER_START_MS = 14 * 60 * 60 * 1000;

const fold = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Region codes a channel title may start or end with ("MX: ESPN", "┃CO┃ Caracol", "ESPN [MX]").
const CODES = {
  co: "co", col: "co", mx: "mx", mex: "mx", pe: "pe", cl: "cl", ec: "ec", ecu: "ec", ve: "ve", ven: "ve", bo: "bo", bol: "bo",
  py: "py", uy: "uy", uru: "uy", cr: "cr", pa: "pa", pan: "pa", ni: "ni", nic: "ni", hn: "hn", gt: "gt", gua: "gt", sv: "sv",
  do: "do", rd: "do", pr: "pr", cu: "cu", us: "us", usa: "us", eeuu: "us", es: "es", esp: "es", br: "br", bra: "br", pt: "pt",
  it: "it", ita: "it", fr: "fr", fra: "fr", de: "de", ger: "de", nl: "nl", uk: "gb", gb: "gb", ar: "ar", arg: "ar",
  ca: "ca", can: "ca", lat: "latam", latam: "latam", latino: "latam", latin: "latam", ucl: "eu", uefa: "eu", eu: "eu",
};
const NEUTRAL = new Set(["latam"]);
// Country names a bracketed tag or the end of a title may carry ("(México)", "ESPN Colombia"); the first is the one
// a bare code at the end is written as.
const NAMES = {
  co: "colombia", mx: "mexico", ar: "argentina", pe: "peru", cl: "chile", ec: "ecuador", ve: "venezuela", bo: "bolivia",
  py: "paraguay", uy: "uruguay", cr: "costa rica", pa: "panama", ni: "nicaragua", hn: "honduras", gt: "guatemala",
  sv: "el salvador", do: "republica dominicana", pr: "puerto rico", cu: "cuba", us: "usa|estados unidos|united states",
  es: "espana|spain", br: "brasil|brazil", pt: "portugal", it: "italia|italy", fr: "francia|france",
  de: "alemania|germany", gb: "reino unido|uk|united kingdom", ca: "canada",
};

// A bare country code at the end of a title ("ESPN CO", "DAZN 1 DE") reads as that country's name; `NAMES` gives each
// country's names, the first one being the one both are written as. "ar", "ca" and the neutral ones never count: "AR"
// is Arabic on supertv's panels and "CA" Central America on Latin American lists.
const BARE_CODES = {
  co: "co", col: "co", mx: "mx", mex: "mx", pe: "pe", cl: "cl", ec: "ec", ecu: "ec", ve: "ve", ven: "ve", bo: "bo", bol: "bo",
  py: "py", uy: "uy", uru: "uy", cr: "cr", pa: "pa", pan: "pa", ni: "ni", nic: "ni", hn: "hn", gt: "gt", gua: "gt", sv: "sv",
  do: "do", rd: "do", pr: "pr", cu: "cu", us: "us", usa: "us", eeuu: "us", es: "es", esp: "es", br: "br", bra: "br", pt: "pt",
  it: "it", ita: "it", fr: "fr", fra: "fr", de: "de", ger: "de", uk: "gb", gb: "gb", arg: "ar",
};
// Brand renames, on whole words at the start of a key: the same channel under its old and new name. "DAZN LIGA" is
// DAZN LaLiga (tresinl's "DAZN LIGA 5" carries the EPG id "DAZN LaLiga 5"; zee-ott lists "DAZN LALIGA"). "R.MADRID TV"
// is Real Madrid TV (zee-ott vs fv99 and tresinl, 2026-11-17).
const ALIASES = [[/^directv sports\b/, "dsports"], [/^win sports plus\b/, "win plus"], [/^l 1 max$/, "liga 1 max"], [/^dazn liga\b/, "dazn laliga"],
  [/^r madrid\b/, "real madrid"]];
// Anywhere in a key: "LaLiga TV" before a number or a name is LaLiga ("M+ LALIGA TV 2" = "M+ LALIGA 2", "LALIGA TV
// HYPERMOTION" = "LALIGA HYPERMOTION"; a trailing " TV" already goes, below).
const LALIGA_TV = /\bla ?liga tv (?=[a-z0-9])/g;
// Inside Spain's own category only: Movistar Plus+ written "Movistar …" or "M. …" is "M+ …" ("MOVISTAR LA LIGA 2" =
// "M+ LALIGA 2", tresinl's "M. LaLiga 2 OPC2"). Elsewhere "Movistar Deportes" is Peru's channel, not M+'s.
const MPLUS_ES = [[/^movistar(?: plus)*\b/, "m plus"], [/^m (?!plus\b)(?=[a-z])/, "m plus "]];

const LEAD = /^\s*[[(┃|]?\s*([a-z]{2,6})\s*[┃▎|:\]]\s*/;
const TRAIL = /\s*[[(|-]\s*([a-z]{2,6})\s*[\])]?\s*$/;
// Copy markers: "[Opc.2]", "(Backup)", "(V2)", a trailing "(2)", a bracket that says "repuesto" ("(FHD REPUESTO)",
// "(HD REPUESTO2)": fv99's backup copies), a bare "repuesto" and a bare "alternativa" with no number (tresinl's "DAZN LIGA
// ALTERNATIVA"; with a number it is a feed of its own, SEC_SLOT below).
const COPY = /[[(]\s*(?:opc(?:ion)?|option|op|alt|alterno|backup|respaldo|bk)\.?\s*\d*\s*[\])]|\bopc\.?\s*\d+\b|[[(]\s*v\d\s*[\])]|\(\s*\d\s*\)\s*$|[[(][^\])]*\brepuesto[^\])]*[\])]|\b(?:repuesto|alternativ[ao])\b(?!\s*\d)/g;
// What the shown title loses: option and backup markers ("[Opc.1]", "(Opc. 2)", "(Backup)", "(FHD REPUESTO)", a trailing
// "(2)").
const SHOWN_COPY = /\s*[[(]\s*(?:opc(?:i[oó]n)?|option|op|alt|alterno|backup|respaldo|bk)\.?\s*\d*\s*[\])]|\s*[[(][^\])]*\brepuesto[^\])]*[\])]|\s*\(\s*\d\s*\)\s*$/giu;
const NOISE = /[[(]\s*(?:not?\s*24\s*[/.]?\s*7?|24\s*[/.]\s*7|geo\s*-?\s*blocked|inestable|unstable|twitch|dailymotion|youtube|web|nacional|national|1080p?|720p?|480p?|auto|fhd|uhd|hd|sd|4k|hq|lq|low|en vivo|live)\s*[\])]/g;
const QUAL = /\b(?:fhd|uhd|hd|sd|4k|hq|1080p?|720p?|480p?|h\.?265|hevc)\b/g;
// A match, an event or a numbered slot ("EPL 01", "PPV 3", "EVENT 37:", "Arsenal vs Chelsea", "20:00"): never merged.
const SLOT = /\bvs?\.?\s|\s@\s|\b\d{1,2}[:.h]\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:ppv|event|evento|epl|ucl|uel|mls|nfl|nba|nhl|mlb|ufc|match|game|partido)\s*\d{1,3}\s*(?::|$)/;
const GENERIC_NUMBER = /^(?:canal|tv|tele|television|channel)? ?\d+$/;

// A secondary panel's own numbered feeds and event-only ones (measured on tresinl: "DAZN EVENTOS 1…28", "DAZN LIGA
// ALTERNATIVA 2", "LA LIGA REPLAY 3", "MOVISTAR LA LIGA 1 (Solo Eventos)", "… ( SOLO FUNCIONA CUANDO HAY EVENTOS )").
const SEC_SLOT = /\b(?:eventos?|events?|ppv|alternativ[ao]s?|backup|respaldo|extra|replay)\s*\d{1,3}\b|\bsolo (?:eventos|funciona)\b/;
/** At most this many copies of one secondary panel in one merged channel (its best ones). */
const SEC_PER_GROUP = 2;

/** Whether a channel title is a match, an event or a numbered slot (never merged). */
function isSlotTitle(title) {
  const t = fold(title).replace(/\b24\s*[/.]\s*7\b/g, "247").replace(/\s+/g, " ").trim();
  return SLOT.test(t + " ") || /\bvs\b/.test(t);
}

/** Whether a secondary panel's row is one of its own slots (never listed: what it carries differs per panel). */
function isSecondarySlot(title) {
  return isSlotTitle(title) || SEC_SLOT.test(fold(title));
}

const keyCache = new Map();
const KEY_CACHE_MAX = 20000;

/**
 * The merge key of a channel title inside a category whose single country is `cc` (ISO, lower case) or null:
 * case, accents, copy markers ("[Opc.2]", "(V2)"), quality tags and noise tags removed; a leading or trailing region
 * code (or flag) kept as an `@<cc>` token unless it is the category's own country or a neutral "LAT"; a bracketed
 * country name removed only inside that country's category; a bare country code or name at the end written as that
 * country's name (removed inside its own category); brand renames folded; spaces dropped except between two numbers.
 * "" when nothing usable is left.
 */
export function mergeKey(title, cc) {
  const ck = (cc || "") + "\u0001" + String(title);
  const hit = keyCache.get(ck);
  if (hit !== undefined) return hit;
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  const k = buildKey(String(title == null ? "" : title), cc || null);
  keyCache.set(ck, k);
  return k;
}

function buildKey(title, cc) {
  const tokens = [];
  const regionToken = (code) => {
    const c = CODES[code];
    if (!c) return false;
    if (c !== cc && !NEUTRAL.has(c)) tokens.push("@" + c);
    return true;
  };
  const flag = flagCountry(title);
  if (flag && flag !== cc) tokens.push("@" + (CODES[flag] || flag));
  let s = fold(title).replace(/[\u{1F1E6}-\u{1F1FF}]/gu, " ");
  const lead = LEAD.exec(s);
  if (lead && regionToken(lead[1])) s = s.slice(lead[0].length);
  s = s.replace(/[▎┃◉•·]/g, " ");
  for (let i = 0; i < 2; i++) s = s.replace(COPY, " ").replace(NOISE, " ");
  if (cc && NAMES[cc]) s = s.replace(new RegExp("[[(]\\s*(?:" + NAMES[cc] + "|" + cc + ")\\s*[\\])]", "g"), " ");
  s = s.replace(/\s+/g, " ").trim();
  const trail = TRAIL.exec(s);
  if (trail && s.length > trail[0].length && regionToken(trail[1])) s = s.slice(0, s.length - trail[0].length);
  s = s.replace(QUAL, " ").replace(/\+/g, " plus ").replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
  s = s.replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
  s = bareCountry(s, cc);
  const m = /^(.{3,}?) (?:tv|television|channel)$/.exec(s);
  if (m && /[a-z].*[a-z]/.test(m[1])) s = m[1];
  if (cc === "es") for (const [re, to] of MPLUS_ES) s = s.replace(re, to);
  s = s.replace(LALIGA_TV, "laliga ");
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  if (s.length < 2 || !/[a-z]/.test(s)) return "";
  // Spaces do not count ("BluRadio" = "Blu Radio"), except between two numbers.
  const flat = s.replace(/(\d) (?=\d)/g, "$1.").replace(/ /g, "");
  return tokens.length ? flat + " " + tokens.sort().join(" ") : flat;
}

/**
 * A bare country at the end of a spaced key: its code reads as its first name ("espn co" → "espn colombia"), any of its
 * names as that first name ("espn united states" → "espn usa"), and inside that country's own category (`cc`) it goes
 * ("espn colombia" in Colombia → "espn"), unless too little would be left.
 */
function bareCountry(s, cc) {
  const words = s.split(" ");
  if (words.length < 2) return s;
  let country = null, cut = 0;
  const last = words[words.length - 1];
  if (BARE_CODES[last]) { country = BARE_CODES[last]; cut = 1; }
  else {
    for (const [code, names] of Object.entries(NAMES)) {
      for (const name of names.split("|")) {
        const n = name.split(" ").length;
        if (words.length > n && words.slice(-n).join(" ") === name) { country = code; cut = n; break; }
      }
      if (country) break;
    }
  }
  if (!country || !NAMES[country]) return s;
  const head = words.slice(0, words.length - cut).join(" ");
  if (head.length < 2 || !/[a-z]/.test(head)) return s;
  if (country === cc) return head;
  return head + " " + NAMES[country].split("|")[0];
}

/** Quality of a copy from its title: 4 (UHD/4K), 3 (FHD/1080), 2 (HD/720), 1 (no tag, "Auto"), 0 (SD/480/low). */
function qualityOf(title) {
  const t = fold(title);
  if (/\buhd\b|\b4k\b|2160/.test(t)) return 4;
  if (/\bfhd\b|1080/.test(t)) return 3;
  if (/\bhd\b|720/.test(t)) return 2;
  if (/\bsd\b|480|\blow\b|\blq\b/.test(t)) return 0;
  return 1;
}

/**
 * The copy number of a title ("[Opc.3]" → 3, a trailing "(2)" → 2, "(FHD REPUESTO)" → 2, "(HD REPUESTO2)" → 3, a bare
 * "ALTERNATIVA" → 2), 1 when it names none.
 */
function copyOf(title) {
  const t = fold(title);
  const m = /\bopc(?:ion)?\.?\s*(\d{1,2})\b|\boption\s*(\d{1,2})\b|\(\s*(\d)\s*\)\s*$/.exec(t);
  if (m) return Number(m[1] || m[2] || m[3]);
  const r = /\brepuesto\s*(\d{0,2})/.exec(t);
  if (r) return 1 + (Number(r[1]) || 1);
  return /\balternativ[ao]\b(?!\s*\d)/.test(t) ? 2 : 1;
}

/**
 * A channel's title without option and backup markers ("Caracol HD [Opc.1]" → "Caracol HD", "ESPN HD - (Opc.3)" →
 * "ESPN HD"): the first step of its shown title in a category that merges (src/liveTitles.js takes the decorations
 * off). Its id and ref are untouched: Kino finds a saved channel by its id and name, else by its ref, so a favourite of
 * a channel listed alone still finds it by its unchanged ref.
 */
export function shownTitle(title) {
  const t = String(title == null ? "" : title);
  const out = t.replace(SHOWN_COPY, "").replace(/\s+/g, " ").replace(/(?:\s*[-–|·:])+\s*$/u, "").trim();
  return out || t;
}

function versionOf(title) {
  const m = /[[(]\s*v(\d)\s*[\])]/.exec(fold(title));
  return m ? Number(m[1]) : 1;
}

/** Play-order penalty of a copy: geo-blocked +2, unstable +1, "No 24/7" +1. */
function penaltyOf(title) {
  const t = fold(title);
  return (/geo\s*-?\s*blocked/.test(t) ? 2 : 0) + (/inestable|unstable/.test(t) ? 1 : 0) + (/\bnot?\s*24\s*[/.]?\s*7/.test(t) ? 1 : 0);
}

const QUALITY_LABEL = ["SD", "", "HD", "FHD", "4K"];

/** A member's label for the player's server menu: "TV en Vivo · HD", "Premium TV · SD · opción 3" (≤ 48 characters). */
export function memberLabel(srcName, title, en) {
  const parts = [String(srcName || "").trim() || "?"];
  const q = QUALITY_LABEL[qualityOf(title)];
  if (q) parts.push(q);
  const c = copyOf(title);
  if (c > 1) parts.push((en ? "option " : "opción ") + c);
  return parts.join(" · ").slice(0, 48);
}

/**
 * Composes one exposed category's page. `memberLists` = `[{ member: {src, rawCat, cc?}, rank, items, secondary? }]` in
 * member order (`rank` = the source's place in SOURCES; `secondary`: another panel of a primary source, see the
 * header). Channels with the same Kino id are shown once (the first). With
 * `opts.merge`, channels with the same key merge; `opts.cc` = the category's single ISO country (or null); without one,
 * a member's own raw-category country joins its key (a column "Fútbol Argentino" keeps its "TNT Sports" apart).
 * `opts.events`: live events, merged by the event rule instead, and an event that is over left out (see the header;
 * `opts.now`, epoch ms, defaults to the clock). `opts.titles` (a Map, optional): receives `ref → title` of every member
 * of a merged channel (a resolve's labels), as stored. `opts.en`: English country names in the shown titles.
 * → Kino-ready items `{ id, title, ref, logo?, adult? }`, each raw channel exactly once (alone, or inside one `M:` ref by
 * its `L:` ref or, for a long event ref, by its Kino id) — except a secondary panel's, which may be left out (header).
 * Titles: see the header.
 */
export function composeMerged(memberLists, opts) {
  const o = opts || {};
  const cc = o.cc || null;
  const titles = o.titles instanceof Map ? o.titles : null;
  const now = o.now > 0 ? o.now : Date.now();
  const flat = [];
  const ids = new Set();
  for (const ml of memberLists || []) {
    const mcc = ml.member && ml.member.cc ? ml.member.cc : "";
    const src = ml.member && ml.member.src ? ml.member.src : "";
    const sec = !!ml.secondary;
    for (const c of ml.items || []) {
      if (!c || !c.id || ids.has(c.id)) continue;
      if (sec && isSecondarySlot(c.title)) continue;
      ids.add(c.id);
      flat.push({ c, rank: ml.rank || 0, mcc, src, sec, pos: flat.length });
    }
  }
  if (!o.merge && !o.events) return shownTitles(flat.filter((f) => !f.sec).map((f) => f.c), { cc, en: o.en });
  const groups = new Map();
  for (const f of flat) {
    const key = o.events ? eventGroupKey(f) : groupKey(f, cc);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.every((f) => f.sec)) continue;   // only secondary panels list it: not listed (see the header)
    if (g.length === 1) {
      if (!(o.events && eventOver(g, now))) out.push({ pos: g[0].pos, item: g[0].c });
      continue;
    }
    for (const f of g) {
      f.t = f.c.title;
      f.prio = [f.rank, penaltyOf(f.t), -qualityOf(f.t), copyOf(f.t), versionOf(f.t), f.pos];
    }
    g.sort((a, b) => { for (let i = 0; i < a.prio.length; i++) if (a.prio[i] !== b.prio[i]) return a.prio[i] - b.prio[i]; return 0; });
    for (const all of o.events ? sameEvents(g, now) : [g]) {
      if (o.events && eventOver(all, now)) continue;
      if (all.every((f) => f.sec)) continue;
      const same = capSecondary(all);
      if (same.length > 1 && titles) for (const f of same) titles.set(f.c.ref, f.t);
      splitByLength(same).forEach((part, i) => {
        if (i > 0 && part.every((f) => f.sec)) return;   // a secondary panel's overflow: never a second row
        out.push({ pos: Math.min(...part.map((f) => f.pos)), item: channelOf(part) });
      });
    }
  }
  out.sort((a, b) => a.pos - b.pos);
  return shownTitles(out.map((x) => x.item), { cc, en: o.en, copies: shownTitle });
}

/** One channel's members (best first) with at most SEC_PER_GROUP copies of each secondary panel, its best ones. */
function capSecondary(g) {
  const per = new Map();
  return g.filter((f) => {
    if (!f.sec) return true;
    const n = (per.get(f.src) || 0) + 1;
    per.set(f.src, n);
    return n <= SEC_PER_GROUP;
  });
}

function groupKey(f, cc) {
  const c = f.c;
  const own = "#" + c.id;
  if (typeof c.ref !== "string" || !c.ref.startsWith("L:") || c.ref.length > MEMBER_REF_MAX) return own;
  if (isSlotTitle(c.title)) return own;
  const k = mergeKey(c.title, cc);
  if (!k) return own;
  if (GENERIC_NUMBER.test(k) && !cc) return own;
  return (c.adult ? "a|" : "n|") + k + (cc ? "" : "|" + f.mcc);
}

// ── live events ──

// A live tag before the title ("LIVE: …", "🔴 En vivo - …"), a numbered slot ("PPV MAIN EVENT 01: …", "EVENT 37: …").
const LIVE_TAG = /^\s*(?:live|en vivo|en directo|directo|ao vivo)\s*[:|-]\s*/;
const SLOT_PREFIX = /^(?:(?:ppv|main|event|evento|epl|ucl|uel|mls|nfl|nba|nhl|mlb|ufc|match|game|partido)\s*)+\d{1,3}\s*:\s*/;
// "A vs B", "A v. B", "A - B" (a plain hyphen between spaces), "A at B", "A @ B".
const MATCHUP = /^(.+?)\s+(?:vs?\.?|-|at|@)\s+(.+)$/;

/**
 * An event's title without its decorations → `{ key, match }`: `key` "" when nothing usable is left (supertv's empty
 * "EVENT 37:" slots), `match` whether it names two sides. The title is cut at " · ", " — " and " | " (deportv's channel
 * and kick-off, futbollibre's league, nuvio's venue and date) and the part kept is the first that names two sides
 * ("Fútbol | Chile vs Colombia"), else the first; a live tag and a slot number before it go.
 */
export function eventKey(title) {
  const t = fold(title).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ").replace(/\s+/g, " ").trim();
  const parts = t.split(/\s+[·—|]\s+/).map((p) => p.trim().replace(LIVE_TAG, "").replace(SLOT_PREFIX, "").trim());
  const sides = (p) => { const mm = MATCHUP.exec(p); return !!(mm && /[a-z0-9]/.test(mm[1]) && /[a-z0-9]/.test(mm[2])); };
  const s = parts.find(sides) || parts[0] || "";
  const key = s.replace(/\s(?:vs?)\.?(?=\s)/g, " vs").replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
  if (key.length < 2 || !/[a-z]/.test(key)) return { key: "", match: false };
  return { key, match: sides(s) };
}

function eventGroupKey(f) {
  const c = f.c;
  const own = "#" + c.id;
  if (typeof c.ref !== "string" || !c.ref.startsWith("L:")) return own;
  const e = eventKey(c.title);
  if (!e.key) return own;
  f.match = e.match;
  return (c.adult ? "a|" : "n|") + e.key;
}

/** Where a row comes from: its source, and the upstream provider inside it when the source names one. */
const originOf = (f) => f.src + "/" + (f.c.origin || "");

/** Whether two rows with the same event title are the same event (see the header; a row with no start: `sameEvents`). */
function sameEvent(a, b) {
  const sa = a.c.start || 0, sb = b.c.start || 0;
  if (originOf(a) === originOf(b)) return !!sa && !!sb && Math.abs(sa - sb) <= SAME_SOURCE_START_MS;
  if (sa && sb) return Math.abs(sa - sb) <= CROSS_SOURCE_START_MS;
  return !!a.match && !!b.match;
}

/** An event's start: the earliest its rows store, 0 when none does. */
function startOf(ev) {
  let at = 0;
  for (const f of ev) if (f.c.start > 0 && (!at || f.c.start < at)) at = f.c.start;
  return at;
}

/**
 * Whether one live event (its rows, in every source) is over: past the latest end any of them stores (+30 min), else
 * 14 h after its latest start; never when no row stores either.
 */
function eventOver(rows, now) {
  let end = 0, start = 0;
  for (const f of rows) {
    if (f.c.end > end) end = f.c.end;
    if (f.c.start > start) start = f.c.start;
  }
  if (end) return now > end + EVENT_OVER_AFTER_END_MS;
  if (start) return now > start + EVENT_OVER_AFTER_START_MS;
  return false;
}

/**
 * One group of rows with the same event title (best first) → its events, each best first. A row with a start joins the
 * first event all of whose rows it matches. A row with no start (a provider listing the live match without its time)
 * then joins, among the events it matches whose start is on (started or starting within 15 min, and not over), the
 * one that started closest to now — never a later session of the same title; else an event with no start either; else
 * it stands alone.
 */
function sameEvents(g, now) {
  const events = [];
  const loose = [];
  for (const f of g) {
    if (!f.c.start) { loose.push(f); continue; }
    const hit = events.find((ev) => ev.every((x) => sameEvent(x, f)));
    if (hit) hit.push(f); else events.push([f]);
  }
  for (const f of loose) {
    let best = null, bestGap = Infinity;
    for (const ev of events) {
      const at = startOf(ev);
      if (!at || at > now + CROSS_SOURCE_START_MS || eventOver(ev, now) || !ev.every((x) => sameEvent(x, f))) continue;
      if (Math.abs(now - at) < bestGap) { best = ev; bestGap = Math.abs(now - at); }
    }
    if (!best) best = events.find((ev) => !startOf(ev) && ev.every((x) => sameEvent(x, f))) || null;
    if (best) best.push(f); else events.push([f]);
  }
  const order = new Map(g.map((f, i) => [f, i]));
  for (const ev of events) ev.sort((a, b) => order.get(a) - order.get(b));
  return events;
}

/** How a member is written in an `M:` ref: its `L:` ref, or its Kino id when that ref is too long (an event). */
const memberPart = (c) => (c.ref.length > MEMBER_REF_MAX ? c.id : c.ref);

/** Greedy split: members join while the merged ref stays ≤ MERGED_REF_MAX; the rest form the next channel. */
function splitByLength(g) {
  const parts = [];
  let cur = [], len = 2;
  for (const f of g) {
    const p = memberPart(f.c);
    const size = (p.startsWith("L:") ? p.length - 2 : p.length) + (cur.length ? 1 : 0);
    if (cur.length && len + size > MERGED_REF_MAX) { parts.push(cur); cur = []; len = 2; }
    len += (p.startsWith("L:") ? p.length - 2 : p.length) + (cur.length ? 1 : 0);
    cur.push(f);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

function channelOf(part) {
  const p = part[0].c;
  const k = { id: p.id, title: p.title, ref: part.length === 1 ? p.ref : mergedRef(part.map((f) => memberPart(f.c))) };
  const withLogo = p.logo ? p : (part.find((f) => f.c.logo) || {}).c;
  if (withLogo && withLogo.logo) k.logo = withLogo.logo;
  if (p.adult) k.adult = true;
  return k;
}
