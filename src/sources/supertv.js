// src/sources/supertv.js — live connector "SuperTV": finds Xtream servers through VegetaTV's BOOTSTRAP (a direct
// clone of xuper-plugin/kino-plugin-supertv's logic) and plays with the generic factory makeXtream. It needs no
// sealed credentials: the bootstrap hands out accounts in the clear.
//
// Bootstrap:
//   GET http://vegetatvv2.duckdns.org/bootstrap.php with the X-Vegeta-Version-Code header.
//   A 426 (upgrade_required) names the code it wants: it is retried ONCE with it, and the code is REMEMBERED
//   (o2:stv), so the next bootstrap does not pay the 426 again.
//   The list comes in `servers_text` or, when that is empty, from `servers_url` (?servers=1), which needs the SAME
//   Vegeta headers. Each line is "http://host/get.php?username=..&password=..&type=.. 🏳" (or player_api.php).
//
// What is kept on the device (o2:stv, spec §3.2; nothing in module memory):
//   {"boot":{"servers":[{url,username,password,name?}],"ver","at"},"acct":{"server","user","pass","at"}}
//   boot: fresh 24 h, served stale up to 7 d when the bootstrap fails; acct: the working account (src/sources/xtream.js
//   uses it without a probe for 6 h, then probes it first). The categories live in the framework's registry (o2:lc).
// Categories: sports only, and of those only Spanish / Latin American ones plus football (`rankSupertv`), never 18+,
// at most 30 (spec §5.1). Event / PPV / replay categories refresh their lists every hour (`listTtl`).
//
// Secondary panels (1.0.46): the bootstrap's accounts are public and shared far over their 1–3 connections (the 407 /
// 509 the phone sees), and its ~50 hostnames sit on far fewer panels. So beside the primary account (`supertv`, exactly
// as above: the person's region preference) two more sources each hold one account on ANOTHER panel: `supertv2` and
// `supertv3`, ranked last in SOURCES. Their categories feed only the primary's single-country sports categories
// (src/liveMap.js `secondaryKept`), their channels merge with the primary's by name (src/liveMerge.js), so a channel
// the primary's account refuses falls through to the same channel on another panel (src/live.js resolve).
//   - Panels are told apart by the fingerprint of the probe's categories (src/sources/panels.js): two accounts of one
//     panel are never held as two copies.
//   - A slot takes an account that answers the primary's probe checks, sits on a panel other than the primary's and
//     the other slot's, and adds ≥ 2 categories to the primary's main category (its first single-country sports one).
//     The best such account among those already probed in the call (the primary's own batch: free; the framework fills
//     a primary and its secondary sources in one call), else one more batch of ≤ 5 probes (all in flight at once, each
//     with its whole timeout), only where the framework allows it (`ctx.searchProbes()`: the screen's lcFill tick with
//     only these sources missing, and — lean, `ctx.searchLean()`: candidate probes only, never a probe of the primary
//     nor the bootstrap — after Kino's first page of a category the primary feeds when that page already went to the
//     network, so someone who never opens the own screen gets them too; never Kino's liveCategories, a list or a
//     resolve). Nothing is fetched for a search that will not probe (every slot inside its search backoff), and the
//     bootstrap never while its stored list is under 7 days old (when it fails, the stored list serves whatever its age).
//   - Each slot commits only its own account, in its own `categories()`, which drops its lists and returns that
//     account's categories: a slot's stored categories and lists are always its account's (another slot's search never
//     changes its account behind them).
//   - A slot keeps its account until a hard refusal (src/sources/xtream.js `hardRefusal`), two unreachable checks 10 min
//     apart, or the primary landing on its panel; a list that answers renews it (no probe). A search that learned
//     something and found nothing waits 1 h, 3 h, then 6 h before it probes again.
//   o2:stvs (o2:stv stays exactly 1.0.45's, so the primary's account is never at risk):
//     {"prim":{"a","sk","tg","main","at"},"s2":{"server","user","pass","at","sk","soft"?}|{"none":1,"at","n"},"s3":…,
//      "bad":{"<akey>":at},"slow":{"<akey>":at}}
//   `a` / `<akey>` = src/sources/panels.js accountKey (server and user, no password), `sk` = a panel sketch, `tg` = the
//   categories the primary feeds, `bad` = accounts refused or not fitting (not probed again for a day, ≤ 40), `slow` =
//   accounts that could not be reached (not probed again for 6 h, ≤ 40), so the next search reaches other candidates.

