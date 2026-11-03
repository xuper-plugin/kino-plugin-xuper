// The browse screen's tree (route "categories"): a pure view of what browse.js holds. A tab that is not in yet draws
// skeletons shaped like what will replace them, so nothing jumps when the rows arrive. Every text is in both languages.
import { twin } from "./i18n.js";
import { TAB_IDS } from "./browseModel.js";
import { LOGO_DATA, LOGO_ASPECT } from "./logo.js";

const TAB_KEYS = { peliculas: "brTabPeliculas", series: "brTabSeries", infantil: "brTabInfantil", anime: "brTabAnime" };
const POLL_MS = 1_500;

/** The skeleton of one rail: a heading bar and a row of poster cards (three on a phone, six on a wide window). */
const railSkeleton = (n) => ({
  type: "Column", key: "skel" + n, gap: 8, children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, sizes: ["compact"], children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}c${i}`, flex: 1 })) },
    { type: "Row", gap: 12, sizes: ["medium", "expanded"], children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}w${i}`, flex: 1 })) },
  ],
});

const heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });

const slideNode = (s) => ({
  type: "heroCard", key: "slide-" + s.id, h: { compact: 200, expanded: 240 }, ...(s.logo ? { logo: s.logo } : {}), title: s.title, text: s.text, image: s.image,
  buttons: [
    { type: "ElevatedButton", key: "watch-" + s.id, ...twin("brWatch", "labelText"), icon: "play",
      onPressed: { go: { play: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } } },
    { type: "TextButton", key: "info-" + s.id, ...twin("brInfo", "labelText"),
      onPressed: { go: { title: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } } },
  ],
});

const hero = (slides) => (slides.length === 1 ? slideNode(slides[0]) : {
  type: "PageView", key: "hero", autoPlayMs: 6_000, children: slides.map(slideNode),
});

export const logo = () => ({
  type: "Image", key: "logo", url: LOGO_DATA, aspect: LOGO_ASPECT, fit: "contain", h: 40, alt: "Xuper", altEn: "Xuper",
  fallback: { type: "Text", text: "Xuper", textEn: "Xuper", style: "h4" },
});
const tabBar = (active) => ({ type: "TabBar", key: "tabs", divider: false, value: active, onChanged: "tab", tabs: TAB_IDS.map((id) => ({ value: id, ...twin(TAB_KEYS[id], "label") })) });

/** A live channel as a round tile (the TV's way, as Kino's own En vivo): its logo in a circle and its name under it; a tap tunes it. */
const roundChannel = (c, n) => ({
  type: "Column", key: "ch-" + n, w: 120, gap: 8, crossAxisAlignment: "center", onTap: { go: { play: { ref: c.ref, kind: "live", id: c.id, title: c.title } } },
  children: [
    { type: "CircleAvatar", key: "chl-" + n, radius: 44, ...(c.poster ? { image: c.poster } : { text: String(c.title).slice(0, 2).toUpperCase() }), labelText: c.title, labelTextEn: c.title },
    { type: "Text", text: c.title, textEn: c.title, style: "caption", maxLines: 1, textAlign: "center" },
  ],
});

/** The live row as a sideways row of round tiles (a TV). */
const roundRail = (items, titleOverride) => ({
  type: "Column", key: "live", gap: 8, children: [
    { type: "Text", ...titleOverride, style: "h4" },
    { type: "SingleChildScrollView", key: "liveScroll", direction: "horizontal", children: [{ type: "Row", gap: 24, children: items.slice(0, 20).map(roundChannel) }] },
  ],
});

const rail = (r, key, titleOverride) => ({
  type: "titleRail", key, ...(titleOverride || { title: r.title }), ...(r.ref ? { ref: r.ref } : {}), items: r.items, size: "medium",
});

const SEARCH_CAP = 60;

/** The skeleton of a results grid: two rows of poster cards (three across on a phone, six on a wide window). */
const gridSkeleton = () => ({
  type: "Column", key: "gridSkeleton", gap: 12, children: [
    ...[1, 2].map((r) => ({ type: "Row", gap: 12, sizes: ["compact"], key: `gc${r}`, children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `gc${r}-${i}`, flex: 1 })) })),
    ...[1, 2].map((r) => ({ type: "Row", gap: 12, sizes: ["medium", "expanded"], key: `gw${r}`, children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `gw${r}-${i}`, flex: 1 })) })),
  ],
});

/**
 * The in-plugin search page (route "search"): the box with the words, then skeletons while the portal answers, then the results
 * as Kino's grid. `status`: "loading", "done" or "fail"; `items`: the cards (null until in).
 */
