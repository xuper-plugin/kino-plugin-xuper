// The configuration screen (Kino apiVersion 14, offered through the manifest's `enhancements."14"`; the plugin keeps
// apiVersion 8 and an older Kino never calls these). `deps()` hands the very instances the old settings form uses.
import { snapshot } from "./screenModel.js";
import { view } from "./screenView.js";
import { makeEvents } from "./screenEvents.js";
import { makeBrowse } from "./browse.js";

/** The routes of the browse screen: what the menu entry opens (`main`) and Kino's Categorías route. Every other route (`settings`, `signin`, `register`) is the configuration. */
export const BROWSE_ROUTES = ["main", "categories", "search", "live"];

/**
 * True when this Kino's screen kit has what the screen needs (secret fields, `steps`, press budgets, `onSaved`: they came
 * together, so `steps` stands for all of them). Without it the screen is Kino's own settings form, exactly the old one.
 */
export function modernKit(kino) {
  try { return !!(kino && kino.screen && Array.isArray(kino.screen.names) && kino.screen.names.includes("steps")); }
  catch (_) { return false; }
}

export function makeScreen({ kino, clock, deps }) {
  const settingsEvent = makeEvents({ kino, clock, deps });
  let browse = null;
  const getBrowse = () => (browse ??= makeBrowse({ kino, clock, catalog: deps().catalog, liveTiles: deps().liveTiles, countryRow: deps().countryRow, live: deps().live, recent: deps().recent }));
  const isBrowse = (x) => x && x.route && BROWSE_ROUTES.includes(x.route.name);

  /** The tree: a pure view of the state and of what is stored (no network). */
  async function screen(ctx) {
    const c = ctx && typeof ctx === "object" ? ctx : {};
    if (isBrowse(c)) return getBrowse().view(c);
    const modern = modernKit(kino);
    const s = modern ? snapshot({ kino, ...deps() }) : null;
    let appVersion = "";
    try { appVersion = typeof kino.appVersion === "string" ? kino.appVersion : ""; } catch (_) { appVersion = ""; }
    return view({
      s, state: c.state, route: c.route, modern, device: c.device === "tv" || c.device === "desktop" ? c.device : "phone",
      appVersion, lang: c.lang === "en" ? "en" : "es", now: clock.now(),
    });
  }

  /** The browse screen's events go to it; the settings screen's to the settings events. A bug in the browse is a generic toast. */
  async function screenEvent(ev) {
    if (!isBrowse(ev)) return settingsEvent(ev);
    try { return await getBrowse().event(ev); }
    catch (_) { return null; }
  }

  return { screen, screenEvent };
}
