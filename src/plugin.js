// plugin.js — entry of the Xuper plugin. Kino injects `kino` as a global.
// Every export starts a call (`beginCall()`): the per-call single-flight table is cleared, so nothing is
// shared between two calls except what is stored (src/data.js, src/store.js). `callFor(<export>)` names the call:
// only Kino's resolve, liveCategories and liveChannels may ask the backend for a backup session (src/seeds.js).
// The first call of each runtime also clears what Xuper 2.x left in storage (src/upgrade.js).
// The own screen (screen/screenEvent) is the UI and the only place where identity runs; Kino's native detail,
// player and Home use the Bearer the screen stored.
import * as catalog from "./catalog.js";
import * as live from "./live.js";
import * as scr from "./screen.js";
import * as reauthNotice from "./reauthNotice.js";
import { beginCall, callFor } from "./flight.js";
import { afterHome } from "./seedContrib.js";
import { upgradeOnce } from "./upgrade.js";
import { kinoTooOld, updateKinoError, updateKinoView } from "./kinoGate.js";
import { currentBearer, notMemberActive } from "./api.js";

async function begin(name) { beginCall(); callFor(name); await upgradeOnce(); }

// Xuper only on the latest Kino (src/kinoGate.js): below the minimum every entry stops here — the screen is the
// "Actualiza Kino" page, Home and search are empty, a content call throws the same sentence.
const old = () => kinoTooOld();

// Own screen (catalog tabs, Fútbol, En vivo, Ajustes) + auth with kino.identity.
export async function screen(arg) { await begin("screen"); return old() ? updateKinoView() : scr.screen(arg); }
export async function screenEvent(ev) { await begin("screenEvent"); return old() ? { state: { kinoOld: true } } : scr.screenEvent(ev); }

// Kino Home rows from the stored catalog (public data, no Bearer). No catch: with no data at all it throws,
// so Kino keeps the rows it already painted instead of wiping them with [].
// After Home is served, maybe share one fresh anonymous seed (src/seedContrib.js: best-effort, never fails Home). Kino
// delivers the rows only once the call's fetches settle, so the mint is bounded by Home's own budget.
export async function home() {
  await begin("home");
  if (old()) return [];
  const startedAt = Date.now();
  const rows = await catalog.home();
  try { Promise.resolve(afterHome(startedAt)).catch(() => {}); } catch (_) { /* never fails Home */ }
  return rows;
}

// Kino's native search (stays dynamic): empty until Xuper is activated (it uses the Bearer).
export async function search(query) { await begin("search"); if (old()) return []; try { return await catalog.search(query); } catch (_) { return []; } }

// Native detail + player: Kino calls them with a card's ref; they reuse the stored Bearer. Xuper 2.x's library refs
// play and list too (src/legacy.js).
export async function episodes(ref) { await begin("episodes"); if (old()) throw updateKinoError(); return catalog.episodes(ref); }
// A movie's ids for Kino's title page (apiVersion 8; no capability — Kino calls it only for a movie ref when exported).
export async function details(ref) { await begin("details"); if (old()) throw updateKinoError(); return catalog.details(ref); }
export async function resolve(ref, options) { await begin("resolve"); if (old()) throw updateKinoError(); return catalog.resolve(ref, options); }

// Kino's play ahead (app: PlayAhead, 2026-11-18): a background call while the person rests on a title page, with the ref
// `resolve` would get. It readies the trial session and this device's CDN authorization on the backend, never a resolve
// (src/catalog.js prepare). Kino ignores its answer; it never throws.
export async function prepare(ref) { await begin("prepare"); if (old()) return null; return catalog.prepare(ref); }

// "Ver más" (capability "browse"). No catch: a throw keeps Kino's cached page; an empty page would replace it.
export async function browse(ref, cursor) { await begin("browse"); if (old()) throw updateKinoError(); return catalog.browse(ref, cursor); }

// Kino's Categorías: a tile per section of the stored catalog, each opening its "Ver más" through browse.
export async function categories() { await begin("categories"); if (old()) return []; return catalog.categories(); }

// Capability "migrate": a value Kino saved while Xuper was native, in this plugin's terms (src/legacy.js). Pure.
export async function migrate(input) { await begin("migrate"); return catalog.migrate(input); }

// Live TV (capability "channels", src/live.js): categories from code and the stored registry (0 requests once
// stored; the first ever is bounded at 12 s), channels from the stored lists in pages of 500.
export async function liveCategories() { await begin("liveCategories"); if (old()) return []; return live.liveCategories(); }
export async function liveChannels(arg) { await begin("liveChannels"); if (old()) throw updateKinoError(); return live.liveChannels(arg); }


// Scheduled job (capability "schedule", manifest `jobs`): the only background work. It keeps the Home-bell
// "Reautentícate" reminder in step with the stored flag, so a stuck access reaches the person WITHOUT opening Xuper. A
// job cannot call kino.identity and never mints here: it only posts or clears the notice (its answer is never read).
export async function job() { beginCall(); return reauthNotice.syncReauthNotice(); }

// Kino 0.9.93+ only (the manifest's enhancements["31"].setup, route "main"; an older Kino never reads it, so 3.1.12's choice
// stands there: no Kino setup step). Xuper is set up once it has a session and is still in the Kino group; until then Kino
// (and Da-Video) offer Configurar, which opens Xuper's own first screen: Ingresar, or the Valida tu Telegram gate.
export async function setupStatus() { beginCall(); return { ready: !!(await currentBearer()) && !notMemberActive() }; }
// Nothing for Kino to run: the sign-in happens on Xuper's own screen. Kino asks setupStatus again right after.
export async function setupRun() { beginCall(); return { done: true }; }
