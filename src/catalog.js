// catalog.js — the data of each export: Kino Home/Ver más/Categorías from the stored v2 catalog (src/data.js), details
// and playback through the backend. Live TV (categories, channels, the live branch of resolve) is src/live.js.
// The pure card → item mapping lives in src/items.js (shared with the publisher).
// What Xuper 2.x left in the library (masnew titles, chapters and channels: src/legacy.js) plays and lists on masnew,
// through src/sources/xuper.js, behind the same activation.

import {
  authed, relayResolve, prepareRelay, currentBearer, isRateLimited, egressSearch, egressColumn, egressItem, BACKEND_HOP_TIMEOUT_MS,
  notActivated,
} from "./api.js";
import { episodeRef, itemRef, decodeRef, withQuality, liveRef } from "./refs.js";
import { searchVod, resolveVod, chapterList, portalCodeOf } from "./sources/xuper.js";   // masnew: the title fallback, 2.x's titles
import { chaptersOf, findChapter, episodesAnswer, migrate as migrateValue, parseSeasonList } from "./legacy.js";
import { makeTmdb } from "./tmdb.js";
import { rawDetail, enrich, isGenericTitle } from "./episodeEnrich.js";
import { collapseSeasons, displaySeriesTitle } from "./titleClean.js";
import { pickPoster, toItems } from "./items.js";
import { catalog as storedCatalog, revalidate } from "./data.js";
import { homeRows, browsePage, itemById, categoryTiles } from "./v2.js";
import { resolveLive, hashId } from "./live.js";
import { callStartedAt } from "./flight.js";
import { lang } from "./config.js";

/**
 * What a VOD resolve (the relay, then the masnew fallback) may spend, from the plugin call's start. Kino gives `resolve`
 * 20 s (app: PluginContentSource.RESOLVE_TIMEOUT_MS) and a call it times out costs far more than an error the plugin
 * throws: Kino discards the runtime (the next call opens a cold one), counts the timeout toward "No responde" (three in a
 * row switch the plugin off; PluginRuntimePool) and the fallback never ran. The 3 s left are Kino's margin.
 */
export const RESOLVE_BUDGET_MS = 17_000;

/**
 * The least time left of RESOLVE_BUDGET_MS for the masnew fallback to start: the title (stored, else one backend lookup),
 * then three portal calls paced 0.4 s apart (searchByName, startPlayVOD, getSlbInfo; src/sources/xuper.js RATE_LIMIT_MS),
 * all of them cut at 16 s from the call's start (src/liveGate.js CALL_BUDGET_MS). Started with less, it would most likely
 * be cut too, and the person would wait until then for the error they read now.
 */
export const VOD_FALLBACK_MIN_MS = 6_000;

/**
 * What a `prepare` may spend, from the plugin call's start. Kino gives that background call 15 s (app: PlayAhead, under
 * BackgroundPluginCall) and ignores its answer, its failures and its timeouts, but a call it times out still loses its
 * runtime: the person's play that follows would open a cold one, the very wait prepare is there to save.
 */
export const PREPARE_BUDGET_MS = 12_000;

function log(m) { try { kino.log("" + m); } catch (_) { /* a log line never fails a call */ } }

/** A ref that names nothing this plugin can play or list: `not_found` ("Este plugin ya no tiene este título"), before any request. */
function notFound(why) { return kino.error("not_found", "Xuper: " + why); }

// The stream's subtitles (MagisPro's) → Kino's shape: { url, lang, format (vtt/srt) }. PURE. A `fileType` other than
// vtt/srt is left out → Kino infers it from the URL's extension (or takes vtt). At most 30 (Kino's cap).
export function subtitlesOf(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || !s.url || out.length >= 30) continue;
    const sub = { url: String(s.url) };
    if (s.language) sub.lang = String(s.language).slice(0, 20);
    const ft = String(s.fileType || "").toLowerCase();
    if (ft === "vtt" || ft === "srt") sub.format = ft;
    out.push(sub);
  }
  return out;
}

const EP_INT = /^[+-]?\d+$/;
const toEpInt = (v) => {
  const t = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  return t !== null && EP_INT.test(t.trim()) ? (Number(t.trim()) || 0) : null;
};