import { liveFetch } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { once, inFlight, callSeq, callStartedAt, saneAt } from "../flight.js";
import { getJson, setJson } from "../store.js";
import { makeXtream, hostnameOf, probeShared, probeKey, hardRefusal } from "./xtream.js";
import { isSports, normCat } from "./sports.js";
import { targetOf, secondaryKept } from "../liveMap.js";
import { accountKey, fingerprint, sketchOf, readSketch, samePanel } from "./panels.js";

const BOOTSTRAP_URL = "http://vegetatvv2.duckdns.org/bootstrap.php";
const VERSION_CODE = "25"; // what the bootstrap asked for on 2026-11-16; a 426 teaches a newer one (kept in o2:stv)
const UA = "Mozilla/5.0 (compatible; VegetaTVCache/2.0)";
const MAX_SERVERS = 40;
const PROBE_MS = 3000;
const STV_KEY = "o2:stv";
const H = 60 * 60 * 1000, D = 24 * H;
const BOOT_FRESH_MS = D;
const BOOT_MAX_STALE_MS = 7 * D;
export const MAX_CATS = 30;

// Kino only allows HTTP to hosts declared in the manifest (insecureHttp). The bootstrap's servers are filtered to
// that allowlist (the same hosts as kino-plugin.json) so no host Kino would block is probed.
const HOST_ALLOWLIST = new Set([
  "966gaddn.com", "9paday.wtf", "alakazoo.xyz", "alexatv.world", "apex-ayoumas.com", "ashmedia.site",
  "avefenixtv.com", "brumotto00.zapto.org", "capitanhero.com", "doubleclicktv.live", "dreamteev.xyz",
  "dsaiiiilllliillsad.cdnip.online", "eu.kartal38.com", "fast-smart33.xyz", "frido1.live", "fv99.nesewvp.top",
  "goodbom.net", "hydragold.xyz", "interstellar.salex74.xyz", "krplay.eu", "line.krishkaz.com", "line.tmpes.com",
  "line.zee-ott.xyz", "line.zen8kk.xyz", "line.znn8.xyz", "louismag.com", "ltv.ddns.net",
  "lunicaoriginaleapp.giize.com", "myultratv.com", "neezfaopro.top", "nexotvplus.com", "pp.tresinl.xyz",
  "reborned.cc", "sa.xurvani.cfd", "toni-tv.com", "topcliente.xyz", "vca.easy747.com", "vewora.com",
  "vip2.sharkhost.xyz", "wickediptv.live", "xvisnet.xyz",
]);

function log(m) { try { kino.log("supertv: " + m); } catch (_) { /* no log */ } }

function vegetaHeaders(code) {
  return {
    "X-Vegeta-Version-Code": String(code),
    "X-Vegeta-Servers-Direct": "1",
    "Cache-Control": "no-cache, no-store",
    "Pragma": "no-cache",
    "User-Agent": UA,
  };
}

function parseServerLine(line) {
  const url = line.split(/\s/)[0].trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (!path.endsWith("player_api.php") && !path.endsWith("get.php")) return null;
    const username = u.searchParams.get("username") || u.searchParams.get("user") || "";
    const password = u.searchParams.get("password") || u.searchParams.get("pass") || "";
    if (!username) return null;
    const base = (u.protocol + "//" + u.host).replace(/\/+$/, "");
    const name = line.slice(url.length).trim().replace(/^\[|\]$/g, "").trim().slice(0, 40);
    return { url: base, username, password, ...(name ? { name } : {}) };
  } catch (_) {
    return null;
  }
}

export function parseServers(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const s = parseServerLine(t);
    if (!s) continue;
    if (!HOST_ALLOWLIST.has(hostnameOf(s.url))) continue;   // only hosts Kino allows over HTTP (manifest)
    const key = s.url + "|" + s.username;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  // HTTPS first (the only safe choice for third-party servers); then the service's order.
  return out.sort((a, b) => (b.url.startsWith("https://") ? 1 : 0) - (a.url.startsWith("https://") ? 1 : 0));
}

// ── o2:stv (sections written only when they change; never over a newer write from another runtime) ──

let wrote = { seq: -1, names: new Set() };   // the sections THIS call wrote (per-call bookkeeping, not a cache)

