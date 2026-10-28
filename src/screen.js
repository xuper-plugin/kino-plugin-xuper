// The configuration screen (Kino apiVersion 14, offered through the manifest's `enhancements."14"`; the plugin keeps
// apiVersion 8 and an older Kino never calls these). `deps()` hands the very instances the old settings form uses.
import { snapshot } from "./screenModel.js";
import { view } from "./screenView.js";
import { makeEvents } from "./screenEvents.js";

/**
 * True when this Kino's screen kit has what the screen needs (secret fields, `steps`, press budgets, `onSaved`: they came
 * together, so `steps` stands for all of them). Without it the screen is Kino's own settings form, exactly the old one.
 */
export function modernKit(kino) {
  try { return !!(kino && kino.screen && Array.isArray(kino.screen.names) && kino.screen.names.includes("steps")); }
  catch (_) { return false; }
}

export function makeScreen({ kino, clock, deps }) {
  const screenEvent = makeEvents({ kino, clock, deps });

  /** The tree: a pure view of the state and of what is stored (no network). */
  async function screen(ctx) {
    const c = ctx && typeof ctx === "object" ? ctx : {};
    const modern = modernKit(kino);
    const s = modern ? snapshot({ kino, ...deps() }) : null;
    let appVersion = "";
    try { appVersion = typeof kino.appVersion === "string" ? kino.appVersion : ""; } catch (_) { appVersion = ""; }
    return view({
      s, state: c.state, route: c.route, modern, device: c.device === "tv" || c.device === "desktop" ? c.device : "phone",
      appVersion, lang: c.lang === "en" ? "en" : "es", now: clock.now(),
    });
  }

  return { screen, screenEvent };
}