/**
 * Kino's `episodes` answer from a masnew detail: the chapter list, the sibling seasons (the season chips, from the portal's
 * `sameSeasonSeriesList`) and each episode's own season. `seriesId`/`type` are this title's ref parts (a sibling season is a
 * title of the same type). The TMDB stills/names/synopses are added later, best-effort, by [enrichEpisodes].
 */
export function toEpisodes(detail, seriesId, type) {
  const d = detail || {};
  const programs = d.simpleProgramList || d.programList || [];
  const E = lang() === "en";
  const chapterN = (n) => (E ? "Episode " : "Capítulo ") + n;
  const seasonN = (n) => (E ? "Season " : "Temporada ") + n;
  const seasonList = parseSeasonList(d.sameSeasonSeriesList, seriesId);
  const episodes = [];
  programs.forEach((p, idx) => {
    const cid = p.contentId || p.programContentId;
    if (!cid) return;
    // The chapter's own number within its season (`seriesNumber`): what TMDB is crossed by. programIndex/index as fallbacks.
    const number = toEpInt(p.seriesNumber) ?? toEpInt(p.programIndex) ?? toEpInt(p.episodeNumber) ?? idx + 1;
    const name = p.name || p.title ? String(p.name || p.title) : "";
    // The portal's "<series>_<n>" ("One Piece T1_8") is a file name, not a title: it reads "Capítulo N" unless TMDB has the real one.
    const numbered = number > 0 && name.includes("_") && isGenericTitle(name);
    const ep = { number, title: name.trim() !== "" && !numbered ? name : chapterN(number), ref: episodeRef(cid, seriesId) };
    const still = pickPoster(p.posterList);
    if (still) ep.still = still;
    if (p.description) ep.overview = String(p.description);
    if (seasonList.own !== null) ep.season = seasonList.own;
    episodes.push(ep);
  });
  const series = {};
  if (d.name) series.title = displaySeriesTitle(String(d.name));   // "Lupin T1" -> "Lupin" (the season is in the chips)
  const poster = pickPoster(d.posterList);
  if (poster) series.poster = poster;
  if (d.description) series.overview = String(d.description);
  const out = { series, episodes };
  if (seasonList.all.length > 0) {
    out.seasons = seasonList.all.slice(0, 50).map((s) => ({
      id: s.id,
      // A season IS a portal title of the same type: its ref is what a listing gave it.
      ref: itemRef(s.id, type == null ? "" : type),
      title: seasonN(s.number),
      number: s.number,
      current: s.id === seriesId,
    }));
  }
  return out;
}

const ENRICH_DEADLINE_MS = 15_000;   // TMDB enrichment ends by this into the call, 5 s before Kino's 20 s
const IMDB_ID = /^tt\d{7,}$/;

/** TMDB stills, real names, synopses, air dates and runtimes onto `answer.episodes`, plus the series' ids. Best-effort: a
 *  failure (no key, no match, no time) leaves the episodes exactly as the portal gave them. Mutates `answer`, never throws. */
async function enrichEpisodes(answer, detail, seriesId) {
  try {
    if (!answer || !Array.isArray(answer.episodes) || answer.episodes.length === 0) return;
    const raw = rawDetail(detail, seriesId);
    const started = callStartedAt();
    const deadline = (Number.isFinite(started) ? started : Date.now()) + ENRICH_DEADLINE_MS;
    const { extra, series } = await enrich(raw, makeTmdb(), deadline);
    for (const ep of answer.episodes) {
      const t = extra.get(ep.number);
      if (!t) continue;
      if (t.title && isGenericTitle(ep.title)) ep.title = t.title;   // TMDB's name only where the portal just numbers the chapter
      if (t.still && !ep.still) ep.still = t.still;
      if (t.overview && !ep.overview) ep.overview = t.overview;
      if (t.airDate) ep.airDate = t.airDate;
      if (t.runtimeMinutes) ep.runtimeMinutes = t.runtimeMinutes;
    }
    const imdb = IMDB_ID.test(raw.imdb || "") ? raw.imdb : "";
    if (series && series.tmdbId > 0) {
      answer.series = answer.series || {};
      answer.series.ids = imdb ? { imdb, tmdb: series.tmdbId } : { tmdb: series.tmdbId };
      if (!answer.series.title && series.title) answer.series.title = series.title;
      if (!answer.series.poster && series.poster) answer.series.poster = series.poster;
      if (series.backdrop) answer.series.backdrop = series.backdrop;
    } else if (imdb) {
      answer.series = answer.series || {};
      answer.series.ids = { imdb };
    }
  } catch (_) { /* enrichment never fails the episodes list */ }
}