export function searchView({ query, status, items, history = [], device = "phone" }) {
  const tv = device === "tv";
  // On a TV the box and its button live in the bar (field on the left, button on the right) and the bar carries no title: the
  // screen is known by what it does. Elsewhere the box sits at the top of the page under a "Buscar" title.
  const searchForm = () => ({
    type: "Form", key: "searchForm", onSubmitted: "search", gap: 8, children: tv
      ? [{ type: "Row", key: "searchRow", gap: 16, crossAxisAlignment: "center", children: [
        { type: "TextField", key: "q", kind: "text", value: query, ...twin("brSearchHint", "labelText"), maxLength: 100, autofocus: true, weight: 1 },
        { type: "ElevatedButton", key: "searchGo", ...twin("brSearch", "labelText"), icon: "search", submit: true },
      ] }]
      : [
        { type: "TextField", key: "q", kind: "text", value: query, ...twin("brSearchHint", "labelText"), maxLength: 100, autofocus: true },
        { type: "ElevatedButton", key: "searchGo", ...twin("brSearch", "labelText"), icon: "search", submit: true },
      ],
  });
  const body = tv ? [] : [searchForm()];
  if (status === "fail") {
    body.push({ type: "MaterialBanner", key: "searchFailed", role: "error", ...twin("brSearchFailed"), action: { ...twin("brRetry", "label"), onTap: "sretry" } });
  } else if (status === "done" && items) {
    if (items.length === 0) body.push({ type: "Text", ...twin("brNoResults", "text"), color: "muted" });
    else body.push({ type: "titleGrid", key: "results", columns: { compact: 3, expanded: 6 }, items: items.slice(0, SEARCH_CAP) });
  } else if (status !== "idle") {
    body.push(gridSkeleton());
  } else if (history.length > 0) {
    // Nothing typed yet: what was found before, painted at once; a real search replaces it.
    body.push({ type: "Text", ...twin("brSearchedBefore", "text"), style: "h4" });
    body.push({ type: "titleGrid", key: "history", columns: { compact: 3, expanded: 6 }, items: history.slice(0, SEARCH_CAP) });
  }
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false,
      leading: { type: "IconButton", key: "back", icon: "arrow_back", ...twin("brBack", "labelText"), ...twin("brBack", "tooltip"), onPressed: "back" },
      ...(tv ? { title: searchForm() } : twin("brSearchTitle", "title")),
    },
    body: { type: "SingleChildScrollView", key: "search-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...(status === "loading" ? { every: { ms: 1_000, event: "stick" } } : {}),
  };
}

/**
 * The live page (route "live"): Xuper's live channels by genre, a tab per genre (Kino's own live tiles), the channels of the
 * picked one as Kino's grid; a tap tunes the player. `tiles`: null until known; `items`: the picked genre's channels, null until in.
 */
export function liveView({ tiles, cat, items, query = "", searching = false, device = "phone" }) {
  // The live search sits on top; its words replace the genre's channels until they are cleared.
  const tv = device === "tv";
  // On a TV the box and its button live in the bar (field left, button right), with no title; elsewhere on top of the page.
  const liveForm = () => ({
    type: "Form", key: "liveSearch", onSubmitted: "lsearch", gap: 8, children: tv
      ? [{ type: "Row", key: "liveSearchRow", gap: 16, crossAxisAlignment: "center", children: [
        { type: "TextField", key: "lq", kind: "text", value: query, ...twin("brLiveSearchHint", "labelText"), maxLength: 100, weight: 1 },
        { type: "ElevatedButton", key: "lsearchGo", ...twin("brSearch", "labelText"), icon: "search", submit: true },
      ] }]
      : [
        { type: "TextField", key: "lq", kind: "text", value: query, ...twin("brLiveSearchHint", "labelText"), maxLength: 100 },
        { type: "ElevatedButton", key: "lsearchGo", ...twin("brSearch", "labelText"), icon: "search", submit: true },
      ],
  });
  const body = tv ? [] : [liveForm()];
  if (tiles && tiles.length === 0) body.push({ type: "Text", ...twin("brLiveEmpty", "text"), color: "muted" });
  else if (items && items.length === 0) body.push({ type: "Text", ...twin("brLiveEmpty", "text"), color: "muted" });
  else if (items && device === "tv") body.push({ type: "Row", key: "channels", wrap: true, gap: 24, children: items.slice(0, 40).map(roundChannel) });
  else if (items) body.push({ type: "titleGrid", key: "channels", columns: { compact: 3, expanded: 6 }, items: items.slice(0, SEARCH_CAP) });
  else body.push(gridSkeleton());
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false,
      leading: { type: "IconButton", key: "back", icon: "arrow_back", ...twin("brBack", "labelText"), ...twin("brBack", "tooltip"), onPressed: "back" },
      ...(tv ? { title: liveForm() } : twin("brLive", "title")),
    },
    body: { type: "Column", key: "livePage", children: [
      ...(tiles && tiles.length > 1 && query === "" ? [{ type: "TabBar", key: "genres", divider: false, value: cat, onChanged: "lcat", tabs: tiles.map((t) => ({ value: t.ref, label: t.title, labelEn: t.title })) }] : []),
      { type: "SingleChildScrollView", key: "live-" + String(cat).replace(/[^A-Za-z0-9_-]/g, "_"), flex: 1, children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ] },
    ...(searching || (query === "" && (!tiles || !items)) ? { every: { ms: 1_000, event: "ltick" } } : {}),
  };
}

