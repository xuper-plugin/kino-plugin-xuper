// Live tiles in Kino's Categorías (apiVersion 6 `categories()` + `browse`): one tile per genre among Xuper's
// live categories, so "Deportes en vivo" sits next to the VOD tiles. A tile's `browse` lists that genre's
// channels as `kind: "live"` items whose `ref` is the same bare channel code En vivo hands out, so a tap
// plays through `resolve` exactly as a channel from En vivo or the Home country row does.
//
// Which categories: only those whose whole name IS a genre (liveCatalog's genreOfCategory, the same `genre`
// En vivo's filter gets: "Deportes", "Noticias", "Kids"…), plus "Cine y Series" by its exact name (a tile-only
// genre, `cineyseries`: tileGenreOfCategory). Countries (about twenty) and "Todos" (a thousand channels) are left to En vivo,
// whose country filter and search serve them better than twenty more tiles would; an 18+ category is never
// a tile (the VOD 18+ tile stays the one adult entry). Several categories of one genre share its tile.
//
// Cost: listing the tiles reads the genre categories liveCatalog keeps in storage (written whenever En vivo,
// the country row or a previous Categorías read it), so opening Categorías asks the portal nothing then;
// with nothing kept it asks once, bounded, and a failure only drops the live tiles.
//
// Pictures: a tile's `art` is a channel logo of its genre that liveCatalog noted from a channel page fetched
// anyway (En vivo, this tile's grid). Listing the tiles never fetches channels for it: no logo kept, no art.
import { callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { say } from "./i18n.js";
import { trace, errCode } from "./trace.js";

export const LIVE_TILE_PREFIX = "xlive:";
/** Tiles at most: the order below is also the priority when a portal has more genres than this. */
export const MAX_LIVE_TILES = 6;
const GENRE_ORDER = ["deportes", "noticias", "infantil", "cineyseries", "peliculas", "series", "entretenimiento", "musica", "documentales", "anime"];
// Each genre's tile title (i18n.js keys).
const TITLE_KEY = {
  deportes: "liveTileSports", noticias: "liveTileNews", infantil: "liveTileKids", peliculas: "liveTileMovies",
  cineyseries: "liveTileMoviesSeries", series: "liveTileSeries", entretenimiento: "liveTileEntertainment", musica: "liveTileMusic",
  documentales: "liveTileDocumentaries", anime: "liveTileAnime",
};
// With nothing kept, the tiles' one categories read stops this soon (the VOD tiles run beside it).
export const LIVE_TILES_COLD_MS = 8_000;
const PAGE_SIZE = 100; // the contract's browse page cap
const MAX_PAGES = 20; // 2,000 channels a category, as far as a grid is scrolled

export const isLiveTileRef = (ref) => typeof ref === "string" && ref.startsWith(LIVE_TILE_PREFIX);

/** The categories behind each genre, in GENRE_ORDER, from liveCatalog's `{ id, genre }` list. */
export function genresOf(categories) {
  const by = new Map();
  for (const { id, genre } of categories) {
    if (!Object.hasOwn(TITLE_KEY, genre)) continue;
    if (!by.has(genre)) by.set(genre, []);
    if (!by.get(genre).includes(id)) by.get(genre).push(id);
  }
  return GENRE_ORDER.filter((g) => by.has(g)).map((genre) => ({ genre, ids: by.get(genre) }));
}

/** `live`: liveCatalog (genreCategories, channelsPage, surface). */
export function makeLiveTiles({ kino, live, clock }) {
  /** The live tiles (never throws: a failure is no live tiles, the VOD tiles still show). */
  async function tiles() {
    try {
      const deadline = Math.min(clock.now() + LIVE_TILES_COLD_MS, callDeadline(clock, CALL_BUDGET_MS.categories));
      const genres = genresOf(await live.genreCategories(deadline)).slice(0, MAX_LIVE_TILES);
      const logos = live.genreLogos();
      return genres.map(({ genre }) => {
        const tile = { id: `xlive-${genre}`, title: say(kino, TITLE_KEY[genre]).slice(0, 40), ref: LIVE_TILE_PREFIX + genre };
        if (Object.hasOwn(logos, genre)) tile.art = logos[genre];
        return tile;
      });
    } catch (e) {
      trace(kino, "categories", "live_tiles_fail", { code: errCode(e) });
      return [];
    }
  }

  const notFound = () => kino.error("not_found", "No se encontró esa categoría");

  // Cursor "<category index>.<page>": the genre's categories one after another, each paged by the portal.
  function cursorOf(cursor) {
    const m = typeof cursor === "string" ? /^(\d{1,2})\.(\d{1,3})$/.exec(cursor) : null;
    return m ? { at: Number(m[1]), page: Math.max(1, Number(m[2])) } : { at: 0, page: 1 };
  }

  async function browse(ref, cursor) {
    const genre = ref.slice(LIVE_TILE_PREFIX.length);
    const deadline = callDeadline(clock, CALL_BUDGET_MS.browse);
    let ids;
    try { ids = genresOf(await live.genreCategories(deadline)).find((g) => g.genre === genre)?.ids; }
    catch (e) { throw live.surface(e); }
    if (!ids) throw notFound();
    let { at, page } = cursorOf(cursor);
    const first = cursor === null || cursor === undefined;
    // An empty last page of one category moves on to the next one inside the same call.
    while (at < ids.length && page <= MAX_PAGES) {
      let got;
      try {
        got = await live.channelsPage(ids[at], page, PAGE_SIZE, deadline);
      } catch (e) {
        if (first && at === 0 && page === 1) throw live.surface(e);
        // The grid ends here, but a truncated list is never silent.
        trace(kino, "live", "tile_page_fail", { genre, page, code: errCode(e) });
        return { items: [] };
      }
      const next = got.full && page < MAX_PAGES ? `${at}.${page + 1}` : at + 1 < ids.length ? `${at + 1}.1` : null;
      const items = got.items.map((c) => {
        const item = { kind: "live", id: c.id, title: c.title, ref: c.ref };
        if (c.logo) item.poster = c.logo;
        return item;
      });
      if (items.length > 0 || next === null) return next ? { items, next } : { items };
      ({ at, page } = cursorOf(next));
    }
    return { items: [] };
  }

  return { tiles, browse };
}