export function expiresIn(expiresAt) {
  const e = Number(expiresAt) || 0;
  if (!e) return undefined;
  const left = e - Math.floor(Date.now() / 1000);
  return left > 30 ? Math.min(left, 86400) : undefined;
}

// ── the backend's catalog calls: through this device first (egress v2), the GET path on an older backend ──

const COLUMN_PAGE_SIZE = 30;

/** One page of a column ({items, total, …}): POST /column/egress, else GET /column/{id}. */
async function columnPage(columnId, page) {
  const d = await egressColumn(columnId, page, COLUMN_PAGE_SIZE);
  return d != null ? d : authed("GET", `/column/${columnId}?page=${page}&size=${COLUMN_PAGE_SIZE}`);
}

/**
 * An item's detail ({detail, related}): POST /item/egress, else GET /item/{id}. `deadline` (epoch ms, optional: a
 * resolve's): every request ends by it, a backend one in at most BACKEND_HOP_TIMEOUT_MS.
 */
async function itemData(id, type, deadline) {
  const d = await egressItem(id, type, deadline);
  if (d != null) return d;
  const timeoutMs = deadline ? BACKEND_HOP_TIMEOUT_MS : undefined;
  return authed("GET", `/item/${encodeURIComponent(id)}`, undefined, timeoutMs, undefined, deadline);
}

// ── exports (the data of each capability) ──

/** Kino Home: the stored catalog, revalidated first when due. With nothing at all it THROWS: an empty answer
 *  would replace the rows Kino already painted, a throw keeps them (PluginHomeRows) and Kino retries later. */
export async function home() {
  await revalidate({ catalog: true });
  const v2 = storedCatalog();
  const rows = v2 ? homeRows(v2) : [];
  if (!rows.length) throw kino.error("unavailable", "Xuper: no catalog stored yet and the refresh failed");
  return rows;
}

/**
 * A column page's cards as the rows show them (recommended posters, within Kino's limits). 18+ when the row was an
 * Adultos one (`col:<id>:a`), or when the stored catalog holds the title as adult (adult is OR-ed across sections), so
 * a «Ver más» never shows past Kino's parental lock what its row kept behind it.
 */
function columnItems(cards, adult) {
  const items = toItems(cards, adult, { poster: "recommended" });
  const v2 = storedCatalog();
  if (v2 && Array.isArray(v2.items)) {
    const adultIds = new Set(v2.items.filter((it) => it && it.adult === true).map((it) => it.id));
    for (const it of items) if (adultIds.has(it.id)) it.adult = true;
  }
  return items;
}

/** Kino "Ver más": `cat:<section>` pages through the stored catalog (100 per page, no revalidation, so pages
 *  never shift under a cursor); with nothing stored it revalidates once, else throws (never an empty page).
 *  `col:<id>` (a row of the own screen: src/screenView.js railNode) pages the portal column through the backend. */
export async function browse(ref, cursor) {
  const r = decodeRef(ref);
  const page = Math.max(1, parseInt(cursor || "1", 10) || 1);
  if (r.kind === "category") {
    let v2 = storedCatalog();
    if (!v2) {
      await revalidate({ catalog: true });
      v2 = storedCatalog();
    }
    if (!v2) throw kino.error("unavailable", "Xuper: no catalog stored yet and the refresh failed");
    return browsePage(v2, r.name, cursor);
  }
  if (r.kind === "column") {
    const data = await columnPage(r.columnId, page);
    let items = columnItems(data && data.items, !!r.adult);
    // Like search: one entry per series ("Ver más" of a live column also lists each season as its own title), the rest are
    // the detail's season chips. Within the page the portal lists a series' seasons together, so they collapse here.
    items = collapseSeasons(items, (it) => ({ title: it.title, series: it.kind === "series" }));
    for (const it of items) { const clean = displaySeriesTitle(it.title); if (clean && clean !== it.title) it.title = clean; }
    const total = Number(data && data.total) || 0;
    return { items, next: page * COLUMN_PAGE_SIZE < total ? String(page + 1) : null };
  }
  return { items: [], next: null };
}