/**
 * `data`: `{ slides, rails }` of the active tab, or null while it is not in. `recent`: the cards of the played titles.
 * `pending`: some tab is still being fetched (the timer polls only then). `failed`: the active tab could not load.
 */
export function browseView({ tab, data, recent, live = [], pending, failed, device = "phone" }) {
  const tv = device === "tv";
  const active = TAB_IDS.includes(tab) ? tab : TAB_IDS[0];
  const body = [];
  if (data) {
    if (data.slides.length > 0) body.push(hero(data.slides));
    if (recent.length > 0) body.push(rail({ items: recent }, "recent", twin("brRecent", "title")));
    if (live.length > 0) body.push(tv ? roundRail(live, twin("brLive", "text")) : rail({ items: live }, "live", twin("brLive", "title")));
    for (const r of data.rails) body.push(rail(r, "rail-" + r.id));
    if (data.rails.length === 0) body.push({ type: "Text", ...twin("brEmpty", "text"), color: "muted" });
  } else if (failed) {
    body.push({ type: "MaterialBanner", key: "loadFailed", role: "error", ...twin("brFailed"),
      action: { ...twin("brRetry", "label"), onTap: "retry" } });
  } else {
    body.push(heroSkeleton(), railSkeleton(1), railSkeleton(2), railSkeleton(3));
  }
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      divider: false,
      // One bar instead of two (Kino 0.9.81+; an older Kino draws its own bar above and this one under it, as before):
      // the close button where Kino's was, the name where the plugin's was, search and settings at the end.
      mergeWithKinoBar: true,
      dense: true,
      leading: { type: "IconButton", key: "close", icon: "close", ...twin("brClose", "labelText"), ...twin("brClose", "tooltip"), onPressed: { go: { close: true } } },
      // The plugin's logo where its name was; the name itself when the logo cannot be drawn (an older Kino, a refused picture).
      title: tv
        // On a TV the tabs sit in the bar beside the logo (one row, one D-pad strip); elsewhere they are pinned under it.
        ? { type: "Row", key: "titleRow", gap: 24, crossAxisAlignment: "center", children: [logo(), tabBar(active)] }
        : logo(),
      actions: [
        // On a TV the search is a button of the bar (a floating one is hard to reach with a remote); elsewhere it floats.
        ...(tv ? [{ type: "IconButton", key: "searchButton", icon: "search", ...twin("brSearch", "labelText"), ...twin("brSearch", "tooltip"), onPressed: "openSearch" }] : []),
        { type: "IconButton", key: "liveButton", icon: "tv", ...twin("brLive", "labelText"), ...twin("brLive", "tooltip"), onPressed: { event: "go", arg: "live" } },
        { type: "IconButton", key: "settings", icon: "settings", ...twin("brSettings", "labelText"), ...twin("brSettings", "tooltip"), onPressed: { event: "go", arg: "settings" } },
      ],
    },
    // The tabs stay pinned under the bar; only the rows scroll.
    ...(tv ? {} : { floatingActionButton: { type: "FloatingActionButton", key: "searchFab", icon: "search", ...twin("brSearch", "tooltip"), onPressed: "openSearch" } }),
    body: { type: "Column", key: "page", children: [
      // The tabs line up with the bar's buttons and the cards below (a wide window and the TV pad their content by 24).
      ...(tv ? [] : [{ type: "Column", key: "tabsRow", padding: { compact: 0, expanded: 24 }, children: [tabBar(active)] }]),
      { type: "SingleChildScrollView", key: "browse-" + active, flex: 1, children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ] },
    ...(pending ? { every: { ms: POLL_MS, event: "tick" } } : {}),
  };
}
