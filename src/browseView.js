// The browse screen's tree (route "categories"): a pure view of what browse.js holds. A tab that is not in yet draws
// skeletons shaped like what will replace them, so nothing jumps when the rows arrive. Every text is in both languages.
import { twin } from "./i18n.js";
import { TAB_IDS } from "./browseModel.js";

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
  type: "heroCard", key: "slide-" + s.id, title: s.title, text: s.text, image: s.image,
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

const rail = (r, key, titleOverride) => ({
  type: "titleRail", key, ...(titleOverride || { title: r.title }), ...(r.ref ? { ref: r.ref } : {}), items: r.items, size: "medium",
});

/**
 * `data`: `{ slides, rails }` of the active tab, or null while it is not in. `recent`: the cards of the played titles.
 * `pending`: some tab is still being fetched (the timer polls only then). `failed`: the active tab could not load.
 */
export function browseView({ tab, data, recent, pending, failed }) {
  const active = TAB_IDS.includes(tab) ? tab : TAB_IDS[0];
  const body = [];
  if (data) {
    if (data.slides.length > 0) body.push(hero(data.slides));
    if (recent.length > 0) body.push(rail({ items: recent }, "recent", twin("brRecent", "title")));
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
      title: { type: "TabBar", key: "tabs", value: active, onChanged: "tab", tabs: TAB_IDS.map((id) => ({ value: id, ...twin(TAB_KEYS[id], "label") })) },
      actions: [
        { type: "IconButton", key: "settings", icon: "settings", ...twin("brSettings", "labelText"), ...twin("brSettings", "tooltip"), onPressed: { event: "go", arg: "settings" } },
      ],
    },
    body: { type: "SingleChildScrollView", key: "browse-" + active, children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...(pending ? { every: { ms: POLL_MS, event: "tick" } } : {}),
  };
}
