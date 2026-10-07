// Live categories and channels over the Magis portal (native-magis.md §6.1, §6.2; MagisLiveCatalog.kt).
// No plugin-side cache of what En vivo shows (controller ruling R19): the app caches both lists for an hour.
// Kept in memory: the set of adult category ids, so an adult category's channels are always marked. Kept in
// storage, read ONLY by the Categorías live tiles (liveTiles.js), each small and under its own key: which
// categories are a tile's genre, so opening Categorías asks the portal nothing once En vivo, the country row
// or a previous Categorías read the list; and one channel logo per genre, noted from channel pages already
// fetched (En vivo, a tile's grid), which becomes that tile's picture.
// 18+ is marked `adult: true`, never hidden (D3): Kino shows it only behind the device's 18+ code.
import { PortalError, mapPortalError, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { logoOf } from "./homeTree.js";
import { isObject, asText, isBlank, isKinoError, intOrNull } from "./util.js";
import { trace, errCode } from "./trace.js";
import { channelOf } from "./channelId.js";
import { CATEGORIES_BY_COUNTRY } from "./countryRow.js";
import { say } from "./i18n.js";

const LIVE_ROOT = "masnew_live";
const CATEGORIES_PAGE_SIZE = 200; // 30 lost eight of the 38 real categories
// A liveChannels page: 250 channels, half the SDK's 500, so one page costs a slow TV half the time
// (500 took 15-19 s on the KALLEY with 2.2.7, close to the 20 s cap); 20 pages keep the 5,000 a category
// could list before (Kino asks 10 pages first, 5 more per scroll). Todos (1,037) is 5 pages.
const LIST_PAGE_SIZE = 250;
const LIST_MAX_PAGES = 20;
// liveSearch's sweep reads whole categories in one call: bigger pages, fewer paced portal calls.
const SWEEP_PAGE_SIZE = 500;
const MAX_PAGES = 10;
const MAX_CATEGORIES = 200; // SDK cap
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const POSITIVE = /^\d{1,9}$/;
// liveSearch: the swept list is kept in memory as long as the app keeps a listing (1 h), never in storage.
const SEARCH_INDEX_TTL_MS = 60 * 60_000;
// An incomplete sweep (a later page failed) is kept only briefly: long enough that a burst of searches
// does not repeat ~30 portal calls each, short enough that the missing pages come back soon.
const PARTIAL_INDEX_TTL_MS = 3 * 60_000;
const MAX_SEARCH_HITS = 100; // SDK: liveSearch keeps 100
const MIN_SEARCH_CHARS = 2; // SDK: asked from 2 characters
// The genre categories for the Categorías live tiles: at most 200 [id, genre] pairs, a few KB at worst.
// v2: "Cine y Series" became a tile; a v1 list (kept without it) is dropped, not read.
export const CATEGORIES_KEY = "liveCats:v2";
const OLD_CATEGORIES_KEYS = ["liveCats:v1"];
const CATEGORIES_TTL_MS = 12 * 3600_000;
// One logo per tile genre, `{ genre: url }`: ten genres at most, a URL of at most 512 characters (the portal
// CDN's are about a hundred; a longer one is simply not kept), so a few KB at worst.
export const LOGOS_KEY = "liveLogos:v1";
const LOGOS_TTL_MS = 7 * 24 * 3600_000;
export const MAX_LOGO_CHARS = 512;
const plain = (text) => String(text).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/\s+/g, " ").trim();