/**
 * Kino's Categorías: one tile per section of the stored catalog (src/v2.js categoryTiles), each opening its "Ver más"
 * (`cat:<section>`, which browse pages). With nothing stored it revalidates once, else throws (Kino keeps its tiles).
 */
export async function categories() {
  let v2 = storedCatalog();
  if (!v2) {
    await revalidate({ catalog: true });
    v2 = storedCatalog();
  }
  if (!v2) throw kino.error("unavailable", "Xuper: no catalog stored yet and the refresh failed");
  return categoryTiles(v2);
}

/**
 * A series' chapters. A 2.x series (kind "legacy") lists on masnew, numbered as 2.x numbered it. Anything with no
 * series behind it (an unreadable ref, an empty id) is not_found with no request: Kino's new-episode check asks this for
 * every series watched lately, 2.x's included.
 */
export async function episodes(ref) {
  const r = decodeRef(ref);
  if (r.kind === "legacy") {
    if (!r.isSeries) throw notFound("a 2.x movie has no chapters");
    if (!(await currentBearer())) throw notActivated();
    return episodesAnswer(r, await legacyChapters(r.contentId), lang() === "en");
  }
  if ((r.kind !== "item" && r.kind !== "episode") || !r.id) throw notFound("no series behind this ref");
  const data = await itemData(r.id, r.type);
  const detail = data && data.detail;
  const answer = toEpisodes(detail, r.id, r.type);
  await enrichEpisodes(answer, detail, r.id);   // TMDB stills/names/seasons, best-effort; never fails the list
  return answer;
}

/**
 * A MOVIE's ids for Kino's title page (apiVersion 8 `details(ref)`, no capability): the portal detail's IMDb id
 * (`keyWords`), so Kino pins the right film on TMDB. Kino runs its own title lookup alongside this (never in front), so a
 * movie is already enriched by name; the IMDb id just makes it EXACT — the right film for an ambiguous or dub-tagged title.
 * Series carry their ids through `episodes().series`, not here. Best-effort: null (Kino's title match still enriches) on anything.
 */
export async function details(ref) {
  try {
    const r = decodeRef(ref);
    if (r.kind !== "item" || r.type === "0" || !r.id) return null;   // movies only (type "1"); a series uses episodes()
    if (!(await currentBearer())) return null;
    const data = await itemData(r.id, r.type);
    const imdb = String((data && data.detail && data.detail.keyWords) || "").trim();
    return IMDB_ID.test(imdb) ? { ids: { imdb } } : null;
  } catch (_) {
    return null;
  }
}

// ── Xuper 2.x's titles (src/legacy.js): masnew's own ids, played and listed on masnew as 2.x did ──

const CHAPTERS_TTL_MS = 30 * 60_000;
const CHAPTERS_MAX = 8;
const _chapters = new Map();   // season contentId → { at, raw }: a chapter list this runtime read, for the play that follows

/** Test helper: forget the chapter lists this runtime read. */
export function _resetLegacyMemory() { _chapters.clear(); }

/** A masnew season's chapters (`chaptersOf`), from this runtime's memory for 30 min, else one v4/getItemData. */
async function legacyChapters(seriesId) {
  const now = Date.now();
  const hit = _chapters.get(seriesId);
  if (hit && now - hit.at >= 0 && now - hit.at < CHAPTERS_TTL_MS) return hit.raw;
  let data;
  try { data = await chapterList(seriesId); } catch (e) { throw legacyError(e, "series"); }
  const raw = chaptersOf(data, seriesId);
  if (raw.items.length) {
    _chapters.delete(seriesId);
    _chapters.set(seriesId, { at: now, raw });
    while (_chapters.size > CHAPTERS_MAX) _chapters.delete(_chapters.keys().next().value);
  }
  return raw;
}

/**
 * A masnew portal failure as Kino reads it: a title or series the portal no longer has (portal100006, portal100004 or
 * "不存在") is not_found, a blocked region geo_blocked, anything else unavailable. The connector's own sentence for
 * the person (`userMessage`: a seed's, an account's) goes on.
 */