function readStv() {
  const v = getJson(STV_KEY);
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function writeStv(name, value) {
  if (wrote.seq !== callSeq()) wrote = { seq: callSeq(), names: new Set() };
  const all = readStv();
  const theirs = all[name];
  // Stale-write guard: another runtime stored this section after this call began (a timed-out runtime keeps running).
  // A stamp in the future (a clock set back) is not "newer": it is overwritten with a sane one.
  if (theirs && !wrote.names.has(name) && saneAt(theirs.at) > callStartedAt()) {
    log(name + " not saved (a newer one exists)");
    return;
  }
  if (theirs && JSON.stringify(theirs) === JSON.stringify(value)) return;
  all[name] = value;
  setJson(STV_KEY, all, { ttlMs: BOOT_MAX_STALE_MS });
  wrote.names.add(name);
}

const account = {
  load() {
    const a = readStv().acct;
    if (!a || typeof a.server !== "string" || !a.user || !HOST_ALLOWLIST.has(hostnameOf(a.server))) return null;
    return { url: a.server, username: String(a.user), password: String(a.pass || ""), at: saneAt(a.at) };
  },
  save(acc) {
    writeStv("acct", { server: acc.url, user: acc.username, pass: acc.password, at: Date.now() });
  },
};

// ── bootstrap ──

async function fetchBoot() {
  const stored = readStv().boot;
  let code = String((stored && /^\d{1,4}$/.test(String(stored.ver)) && stored.ver) || VERSION_CODE);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await liveFetch(BOOTSTRAP_URL + "?v=" + Date.now(), { method: "GET", headers: { ...vegetaHeaders(code), "Accept": "application/json" }, cookies: false, timeoutMs: 8000 });
    let data = null;
    try { data = r.json(); } catch (_) { data = null; }
    const want = data ? Math.max(Number(data.minimum_version_code) || 0, Number(data.latest_version_code) || 0) : 0;
    if (!r.ok || !data || data.ok === false) {
      if (attempt === 0 && want > Number(code)) { code = String(want); continue; }
      throw new Error("bootstrap " + (r && r.status));
    }
    let list = [];
    if (typeof data.servers_text === "string" && data.servers_text.trim()) list = parseServers(data.servers_text);
    if (!list.length && typeof data.servers_url === "string" && data.servers_url.trim()) {
      const r2 = await liveFetch(data.servers_url, { method: "GET", headers: { ...vegetaHeaders(code), "Accept": "text/plain" }, cookies: false, timeoutMs: 8000 });
      if (r2 && r2.ok) list = parseServers(r2.text());
    }
    if (!list.length) {
      if (attempt === 0 && want > Number(code)) { code = String(want); continue; }
      throw new Error("bootstrap: sin servidores");
    }
    const servers = list.slice(0, MAX_SERVERS);
    writeStv("boot", { servers, ver: code, at: Date.now() });
    return servers;
  }
  throw new Error("bootstrap: sin servidores");
}

/** The candidate accounts: the stored bootstrap while fresh (0 requests), else fetched (stale up to 7 d on failure). */
async function bootstrap() {
  const boot = readStv().boot;
  const servers = boot && Array.isArray(boot.servers) ? boot.servers.filter((s) => s && s.url && s.username && HOST_ALLOWLIST.has(hostnameOf(s.url))) : [];
  const age = boot ? Date.now() - saneAt(boot.at) : Infinity;
  if (servers.length && age < BOOT_FRESH_MS) return servers;
  try {
    return await once("stv:boot", fetchBoot);
  } catch (e) {
    if (servers.length && age < BOOT_MAX_STALE_MS) {
      log("bootstrap failed, using the stored servers: " + ((e && (e.code || e.message)) || e));
      return servers;
    }
    throw e;
  }
}

// ── categories: sports, Spanish / Latin American or football, never 18+ ──

// A Spanish-speaking region tag at the start ("ES ▎…", "LAT | …", "[MX] …") or a Spanish / Latin American name.
// "AR ▎" is ARABIC on these panels (Argentina is spelled out), so it is not a tag here.
const REGION_TAG_RE = /^[\s[(]*(?:es|esp|lat|latam|latin|latino|latinos|lame|mx|mex|co|col|pe|cl|ec|ve|uy|py|bo|cr|pa|do|gt|hn|sv|ni|pr|cu|arg)\s*[▎|:\])-]/;
const REGION_NAME_RE = /\b(?:espana|spain|latin[oa]s?|latam|latinoamerica|hispan\w*|mexico|colombia|argentina|peru|chile|ecuador|venezuela|uruguay|paraguay|bolivia|costa rica|panama|dominican[ao]?|guatemala|honduras|el salvador|nicaragua|puerto rico|cuba|centroamerica|deportes?)\b/;
const FOOTBALL_RE = /\b(?:futbol|football|soccer|laliga|la liga|liga mx|ligamx|liga ?1|liga pro|premier league|champions|uefa|libertadores|sudamericana|conmebol|copa|bundesliga|serie a|ligue ?1|eredivisie|mls|tudn\w*|campeones|hypermotion|rfef|eliminatorias|mundial)\b/;
const SPORTY_RE = /\b(?:events?|eventos?|ppv|baloncesto|acb|ufc|boxeo|box)\b/;
// Lists of these categories change within the day (spec §5.1): fresh 1 h, stale up to 6 h.
export const EVENT_RE = /event|ppv|replay|\d{1,2} \w+ 20\d\d/i;

