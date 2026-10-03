// Live categories and channels over the Magis portal (native-magis.md §6.1, §6.2; MagisLiveCatalog.kt).
// No plugin-side cache (controller ruling R19): the app caches both lists for an hour. The one thing
// kept in memory is the set of adult category ids, so an adult category's channels are always marked.
// 18+ is marked `adult: true`, never hidden (D3): Kino shows it only behind the device's 18+ code.
import { PortalError, mapPortalError, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { logoOf } from "./homeTree.js";
import { isObject, asText, isBlank, isKinoError, intOrNull } from "./util.js";
import { trace, errCode } from "./trace.js";

const LIVE_ROOT = "masnew_live";
const CATEGORIES_PAGE_SIZE = 200; // 30 lost eight of the 38 real categories
const CHANNELS_PAGE_SIZE = 500;
const MAX_PAGES = 10; // SDK: at most 10 pages per category
const MAX_CATEGORIES = 200; // SDK cap
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const POSITIVE = /^\d{1,9}$/;
// liveSearch: the swept list is kept in memory as long as the app keeps a listing (1 h), never in storage.
const SEARCH_INDEX_TTL_MS = 60 * 60_000;
const MAX_SEARCH_HITS = 100; // SDK: liveSearch keeps 100
const MIN_SEARCH_CHARS = 2; // SDK: asked from 2 characters
const plain = (text) => String(text).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/\s+/g, " ").trim();

// The portal calls the all-channels category "ChannelList": an internal English name.
const ALL_CHANNELS = "ChannelList";
const NAMES = { [ALL_CHANNELS]: "Todos" };
// Recognized by NAME because it is the only thing the portal gives: no field marks them.
const ADULT_NAMES = new Set(["18+", "adultos", "adulto", "xxx", "+18"]);



export function makeLiveCatalog({ kino, portal, session, clock }) {
  // Adult category ids seen in the last non-empty categories answer; null = not read yet.
  let adultIds = null;

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
    if (out.length > 0) adultIds = new Set(out.filter((c) => c.adult).map((c) => c.id));
    return out;
  }

  async function liveCategories() {
    const all = await readCategories(callDeadline(clock, CALL_BUDGET_MS.liveCategories));
    return all.filter((c) => ID.test(c.id)).slice(0, MAX_CATEGORIES)
      .map((c) => (c.adult ? { id: c.id, title: c.name, adult: true } : { id: c.id, title: c.name }));
  }

  async function isAdultCategory(id, deadline) {
    if (adultIds === null) {
      await readCategories(deadline);
      // No categories at all: it cannot be told apart from an adult one, so it is not served unmarked.
      if (adultIds === null) throw kino.error("unavailable", "Xuper no está disponible ahora");
    }
    return adultIds.has(id);
  }

  async function fetchPage(columnId, page, deadline) {
    await session.ensure({ deadline });
    const response = await session.withValidSession(({ userId, userToken }) => portal.call(
      "v6/getLiveData",
      { columnId: Number(columnId), pageNum: page, pageSize: CHANNELS_PAGE_SIZE, dataVersion: "", expireTimeStr: "" },
      { baseFields: true, userId, userToken, deadline },
    ), { deadline });
    return isObject(response) && Array.isArray(response.channelList) ? response.channelList : [];
  }

  function project(list, categoryId, adult) {
    const seen = new Set();
    const items = [];
    for (const c of list) {
      if (!isObject(c)) continue;
      const code = asText(c.channelCode);
      const title = asText(c.name);
      if (isBlank(code) || isBlank(title) || !ID.test(code) || code.startsWith("~") || seen.has(code)) continue;
      seen.add(code);
      const n = intOrNull(c.channelNumber);
      const item = { id: code, title, ref: code, categoryId, number: n !== null && n >= 1 && n <= 9999 ? n : 0 };
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
    if (page > MAX_PAGES) return { items: [] };
    // Native "stops at the first failed page": page 1 fails loudly, a later one just ends the listing.
    try {
      const adult = await isAdultCategory(id, deadline);
      const list = await fetchPage(id, page, deadline);
      const items = project(list, id, adult);
      return list.length >= CHANNELS_PAGE_SIZE && page < MAX_PAGES ? { items, next: String(page + 1) } : { items };
    } catch (e) {
      if (page > 1) return { items: [] };
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
  // for an hour, so a search inside it asks the portal nothing. Every hit carries its categoryId AND an
  // explicit `adult`: the app counts an unmarked hit as 18+.
  let index = null; // { atMs, channels: Map<code, item> }: only a complete sweep is kept
  let sweeping = null;

  // Every page of [category] into [into] (a code already there keeps its first category: the adult one);
  // [read] counts the pages that answered.
  async function sweepCategory(category, into, deadline, read = { pages: 0 }) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = await fetchPage(category.id, page, deadline);
      read.pages++;
      for (const item of project(list, category.id, category.adult)) {
        if (!into.has(item.id)) into.set(item.id, { ...item, adult: category.adult });
      }
      if (list.length < CHANNELS_PAGE_SIZE) return;
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
    sweeping ??= sweep(deadline).finally(() => { sweeping = null; });
    const { complete, channels } = await sweeping;
    if (complete) index = { atMs: clock.now(), channels };
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

  return { liveCategories, liveChannels, categoriesWithin, channelsWithin, liveSearch };
}