function legacyError(e, what) {
  const code = portalCodeOf(e);
  const msg = String((e && e.message) || "");
  const user = e && typeof e.userMessage === "string" && e.userMessage ? { userMessage: e.userMessage } : undefined;
  if (code === "portal100006" || code === "portal100004" || msg.includes("不存在")) return kino.error("not_found", "Xuper: masnew " + (code || "gone") + " (" + what + ")");
  if (code === "portal100024") return kino.error("geo_blocked", "Xuper: masnew portal100024 (" + what + ")", user);
  if (e && typeof e.code === "string" && e.code === "auth_required") return e;
  const reason = code || (e && (e.code || e.name)) || "error";
  return kino.error("unavailable", "Xuper: masnew " + what + " failed (" + String(reason).slice(0, 40) + ")", user);
}

/** A 2.x title or chapter's stream: a movie by its own id, a chapter by its season's list (2.x's chapter path). */
async function legacyResolve(m) {
  let chapter = null;
  if (m.isSeries) {
    const raw = await legacyChapters(m.contentId);
    if (!raw.items.length) throw notFound("the series has no chapters");
    chapter = findChapter(raw.items, m.episode);
    if (!chapter || !chapter.contentId) throw notFound("the series has no chapter " + m.episode);
  }
  try {
    return await resolveVod(chapter ? chapter.contentId : m.contentId, m.programType, chapter ? m.contentId : "");
  } catch (e) { throw legacyError(e, chapter ? "chapter" : "title"); }
}

/**
 * Kino's `migrate`: what Kino saved while Xuper was native, answered in 2.x's terms (src/legacy.js), which this
 * version plays. A native live favourite gets the id liveChannels gives that masnew channel (src/live.js).
 */
export function migrate(input) {
  return migrateValue(input, (code) => "xuper_" + hashId(code));
}

// ── VOD fallback (a safety net): when the backend cannot resolve a MOVIE, it falls back to masnew's VOD (deviceless).
// Different portals (magispro vs masnew) → different ids → matched by TITLE. Lazy: masnew is only asked when the
// backend fails. Not for series (masnew does not resolve a series by title without its chapters).
// `deadline`: the resolve's (RESOLVE_BUDGET_MS); the backend lookup ends by it.
async function titleForContent(contentId, type, storedOnly, deadline) {
  const id = String(contentId == null ? "" : contentId);
  if (!id) return "";
  const it = itemById(storedCatalog(), id);       // stored catalog: works while the backend is down
  if (it && it.title && it.title !== "—") return it.title;
  if (storedOnly) return "";                      // the backend asked to slow down: never ask it again now
  try {                                           // last resort: the backend's detail (only if it answers)
    const d = await itemData(id, type, deadline);
    const nm = d && d.detail && (d.detail.name || d.detail.title);
    if (nm) return String(nm);
  } catch (_) { /* backend down, out of time or other error → no title */ }
  return "";
}

/** The masnew stream for movie `r` (by title), or null. Started only with VOD_FALLBACK_MIN_MS left of `deadline`. */
async function vodFallback(r, storedOnly, deadline) {
  if (!r || r.kind !== "item" || r.type === "0") return null;   // movies only; never a series or an episode
  const left = deadline - Date.now();
  if (left < VOD_FALLBACK_MIN_MS) {
    log("resolve: the relay failed with " + Math.max(0, left) + " ms left: no time for the masnew fallback");
    return null;
  }
  const title = await titleForContent(r.id, r.type, storedOnly, deadline);
  if (!title) return null;
  let match;
  try { match = await searchVod(title); } catch (_) { return null; }
  if (!match || !match.contentId || (match.type && match.type !== "movie")) return null;
  let out;
  try { out = await resolveVod(match.contentId, match.type); } catch (_) { return null; }
  return out && out.url ? out : null;
}

/**
 * A relay resolve of the same title within this long of the last one asks the backend for a new CDN authorization
 * (`relayResolve`'s `fresh`): it is the player's retry after the CDN refused the stream, a lazy quality copy after the
 * one on screen failed, or the person playing it again, and the authorization the backend cached may be what failed.
 * Runtime memory only: a cold runtime asks with the cached one, as a first play does.
 */
