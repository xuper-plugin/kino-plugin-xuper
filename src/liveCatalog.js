// Live categories and channels over the Magis portal (native-magis.md §6.1, §6.2; MagisLiveCatalog.kt).
// No plugin-side cache (controller ruling R19): the app caches both lists for an hour. The one thing
// kept in memory is the set of adult category ids, so an adult category's channels are always marked.
// 18+ is marked `adult: true`, never hidden (D3): Kino shows it only behind the device's 18+ code.
import { PortalError, mapPortalError, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { logoOf } from "./homeTree.js";
import { isObject, asText, isBlank, isKinoError, intOrNull } from "./util.js";

const LIVE_ROOT = "masnew_live";
const CATEGORIES_PAGE_SIZE = 200; // 30 lost eight of the 38 real categories
const CHANNELS_PAGE_SIZE = 500;
const MAX_PAGES = 10; // SDK: at most 10 pages per category
const MAX_CATEGORIES = 200; // SDK cap
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const POSITIVE = /^\d{1,9}$/;

// The portal calls the all-channels category "ChannelList": an internal English name.
const NAMES = { ChannelList: "Todos" };
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
      out.push({ id: String(id), name, adult: ADULT_NAMES.has(name.trim().toLowerCase()) });
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

  return { liveCategories, liveChannels };
}