/** A supertv category title → 0 (Spanish / Latin American sports), 1 (football elsewhere) or -1 (left out). */
export function rankSupertv(title) {
  const n = normCat(title);
  const football = FOOTBALL_RE.test(n);
  if (!(football || isSports(n) || SPORTY_RE.test(n))) return -1;
  if (REGION_TAG_RE.test(n) || REGION_NAME_RE.test(n)) return 0;
  return football ? 1 : -1;
}

// `cat` = the stored category (src/live.js hands it over with the raw id), or null when none is stored yet.
function listTtl(rawCat, cat) {
  return cat && EVENT_RE.test(String(cat.title || "")) ? { fresh: H, maxStale: 6 * H } : null;
}

const supertv = makeXtream({
  id: "supertv",
  name: "SuperTV Deportes",
  genre: "deportes",
  ua: UA,
  ext: "m3u8",
  maxProbe: 30,
  probeBatch: 6,
  probeTimeoutMs: PROBE_MS,
  accountFreshMs: 6 * H,
  skipAdult: true,          // gap 5: never an 18+ group
  rankCat: rankSupertv,
  maxCats: MAX_CATS,
  flight: "stv",
  account,
  listTtl,
  onPicked: notePrimary,
  getAccounts: bootstrap,
});

export default supertv;

// ── secondary panels (see the header) ──

const STVS_KEY = "o2:stvs";
const SLOTS = ["s2", "s3"];
const M = 60 * 1000;
const SEARCH_MAX = 5;                          // new probes per search, at most: one batch, all in flight at once (src/liveGate.js)
const SEARCH_BACKOFF_MS = [H, 3 * H, 6 * H];   // after a search that found nothing, by how many in a row
const SEARCH_MIN_LEFT_MS = PROBE_MS;           // a new batch starts only with a whole probe timeout left (none cut short)
const MARKS = { bad: D, slow: 6 * H };         // refused or not fitting: a day; could not be reached: 6 h (not probed again)
const MARKS_MAX = 40;
const SOFT_GAP_MS = 10 * M;                    // two unreachable checks this far apart release a slot
const RENEW_MS = H;                            // a list that answers renews its slot's account at most this often
const MIN_MAIN = 2;                            // categories a slot must add to the primary's main category
const OWN_LIMIT = new Set(["deadline", "budget", "invalid_request"]);
const ownLimit = (e) => !!e && (OWN_LIMIT.has(e.code) || e.limited === true);
const why = (e) => String((e && (e.message || e.code)) || e).slice(0, 60);
const accKey = (a) => (a ? a.url + "|" + a.username : "");
const deferred = (m) => new Error("secondary panels: " + m);

let wroteS = { seq: -1, names: new Set() };   // the o2:stvs sections THIS call wrote (per-call bookkeeping)
let memo = { seq: -1 };                        // this call's primary pick, slot verdicts and searching slots (per call)
function callMemo() {
  if (memo.seq !== callSeq()) memo = { seq: callSeq(), prim: null, active: null, asking: new Set() };
  return memo;
}