const FRESH_AGAIN_MS = 5 * 60_000;
const FRESH_MEMORY_MAX = 64;
const _lastResolve = new Map();   // "<id>|<series>" → epoch ms of its last relay resolve

/** Whether this resolve of `key` asks for a fresh authorization; records it either way. */
function freshAgain(key, now = Date.now()) {
  const last = _lastResolve.get(key);
  _lastResolve.delete(key);
  _lastResolve.set(key, now);
  if (_lastResolve.size > FRESH_MEMORY_MAX) _lastResolve.delete(_lastResolve.keys().next().value);
  return last !== undefined && now - last >= 0 && now - last < FRESH_AGAIN_MS;
}

/** Test helper: forget the titles resolved in this runtime. */
export function _resetResolveMemory() { _lastResolve.clear(); }

/** Whether decoded ref `r` names something `resolve` can play. */
function playable(r) {
  return r.kind === "live" || r.kind === "legacyLive" || r.kind === "legacy" || ((r.kind === "item" || r.kind === "episode") && !!r.id);
}

export async function resolve(ref) {
  const r = decodeRef(ref);
  // A ref nothing can play is not_found at once: activating would not help.
  if (!playable(r)) throw notFound("ref not playable");
  // HARD GATE: not activated (no Bearer), NOTHING plays — no live channel, no VOD, no masnew fallback. auth_required
  // with the way in (Kino offers the plugin's settings, whose button opens the screen).
  if (!(await currentBearer())) throw notActivated();
  // AGGREGATOR: the channel is resolved by its connector (src/sources/<source>) through src/live.js (one seam, ready to
  // fall through to the same channel in other sources). Deviceless: never through the backend.
  if (r.kind === "live") return resolveLive(ref);
  // A 2.x favourite or recent: the same masnew channel, through the same seam.
  if (r.kind === "legacyLive") return resolveLive(liveRef("xuper", r.code));
  if (r.kind === "legacy") return legacyResolve(r);
  if (r.kind === "item" || r.kind === "episode") {
    // The relay and the fallback both end by this, inside Kino's 20 s (RESOLVE_BUDGET_MS).
    const deadline = callStartedAt() + RESOLVE_BUDGET_MS;
    const params = [];
    if (r.kind === "episode" && r.series) params.push(`series=${encodeURIComponent(r.series)}`);
    if (r.quality) params.push(`quality=${encodeURIComponent(r.quality)}`);
    const q = params.length ? `?${params.join("&")}` : "";
    let stream;
    try {
      stream = await relayResolve(encodeURIComponent(r.id) + q, deadline, freshAgain(r.id + "|" + (r.series || "")));
    } catch (e) {
      // VOD FALLBACK: the backend did not resolve (down, the account kicked out, 403, 429...). A MOVIE falls back to
      // masnew's VOD (deviceless), matched by TITLE. No match, or a series: the relay's error is thrown again.
      // A backend 429 still tries it, on the stored catalog's title only (no backend call during the wait); without a
      // match the person reads the 429's "too many requests" message. With less than VOD_FALLBACK_MIN_MS left (a
      // stalled hop took the time) it is not started: the relay's own error, now, as when it finds no match.
      const fb = await vodFallback(r, isRateLimited(e), deadline);
      if (fb) return fb;
      throw e;
    }
    const out = { url: stream.url, mime: "video/mp2t" };
    const exp = expiresIn(stream.expiresAt);
    if (exp) out.expiresInSeconds = exp;
    // Quality picker: ONLY on the first resolve (no quality in the ref). The quality resolved is the label; the
    // OTHERS available go as LAZY alternatives — picking one, Kino resolves again with ?quality=.
    if (!r.quality && Array.isArray(stream.qualities) && stream.qualities.length > 1) {
      const current = stream.quality || stream.qualities[0];
      const base = r.kind === "episode" ? episodeRef(r.id, r.series) : itemRef(r.id, r.type);
      out.label = current;
      out.alternatives = stream.qualities
        .filter((qq) => qq && qq !== current)
        .map((qq) => ({ label: qq, ref: withQuality(base, qq) }));
    }
    // The stream's subtitles (MagisPro's, through the relay): Kino offers them in the player.
    const subs = subtitlesOf(stream.subtitles);
    if (subs.length) out.subtitles = subs;
    return out;
  }
  throw notFound("ref not playable");
}