// The portal calls the all-channels category "ChannelList": an internal English name.
const ALL_CHANNELS = "ChannelList";
const NAMES = { [ALL_CHANNELS]: "Todos" };
// Recognized by NAME because it is the only thing the portal gives: no field marks them.
const ADULT_NAMES = new Set(["18+", "adultos", "adulto", "xxx", "+18"]);
// A category's `genre` (the contract's closed list; En vivo's filter across providers), only for a name that
// IS one (lowercase, no accents, whole name): a country, "Todos" or anything else gets none.
const GENRE_BY_NAME = new Map(Object.entries({
  deportes: "deportes", deporte: "deportes", sports: "deportes", futbol: "deportes",
  noticias: "noticias", news: "noticias",
  infantil: "infantil", infantiles: "infantil", kids: "infantil", ninos: "infantil",
  musica: "musica", music: "musica",
  documentales: "documentales", documental: "documentales",
  peliculas: "peliculas",
  series: "series",
  anime: "anime",
  entretenimiento: "entretenimiento",
}));
export const genreOfCategory = (name) => GENRE_BY_NAME.get(plain(name)) ?? null;
// Categories that get a Categorías tile without being one of the contract's genres (so En vivo's filter does
// not see them): matched by their exact whole name, like a genre; nothing looser.
const TILE_GENRE_BY_NAME = new Map(Object.entries({ "cine y series": "cineyseries" }));
/** The live tile genre of a category name: a contract genre, else a tile-only one, else null. */
export const tileGenreOfCategory = (name) => genreOfCategory(name) ?? TILE_GENRE_BY_NAME.get(plain(name)) ?? null;
// A category's `country` (ISO 3166 alpha-2): only a name that is one country's own category (countryRow.js);
// "Centroamérica" stands for three countries and gets none.
const COUNTRY_BY_NAME = (() => {
  const codes = new Map();
  for (const [cc, name] of Object.entries(CATEGORIES_BY_COUNTRY)) codes.set(plain(name), codes.has(plain(name)) ? null : cc);
  return codes;
})();
export const countryOfCategory = (name) => COUNTRY_BY_NAME.get(plain(name)) ?? null;