function readStvs() {
  const v = getJson(STVS_KEY);
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/**
 * Writes o2:stvs sections (`changes`: name → value) and marks account keys (`marks`: `{ bad?, slow? }` → keys), in one
 * write. A section another runtime stored after this call began is left alone (the stale-write guard of `writeStv`);
 * marks are merged. → the names of `changes` that are stored now.
 */
function saveStvs(changes, marks) {
  if (wroteS.seq !== callSeq()) wroteS = { seq: callSeq(), names: new Set() };
  const all = readStvs();
  const now = Date.now();
  const saved = new Set();
  let dirty = false;
  for (const name of Object.keys(changes || {})) {
    const theirs = all[name];
    if (theirs && !wroteS.names.has(name) && saneAt(theirs.at) > callStartedAt()) { log(name + " not saved (a newer one exists)"); continue; }
    saved.add(name);
    if (theirs && JSON.stringify(theirs) === JSON.stringify(changes[name])) continue;
    all[name] = changes[name];
    wroteS.names.add(name);
    dirty = true;
  }
  for (const [field, ttl] of Object.entries(MARKS)) {
    const keys = marks && Array.isArray(marks[field]) ? [...new Set(marks[field])] : [];
    if (!keys.length) continue;
    const kept = Object.entries(all[field] && typeof all[field] === "object" ? all[field] : {})
      .filter(([k, at]) => now - saneAt(at) < ttl && !keys.includes(k));
    for (const k of keys) kept.push([k, now]);
    all[field] = Object.fromEntries(kept.sort((a, b) => b[1] - a[1]).slice(0, MARKS_MAX));
    dirty = true;
  }
  if (dirty) {
    setJson(STVS_KEY, all, { ttlMs: BOOT_MAX_STALE_MS });
    callMemo().active = null;
  }
  return saved;
}

/** Whether a candidate is marked (refused or not fitting for a day, unreachable for 6 h): not probed again yet. */
const marked = (all, acc, now) => Object.entries(MARKS).some(([field, ttl]) => {
  const at = all[field] && typeof all[field] === "object" ? saneAt(all[field][accountKey(acc)]) : 0;
  return !!at && now - at < ttl;
});

/** A slot's account `{ url, username, password, at, sk, soft }`, or null (none held). */
function slotOf(all, name) {
  const s = all[name];
  if (!s || s.none || typeof s.server !== "string" || !s.user || !HOST_ALLOWLIST.has(hostnameOf(s.server))) return null;
  return { url: s.server, username: String(s.user), password: String(s.pass || ""), at: saneAt(s.at), sk: s.sk || null, soft: s.soft || null };
}

/**
 * Which slots hold an account that is in use (0 requests, once per call): not the primary's account, not on the
 * primary's panel by their stored sketches, and not on the panel of a lower slot (two runtimes that picked one panel).
 */
function activeSlots() {
  const m = callMemo();
  if (m.active) return m.active;
  const all = readStvs();
  const prim = account.load();
  const pfp = prim && all.prim && all.prim.a === accountKey(prim) ? readSketch(all.prim.sk) : null;
  const out = {};
  const held = [];
  for (const name of SLOTS) {
    const s = slotOf(all, name);
    const fp = s ? readSketch(s.sk) : null;
    let ok = !!s && accKey(s) !== accKey(prim) && !held.some((h) => accKey(h.s) === accKey(s));
    if (ok && fp && pfp && samePanel(pfp, fp, false)) ok = false;
    if (ok && fp && held.some((h) => h.fp && samePanel(h.fp, fp, false))) ok = false;
    out[name] = ok;
    if (ok) held.push({ s, fp });
  }
  m.active = out;
  return out;
}

/**
 * The primary's `onPicked`: its panel's sketch, the categories it feeds and its main one, kept in o2:stvs (written when
 * they change, or a day old); a slot on the panel it was just picked onto is released at once.
 */
function notePrimary(acc, raw, shaped) {
  const fp = fingerprint(raw);
  const tg = [...new Set(shaped.map((c) => targetOf("supertv", c)).filter(Boolean))];
  const served = new Set(tg);
  const main = (secondaryKept("supertv", shaped, served)[0] || {}).v || "";
  callMemo().prim = { acc, fp, served, main };
  const now = Date.now();
  const all = readStvs();
  const prim = { a: accountKey(acc), sk: sketchOf(fp), tg, main, at: now };
  const old = all.prim;
  const changes = {};
  if (!old || old.a !== prim.a || old.main !== main || JSON.stringify(old.tg) !== JSON.stringify(tg) ||
    JSON.stringify(old.sk) !== JSON.stringify(prim.sk) || now - saneAt(old.at) >= D) changes.prim = prim;
  for (const name of SLOTS) {
    const s = slotOf(all, name);
    const sfp = s && readSketch(s.sk);
    if (s && (accKey(s) === accKey(acc) || (sfp && samePanel(sfp, fp, false)))) {
      log(name + ": " + hostnameOf(s.url) + " released (the primary is on its panel now)");
      changes[name] = { none: 1, at: now, n: 0 };
    }
  }
  if (Object.keys(changes).length) saveStvs(changes);
}

/**
 * The primary to search against: this call's pick (shared flight), else the remembered account with its stored panel,
 * else (1.0.45's storage) one probe of the remembered account — which is never changed here.
 */
async function primaryRef(allow) {
  if (inFlight("stv:acct")) {
    try { await once("stv:acct", () => Promise.reject(deferred("no pick"))); } catch (_) { /* the primary's own flow */ }
  }
  const m = callMemo();
  if (m.prim) return m.prim;
  const acc = account.load();
  if (!acc) throw deferred("no primary account yet");
  const all = readStvs();
  const fp = all.prim && all.prim.a === accountKey(acc) ? readSketch(all.prim.sk) : null;
  if (fp && Array.isArray(all.prim.tg)) return { acc, fp, served: new Set(all.prim.tg), main: String(all.prim.main || "") };
  if (allow <= 0) throw deferred("the primary's panel is not known yet");
  let raw;
  try { raw = await probeShared(acc, UA, PROBE_MS); } catch (e) { throw deferred("the primary's panel is unknown (" + why(e) + ")"); }
  const shaped = supertv.shapeCats(raw);
  if (!shaped.length) throw deferred("the primary's panel is unknown (no useful category)");
  notePrimary(acc, raw, shaped);
  return callMemo().prim;
}

/**
 * The candidate accounts: the stored bootstrap list while under 7 d old; past that, fetched only for a search that will
 * probe (`net` > 0), the stored list serving whatever its age when the bootstrap fails (and with no network allowed).
 */
async function slotCandidates(net) {
  const boot = readStv().boot;
  const servers = boot && Array.isArray(boot.servers) ? boot.servers.filter((s) => s && s.url && s.username && HOST_ALLOWLIST.has(hostnameOf(s.url))) : [];
  if (servers.length && (net <= 0 || Date.now() - saneAt(boot.at) < BOOT_MAX_STALE_MS)) return servers;
  if (net <= 0) throw deferred("no stored server list");
  try {
    return await bootstrap();
  } catch (e) {
    if (!servers.length) throw e;
    log("bootstrap failed (" + why(e) + "); the slots search the stored list");
    return servers;
  }
}

/** A search that may only probe candidates (`ctx.searchLean()`): no probe of the primary, no bootstrap. */
const leanSearch = (ctx) => typeof ctx.searchLean === "function" && !!ctx.searchLean();
const inSearchBackoff = (s, now) => {
  const n = s && s.none ? Math.max(0, Number(s.n) || 0) : 0;
  return n > 0 && now - saneAt(s.at) < SEARCH_BACKOFF_MS[Math.min(n, SEARCH_BACKOFF_MS.length) - 1];
};
/** A slot's record after a search that probed and found nothing: its search backoff goes one step up. */
const noneAfter = (s, now) => ({ none: 1, at: now, n: (s && s.none ? Math.max(0, Number(s.n) || 0) : 0) + 1 });
const slotShape = (raw) => supertv2.shapeCats(raw);

/**
 * How one probed account would serve as a slot against the primary `prim`: `{ score, fp, cats }` (higher is better:
 * categories added to the primary's main category first), or `{ why, primary? }` (`primary`: it is the primary's account
 * or panel, which says nothing against the account itself).
 */
function evaluate(r, prim) {
  if (accKey(r.acc) === accKey(prim.acc)) return { why: "the primary's account", primary: true };
  const fp = fingerprint(r.raw);
  if (samePanel(prim.fp, fp)) return { why: "the primary's panel", primary: true };
  const cats = slotShape(r.raw);
  const kept = secondaryKept("supertv", cats, prim.served);
  const inMain = kept.filter((k) => k.v === prim.main).length;
  if (!prim.main || inMain < MIN_MAIN) return { why: "too little for the primary's categories" };
  return { score: inMain * 100 + kept.length, fp, cats };
}

/**
 * The shared search of one call (`once("stv:slots")`): the best account on another panel for every slot not in use,
 * from what this call already probed, then (where allowed) one more batch. It stores only its marks (`bad`, `slow`): each
 * slot commits its own result in its own `categories()` (`searchFor`). → `{ chosen: { s2?, s3? } (= { acc, fp, cats }),
 * none: { s2?, s3? } (the record of a slot whose search probed, learned something and found nothing), probed }`.
 */
async function searchSlots(ctx) {
  const allow = Math.max(0, Math.min(SEARCH_MAX, Number(typeof ctx.searchProbes === "function" ? ctx.searchProbes() : 0) || 0));
  const out = { chosen: {}, none: {}, probed: 0 };
  const free = SLOTS.filter((n) => !activeSlots()[n]);
  if (!free.length) return out;
  // The network (one reference probe of the primary, the bootstrap) only for a search that will probe, and never for a
  // lean one (Kino's own path: candidate probes only).
  const before = readStvs();
  const net = !leanSearch(ctx) && free.some((n) => !inSearchBackoff(before[n], Date.now())) ? allow : 0;
  const prim = await primaryRef(net);
  let servers;
  try {
    servers = await slotCandidates(net);
  } catch (e) {
    if (net <= 0) throw e;
    // no server list at all: the search backoff applies, as after a search that found nothing
    const now = Date.now();
    for (const n of free) if (!inSearchBackoff(before[n], now)) out.none[n] = noneAfter(before[n], now);
    log("slots: no server list to search (" + why(e) + ")");
    return out;
  }
  // Read again after the awaits: the primary's pick may have released a slot meanwhile (notePrimary).
  const now = Date.now();
  const all = readStvs();
  const act = activeSlots();
  const asking = callMemo().asking;
  // the slots that asked in this call choose first (another slot's choice is not committed by it)
  const want = SLOTS.filter((n) => !act[n]).sort((a, b) => (asking.has(b) ? 1 : 0) - (asking.has(a) ? 1 : 0));
  if (!want.length) return out;
  const held = SLOTS.filter((n) => act[n]).map((n) => slotOf(all, n)).filter(Boolean).map((s) => ({ key: accKey(s), fp: readSketch(s.sk) }));
  const skip = (acc) => accKey(acc) === accKey(prim.acc) || held.some((h) => h.key === accKey(acc));
  const evals = [];
  const marks = { bad: [], slow: [] };
  const add = (r) => {
    const ev = evaluate(r, prim);
    if (ev.score) evals.push({ ...r, ...ev });
    else marks.bad.push(accountKey(r.acc));
  };
  const noAnswer = (acc, e) => {
    if (hardRefusal(e)) marks.bad.push(accountKey(acc));
    else if (!ownLimit(e)) marks.slow.push(accountKey(acc));
  };
  // what this call already probed (the primary's batch): free
  for (let i = 0; i < servers.length; i++) {
    const acc = servers[i];
    if (skip(acc) || !inFlight(probeKey(acc))) continue;
    try { add({ acc, i, raw: await probeShared(acc, UA, PROBE_MS) }); } catch (e) { noAnswer(acc, e); }
  }
  const chosen = out.chosen;
  const choose = () => {
    for (const name of want) {
      if (chosen[name]) continue;
      const others = held.concat(Object.values(chosen).map((c) => ({ key: accKey(c.acc), fp: c.fp })));
      const fits = evals.filter((e) => !others.some((o) => o.key === accKey(e.acc) || (o.fp && samePanel(o.fp, e.fp))));
      fits.sort((a, b) => b.score - a.score || a.i - b.i);
      if (fits[0]) chosen[name] = { acc: fits[0].acc, fp: fits[0].fp, cats: fits[0].cats };
    }
  };
  choose();
  let learned = false;
  const searching = want.filter((n) => !chosen[n] && !inSearchBackoff(all[n], now));
  if (searching.length && allow > 0 && (typeof ctx.remaining !== "function" || ctx.remaining() >= SEARCH_MIN_LEFT_MS)) {
    const next = servers.map((acc, i) => ({ acc, i })).filter(({ acc }) => !skip(acc) && !inFlight(probeKey(acc)) && !marked(all, acc, now)).slice(0, allow);
    out.probed = next.length;
    const got = await Promise.all(next.map(({ acc, i }) => probeShared(acc, UA, PROBE_MS).then((raw) => ({ acc, i, raw }), (e) => ({ acc, i, e }))));
    for (const g of got) {
      if (g.raw) add(g); else noAnswer(g.acc, g.e);
      // a probe this call's own limits cut short says nothing about the panel
      if (g.raw || !ownLimit(g.e)) learned = true;
    }
    choose();
  }
  if (learned) for (const n of searching) if (!chosen[n]) out.none[n] = noneAfter(all[n], now);
  saveStvs(null, marks);
  return out;
}

/**
 * This call's search result for one slot, committed by the slot itself: its account (or its search backoff) stored.
 * → `{ acc, fp, cats }`, or throws (nothing fits, or the search is not allowed here).
 */
async function searchFor(name, ctx) {
  callMemo().asking.add(name);
  const r = await once("stv:slots", () => searchSlots(ctx));
  const c = r.chosen[name];
  if (c) {
    const rec = { server: c.acc.url, user: c.acc.username, pass: c.acc.password, at: Date.now(), sk: sketchOf(c.fp) };
    if (!saveStvs({ [name]: rec }).has(name)) throw deferred(name + ": another runtime stored a newer account");
    log(name + ": " + hostnameOf(c.acc.url) + " (another panel; " + c.cats.length + " categories)");
    return c;
  }
  const none = r.none[name];
  if (none && saveStvs({ [name]: none }).has(name)) {
    log(name + ": no other panel fits (" + r.probed + " probed); next search in " + Math.round(SEARCH_BACKOFF_MS[Math.min(none.n, SEARCH_BACKOFF_MS.length) - 1] / H) + " h");
  }
  throw deferred(name + ": no account on another panel");
}

function release(name, acc, reason, bad) {
  log(name + ": " + hostnameOf(acc.url) + " released (" + reason + ")");
  saveStvs({ [name]: { none: 1, at: Date.now(), n: 0 } }, bad ? { bad: [accountKey(acc)] } : null);
}

/** A slot's account answered: its `at` (and sketch) renewed, at most hourly; an unreachable mark is cleared. */
function renewSlot(name, acc, fp) {
  const all = readStvs();
  const s = all[name];
  if (!s || s.none || s.server !== acc.url || s.user !== acc.username) return;
  const sk = fp ? sketchOf(fp) : s.sk;
  if (Date.now() - saneAt(s.at) < RENEW_MS && !s.soft && JSON.stringify(sk) === JSON.stringify(s.sk)) return;
  saveStvs({ [name]: { server: s.server, user: s.user, pass: s.pass, at: Date.now(), sk } });
}

/** A slot's account could not be reached (not a refusal): released at the second time, 10 min or more apart. */
function noteUnreachable(name, acc) {
  const all = readStvs();
  const s = all[name];
  if (!s || s.none || s.server !== acc.url || s.user !== acc.username) return;
  const first = s.soft ? saneAt(s.soft.at) : 0;
  if (first && Date.now() - first >= SOFT_GAP_MS) { release(name, acc, "unreachable twice, " + Math.round((Date.now() - first) / M) + " min apart", false); return; }
  if (!first) saveStvs({ [name]: { ...s, soft: { at: Date.now() } } });
}

/**
 * A slot's categories (a fill, or riding along a list): its account re-checked (1 probe: still on another panel, still
 * adding to the primary's main category), else released, and the search's account taken (its lists dropped).
 */
async function slotCategories(name, ctx, kit) {
  const allow = leanSearch(ctx) ? 0 : Math.max(0, Number(typeof ctx.searchProbes === "function" ? ctx.searchProbes() : 0) || 0);
  const cur = activeSlots()[name] ? slotOf(readStvs(), name) : null;
  if (cur) {
    let raw = null, reason = "", bad = true;
    try { raw = await probeShared(cur, UA, PROBE_MS); } catch (e) {
      if (!hardRefusal(e)) { if (!ownLimit(e)) noteUnreachable(name, cur); throw e; }
      reason = "refused: " + why(e);
    }
    if (raw) {
      let prim = null;
      try { prim = await primaryRef(allow); } catch (_) { prim = null; }   // unknown: it keeps its place
      const ev = prim ? evaluate({ acc: cur, raw }, prim) : { score: 1, fp: fingerprint(raw), cats: kit.shapeCats(raw) };
      if (ev.score && ev.cats.length) { renewSlot(name, cur, ev.fp); return ev.cats; }
      reason = ev.why || "no useful category";
      bad = !ev.primary;   // the primary on its account or panel says nothing against the account
    }
    release(name, cur, reason, bad);
    if (typeof ctx.dropLists === "function") ctx.dropLists();
  }
  const got = await searchFor(name, ctx);
  if (typeof ctx.dropLists === "function") ctx.dropLists();   // another account: its old lists are another server's
  return got.cats;
}

/**
 * One list of a slot (1 request, never a probe first): a list that answers renews the account. A list that fails is
 * checked with one probe of the account: a refusal releases the slot (no search here), an account that answers fails
 * that list only. This call's own limits never count.
 */
async function slotChannels(name, cat, ctx, kit) {
  const acc = activeSlots()[name] ? slotOf(readStvs(), name) : null;
  if (!acc) throw deferred(name + ": no account");
  try {
    const list = await kit.listStreams(acc, cat);
    renewSlot(name, acc, null);
    return list;
  } catch (e) {
    if (ownLimit(e)) throw e;
    try { await probeShared(acc, UA, PROBE_MS); } catch (pe) {
      if (hardRefusal(pe)) {
        release(name, acc, "refused: " + why(pe), true);
        if (typeof ctx.dropLists === "function") ctx.dropLists();
      } else if (!ownLimit(pe)) noteUnreachable(name, acc);
    }
    throw e;
  }
}

function slot(name, id, title) {
  return makeXtream({
    id,
    name: title,
    genre: "deportes",
    ua: UA,
    ext: "m3u8",
    probeTimeoutMs: PROBE_MS,
    skipAdult: true,
    rankCat: rankSupertv,
    keepCat: (t) => !EVENT_RE.test(t),   // no event, PPV or replay category: their slots differ per panel
    maxCats: MAX_CATS,
    secondary: {
      of: "supertv",
      active: () => !!activeSlots()[name],
      categories: (ctx, kit) => slotCategories(name, ctx, kit),
      channels: (cat, ctx, kit) => slotChannels(name, cat, ctx, kit),
    },
  });
}

export const supertv2 = slot("s2", "supertv2", "SuperTV Deportes 2");
export const supertv3 = slot("s3", "supertv3", "SuperTV Deportes 3");