/**
 * Kino's play ahead (app: PlayAhead, owner 2026-11-18): the person rests on a title page, so what the play that may follow
 * needs besides the title gets ready now on the backend (src/api.js `prepareRelay`: the trial session and this device's
 * CDN authorization), and that resolve brings only [play]. Never a resolve ahead: one nobody plays may spend one of the
 * portal's free plays, and /resolve allows 60 an hour per account. `ref` is what `resolve` would get; it only tells a VOD
 * play (a movie or an episode) from the rest (live, a section, anything else: nothing to do), since what gets ready is
 * the same for every title. No Bearer: nothing either (a sign-in needs the person's screen, never a background call). It
 * never throws: Kino ignores the answer, so a failure is one log line. → "ready" | "skip" | "failed", for tests and logs.
 */
export async function prepare(ref) {
  try {
    const r = decodeRef(ref);
    if ((r.kind !== "item" && r.kind !== "episode") || !r.id) return "skip";
    if (!(await currentBearer())) return "skip";
    const out = await prepareRelay(callStartedAt() + PREPARE_BUDGET_MS);
    return out == null ? "skip" : out.ready === true ? "ready" : "failed";
  } catch (e) {
    const code = (e && e.code) || "error";
    const msg = e && e.message ? String(e.message).slice(0, 160) : "";
    log("prepare: failed (" + code + (msg && msg !== code ? ": " + msg : "") + ")");
    return "failed";
  }
}

// A search cache IN THE CLIENT: the same query → no backend call. Kino already debounces and cancels old queries
// (PluginMoreSearch), so this trims the repeats (typing again, going back, opening again). Every call saved here is one
// less for the backend. A small LRU + a TTL, so nothing stale is served.
const _searchCache = new Map(); // normQuery -> { at, items }
const SEARCH_CACHE_TTL_MS = 180000; // 3 min
const SEARCH_CACHE_MAX = 32;

export async function search(query) {
  if (!(await currentBearer())) return [];   // the gate: not activated, Xuper is not in Kino's search
  // Kino passes KinoSearchQuery: the text is `q`. (`within` is a scopedSearch browse ref, never search text, and this
  // plugin does not declare scopedSearch.) `text` stays as a fallback for any older caller.
  const raw = typeof query === "string" ? query : (query && (query.q || query.text)) || "";
  const q = String(raw).trim();
  if (!q) return [];
  const key = q.toLowerCase();
  const now = Date.now();
  const hit = _searchCache.get(key);
  if (hit && now - hit.at < SEARCH_CACHE_TTL_MS) return hit.items;
  let data;
  // Rate-limited (a 429, or inside its wait): the last answer for this query, however old, else nothing.
  try {
    data = await egressSearch(q);                                         // through this device (backend f545db3)
    if (data == null) data = await authed("GET", `/search?q=${encodeURIComponent(q)}`);   // an older backend
  } catch (e) { return isRateLimited(e) && hit ? hit.items : []; }
  const cards = [];
  for (const k of ["resourceResult", "programResult", "seriesResult"]) {
    const b = data && data[k];
    const arr = b && (b.list || b.assetList || b.resourceList);
    if (Array.isArray(arr)) cards.push(...arr);
  }
  let items = toItems(cards, false, { poster: "recommended" });   // the vertical cover, like Home and the categories
  // One entry per series: the portal lists each season as its own title ("Lupin T1/T2/T3") — show only the lowest, the rest
  // are the season chips inside the detail (2.x's collapseSeasons). Then the shown name drops its season tag ("Lupin").
  items = collapseSeasons(items, (it) => ({ title: it.title, series: it.kind === "series" }));
  for (const it of items) { const clean = displaySeriesTitle(it.title); if (clean && clean !== it.title) it.title = clean; }
  _searchCache.delete(key);                 // inserted again at the end (an LRU by insertion order)
  _searchCache.set(key, { at: now, items });
  while (_searchCache.size > SEARCH_CACHE_MAX) _searchCache.delete(_searchCache.keys().next().value);
  return items;
}