export function makeLiveCatalog({ kino, portal, session, clock }) {
  // Adult category ids seen in the last non-empty categories answer; null = not read yet.
  let adultIds = null;
  // Tile genre of each genre category id, from the last categories answer (null = use the kept list).
  let genreById = null;

  // Portal codes become the mapped kino error, other kino errors pass, anything else is `unavailable`.
  const surface = (e) => {
    if (e instanceof PortalError) return mapPortalError(e.code, e.message, kino);
    if (isKinoError(e)) return e;
    return kino.error("unavailable", "Xuper no está disponible ahora");
  };

  /** Every category (adult ones flagged); a failure is the mapped error, never an empty list. */
  // `deadline`: the calling export's (injected clock); every portal exchange runs inside it.
  async function readCategories(deadline) {
    let response;
    try {
      await session.ensure({ deadline });
      response = await session.withValidSession(({ userId, userToken }) => portal.call(
        "getNextColumns",
        { columnCode: LIVE_ROOT, pageNum: 1, pageSize: CATEGORIES_PAGE_SIZE, version: "" },
        { baseFields: true, userId, userToken, deadline },
      ), { deadline });
    } catch (e) { throw surface(e); }
    const columns = isObject(response) && Array.isArray(response.recommendList) ? response.recommendList : [];
    const out = [];
    for (const c of columns) {
      if (!isObject(c)) continue;
      const id = intOrNull(c.columnId);
      if (id === null || id <= 0) continue;
      const raw = asText(c.name);
      const name = Object.hasOwn(NAMES, raw) ? NAMES[raw] : raw;
      if (isBlank(name)) continue;
      out.push({ id: String(id), name, adult: ADULT_NAMES.has(name.trim().toLowerCase()), ...(raw === ALL_CHANNELS ? { all: true } : {}) });
    }
    if (out.length > 0) {
      adultIds = new Set(out.filter((c) => c.adult).map((c) => c.id));
      genreById = new Map(genreCategoriesOf(out).map((c) => [c.id, c.genre]));
      store(out);
    }
    return out;
  }

  // The categories whose whole name is a genre, as [id, genre]: all the live tiles need (an adult category and
  // "Todos" are never one). A few bytes each; [] is kept too (this portal has none: nothing to ask again).
  const genreCategoriesOf = (list) => list
    .filter((c) => !c.adult && !c.all && POSITIVE.test(c.id) && Number(c.id) > 0)
    .map((c) => ({ id: c.id, genre: tileGenreOfCategory(c.name) }))
    .filter((c) => c.genre !== null);

  function store(list) {
    try {
      const rows = genreCategoriesOf(list).slice(0, MAX_CATEGORIES).map((c) => [c.id, c.genre]);
      kino.storage.set(CATEGORIES_KEY, JSON.stringify(rows), { ttlMs: CATEGORIES_TTL_MS });
      for (const k of OLD_CATEGORIES_KEYS) kino.storage.remove(k);
    } catch (_) { /* memory only: the tiles ask the portal next time */ }
  }

  // ---- One logo per tile genre (the tiles' pictures) ---------------------------------------------
  // Noted from pages fetched anyway, never asked for: the first https logo of a genre category's page, kept
  // until it expires (a week), so a tile's picture stays put instead of following each page read.
  let logos; // memory copy of LOGOS_KEY: undefined = not read yet

  /** The kept `{ genre: url }` (never throws; {} when nothing is kept). */
  function genreLogos() {
    if (logos !== undefined) return logos;
    logos = {};
    try {
      const text = kino.storage.get(LOGOS_KEY);
      const map = typeof text === "string" ? JSON.parse(text) : null;
      if (isObject(map)) {
        for (const [g, url] of Object.entries(map)) if (usableLogo(url)) logos[g] = url;
      }
    } catch (_) { /* unreadable: no pictures */ }
    return logos;
  }

  const usableLogo = (url) => typeof url === "string" && url.length <= MAX_LOGO_CHARS && url.startsWith("https://");

  function genreOfId(categoryId) {
    if (genreById !== null) return genreById.get(categoryId) ?? null;
    return storedGenreCategories()?.find((c) => c.id === categoryId)?.genre ?? null;
  }

  // `items`: a page of category `categoryId` as `project` returns it. Never throws, never asks the portal.
  function noteLogo(categoryId, items) {
    try {
      const genre = genreOfId(categoryId);
      if (genre === null) return;
      const known = genreLogos();
      if (Object.hasOwn(known, genre)) return;
      const logo = items.find((c) => usableLogo(c.logo))?.logo;
      if (!logo) return;
      logos = { ...known, [genre]: logo };
      kino.storage.set(LOGOS_KEY, JSON.stringify(logos), { ttlMs: LOGOS_TTL_MS });
    } catch (_) { /* a tile without a picture */ }
  }

  /** The kept genre categories (`{ id, genre }`), or null when none are kept (or they are unreadable). */
  function storedGenreCategories() {
    try {
      const text = kino.storage.get(CATEGORIES_KEY);
      if (typeof text !== "string") return null;
      const rows = JSON.parse(text);
      if (!Array.isArray(rows)) return null;
      return rows.filter((r) => Array.isArray(r) && typeof r[0] === "string" && POSITIVE.test(r[0]) && typeof r[1] === "string")
        .map((r) => ({ id: r[0], genre: r[1] }));
    } catch (_) { return null; }
  }

  async function liveCategories() {
    const all = await readCategories(callDeadline(clock, CALL_BUDGET_MS.liveCategories));
    return all.filter((c) => ID.test(c.id)).slice(0, MAX_CATEGORIES).map((c) => {
      if (c.adult) return { id: c.id, title: c.name, adult: true };
      // The all-channels category's name is ours ("Todos"): in Kino's language.
      const out = { id: c.id, title: c.all ? say(kino, "allChannels") : c.name };
      const country = countryOfCategory(c.name);
      if (country !== null) out.country = country;
      const genre = genreOfCategory(c.name);
      if (genre !== null) out.genre = genre;
      return out;
    });
  }

  async function isAdultCategory(id, deadline) {
    if (adultIds === null) {
      await readCategories(deadline);
      // No categories at all: it cannot be told apart from an adult one, so it is not served unmarked.
      if (adultIds === null) throw kino.error("unavailable", "Xuper no está disponible ahora");
    }
    return adultIds.has(id);
  }

  async function fetchPage(columnId, page, deadline, pageSize = LIST_PAGE_SIZE) {
    await session.ensure({ deadline });
    const response = await session.withValidSession(({ userId, userToken }) => portal.call(
      "v6/getLiveData",
      { columnId: Number(columnId), pageNum: page, pageSize, dataVersion: "", expireTimeStr: "" },
      { baseFields: true, userId, userToken, deadline },
    ), { deadline });
    return isObject(response) && Array.isArray(response.channelList) ? response.channelList : [];
  }

  // `drops` (optional) counts what a page loses before the app sees it, by reason, for the breadcrumb.
  function project(list, categoryId, adult, drops = {}) {
    const seen = new Set();
    const items = [];
    const drop = (why) => { drops[why] = (drops[why] ?? 0) + 1; };
    for (const c of list) {
      if (!isObject(c)) { drop("shape"); continue; }
      const code = asText(c.channelCode);
      const title = asText(c.name);
      if (isBlank(code) || isBlank(title)) { drop("blank"); continue; }
      // Any non-blank code gets a valid id (channelId.js); only an absurdly long one is `badid`.
      const channel = channelOf(code);
      if (!channel) { drop("badid"); continue; }
      if (seen.has(channel.id)) { drop("dup"); continue; }
      seen.add(channel.id);
      const n = intOrNull(c.channelNumber);
      const item = { id: channel.id, title, ref: channel.ref, categoryId, number: n !== null && n >= 1 && n <= 9999 ? n : 0 };
      if (adult) item.adult = true;
      const logo = logoOf(c);
      if (logo) item.logo = logo;
      items.push(item);
    }
    return items;
  }

  async function liveChannels({ categoryId, cursor } = {}) {
    const deadline = callDeadline(clock, CALL_BUDGET_MS.liveChannels);
    if (typeof categoryId !== "string" || !POSITIVE.test(categoryId) || Number(categoryId) <= 0) {
      throw kino.error("not_found", "No se encontró esa categoría");
    }
    const id = String(Number(categoryId));
    const page = typeof cursor === "string" && POSITIVE.test(cursor) && Number(cursor) >= 1 ? Number(cursor) : 1;
    if (page > LIST_MAX_PAGES) return { items: [] };
    // Native "stops at the first failed page": page 1 fails loudly, a later one just ends the listing.
    try {
      const adult = await isAdultCategory(id, deadline);
      const list = await fetchPage(id, page, deadline);
      const drops = {};
      const items = project(list, id, adult, drops);
      if (!adult) noteLogo(id, items);
      // What the portal sent against what went on (counts only): a gap against the old native list shows here.
      trace(kino, "live", "page", { cat: id, page, raw: list.length, kept: items.length, ...drops });
      return list.length >= LIST_PAGE_SIZE && page < LIST_MAX_PAGES ? { items, next: String(page + 1) } : { items };
    } catch (e) {
      if (page > 1) {
        // The listing ends here (as the native one did), but a truncated list must not be silent.
        trace(kino, "live", "page_fail", { cat: id, page, code: errCode(e) });
        return { items: [] };
      }
      throw surface(e);
    }
  }

  // For the Home country row (countryRow.js), inside the CALLER's deadline (home's), errors as they come.
  /** Every category as `{ id, name, adult }` (ids not yet checked against the SDK pattern). */
  const categoriesWithin = (deadline) => readCategories(deadline);
  /** The first channels page of category `id`, projected and marked like liveChannels'. */
  async function channelsWithin(id, deadline) {
    const adult = await isAdultCategory(id, deadline);
    return project(await fetchPage(id, 1, deadline), id, adult);
  }

  // ---- liveSearch: En vivo's search over the whole list -----------------------------------------
  // The portal has no channel search, so the list is swept once: every 18+ category first (a channel
  // found there is adult wherever else it is listed), then ChannelList, the portal's all-channels
  // category (every other category when there is none), each one page after another. Kept in memory
  // for an hour, so a search inside it asks the portal nothing (an incomplete sweep, for 3 minutes). Every hit carries its categoryId AND an
  // explicit `adult`: the app counts an unmarked hit as 18+.
  let index = null; // { atMs, channels: Map<code, item> }: only a complete sweep is kept
  let partial = null; // same shape as `index`, from an incomplete sweep; expires after PARTIAL_INDEX_TTL_MS
  let sweeping = null;

  // Every page of [category] into [into] (a code already there keeps its first category: the adult one);
  // [read] counts the pages that answered.
  async function sweepCategory(category, into, deadline, read = { pages: 0 }) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = await fetchPage(category.id, page, deadline, SWEEP_PAGE_SIZE);
      read.pages++;
      for (const item of project(list, category.id, category.adult)) {
        if (!into.has(item.id)) into.set(item.id, { ...item, adult: category.adult });
      }
      if (list.length < SWEEP_PAGE_SIZE) return;
    }
  }

  async function sweep(deadline) {
    const channels = new Map();
    let complete = true;
    try {
      const all = (await readCategories(deadline)).filter((c) => ID.test(c.id) && POSITIVE.test(c.id));
      if (all.length === 0) throw kino.error("unavailable", "Xuper no está disponible ahora");
      // Fail closed: an 18+ list that cannot be read fails the search (its channels would pass as plain).
      for (const c of all.filter((c) => c.adult)) await sweepCategory(c, channels, deadline);
      const everything = all.find((c) => c.all && !c.adult);
      const plainOnes = everything ? [everything] : all.filter((c) => !c.adult);
      const read = { pages: 0 };
      for (const c of plainOnes) {
        try {
          await sweepCategory(c, channels, deadline, read);
        } catch (e) {
          // No plain page read yet: the search has nothing to say, so it fails; else what was found is served.
          if (read.pages === 0) throw e;
          complete = false;
          trace(kino, "live", "search_partial", { code: errCode(e), pages: read.pages });
          break;
        }
      }
    } catch (e) { throw surface(e); }
    return { complete, channels };
  }

  async function channelIndex(deadline) {
    if (index && clock.now() - index.atMs < SEARCH_INDEX_TTL_MS) return index.channels;
    if (partial && clock.now() - partial.atMs < PARTIAL_INDEX_TTL_MS) return partial.channels;
    // Searches that arrive while a sweep runs JOIN it and are bound by the deadline of the call that
    // started it, not their own: a joiner can get a failure or a partial result sooner than its budget.
    sweeping ??= sweep(deadline).finally(() => { sweeping = null; });
    const { complete, channels } = await sweeping;
    if (complete) { index = { atMs: clock.now(), channels }; partial = null; }
    else partial = { atMs: clock.now(), channels };
    return channels;
  }

  async function liveSearch(arg) {
    const raw = isObject(arg) && typeof arg.query === "string" ? arg.query : "";
    const q = plain(raw);
    if (q.length < MIN_SEARCH_CHARS) return { items: [] };
    const deadline = callDeadline(clock, CALL_BUDGET_MS.liveSearch);
    const channels = await channelIndex(deadline);
    const n = POSITIVE.test(q) ? Number(q) : null;
    const hits = [];
    for (const c of channels.values()) {
      const title = plain(c.title);
      // 0: its number, 1: the name starts with it, 2: a word starts with it, 3: the name contains it.
      const rank = n !== null && c.number === n ? 0 : title.startsWith(q) ? 1 : title.includes(" " + q) ? 2 : title.includes(q) ? 3 : -1;
      if (rank >= 0) hits.push({ c, rank, i: hits.length });
    }
    hits.sort((a, b) => a.rank - b.rank || a.i - b.i);
    return { items: hits.slice(0, MAX_SEARCH_HITS).map((h) => ({ ...h.c })) };
  }

  // For the Categorías live tiles (liveTiles.js).
  /** The categories that are a genre (`{ id, genre }`): the kept ones, else one portal read inside `deadline` (which keeps them). */
  const genreCategories = async (deadline) => storedGenreCategories() ?? genreCategoriesOf(await readCategories(deadline));
  /** Page `page` of category `id`, `size` channels a page (the caller checked the category is not adult). */
  async function channelsPage(id, page, size, deadline) {
    const list = await fetchPage(id, page, deadline, size);
    const items = project(list, id, false);
    noteLogo(id, items);
    return { items, full: list.length >= size };
  }

  return { liveCategories, liveChannels, categoriesWithin, channelsWithin, liveSearch, genreCategories, genreLogos, channelsPage, surface };
}
