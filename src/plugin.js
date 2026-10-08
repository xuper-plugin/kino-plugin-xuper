import { guarded, clock, getDeps } from "./wiring.js";
import { signRequest } from "./liveSign.js";
import { makeMigrate } from "./migrate.js";
import { makeSettings } from "./settings.js";
import { makeRegistration } from "./registration.js";
import { isKinoError } from "./util.js";
import { isChannelRef } from "./refs.js";
import { isLiveTileRef } from "./liveTiles.js";
import { trace, traced, report, errCode } from "./trace.js";

// How the call that just ended was served (`served=fresh|cache|partial`, `got`, `fail`: counts only), for its lines;
// read (and forgotten) at the end of every call that may read the kept rows or a chapter list.
const servedBy = () => getDeps().catalog.servedBy();

// With `within` (Kino's scopedSearch, apiVersion 6) it searches inside one "Ver más" page; its lines say so, never the query.
export async function search(query) {
  await null;
  let scoped = false;
  // An argument that throws on first touch fails inside guarded (the Spanish unavailable), never here.
  try { scoped = query !== null && typeof query === "object" && query.within !== undefined && query.within !== null; } catch (_) { scoped = false; }
  return traced(kino, clock, "search", () => guarded(({ catalog }) => catalog.search(query)), scoped ? { scope: "within" } : {}, servedBy);
}
export async function home() {
  await null;
  const out = await traced(kino, clock, "home", () => guarded(({ catalog }) => catalog.home()), {}, servedBy);
  // After Home is served, maybe share one fresh anonymous seed (detached, best-effort, never blocks Home).
  try { Promise.resolve(getDeps().seedContrib.maybeContribute()).catch(() => {}); } catch (_) { /* never fails Home */ }
  return out;
}
// A Categorías live tile's ref (liveTiles.js) pages channels; every other ref is a VOD row.
export async function browse(ref, cursor) {
  await null;
  const live = isLiveTileRef(ref);
  return traced(kino, clock, "browse", () => guarded(({ catalog, liveTiles }) => (live ? liveTiles.browse(ref, cursor) : catalog.browse(ref, cursor))),
    live ? { kind: "live" } : {}, servedBy);
}
// apiVersion 6: Xuper's own section (one tab per root) and its Categorías tiles, over Home's trees.
export async function section(arg) { await null; return traced(kino, clock, "section", () => guarded(({ section: s }) => s.section(arg)), {}, servedBy); }
export async function categories() { await null; return traced(kino, clock, "categories", () => guarded(({ categories: c }) => c.categories()), {}, servedBy); }
export async function episodes(ref) { await null; return traced(kino, clock, "episodes", () => guarded(({ catalog }) => catalog.episodes(ref)), {}, servedBy); }
// `options` (the retry reason) drives a live channel's reopen; VOD ignores it.
export async function resolve(ref, options) {
  await null;
  return traced(kino, clock, "resolve", () => guarded(({ resolve: resolveRef }) => resolveRef.resolve(ref, options)), { kind: isChannelRef(ref) ? "live" : "vod" }, servedBy);
}
// Signing lane: pure, never builds the other deps (no storage, no network); a broken context is an `unavailable`.
// A sign that works writes NO kino.log line: in a fresh lane runtime Kino redacts a log line by opening every
// sealed secret first (one X25519 each, the native credential checks with it), which measured ~2.3 s on a
// Fire TV Stick -- past the 1.5 s sign budget, so a first sign timed out, the lane was discarded, the next
// runtime's first sign timed out too, and three in a row ended the channel with a 502 (Kino 0.9.50 + 2.2.9).
// Kino's own sign figures (count, p50/p95, timeouts) already travel with every live playback report.
export async function sign(request) {
  await null;
  try {
    return signRequest(request, clock.now());
  } catch (e) {
    if (isKinoError(e)) throw e;
    // An edge case for the board (verbose level): the context the app handed over cannot sign.
    report(kino, "sign", "fail", { why: typeof e?.why === "string" ? e.why : errCode(e) });
    throw kino.error("unavailable", "No se pudo firmar la petición del canal");
  }
}
export async function liveCategories() { await null; return traced(kino, clock, "liveCategories", () => guarded(({ live }) => live.liveCategories())); }
export async function liveChannels(args) { await null; return traced(kino, clock, "liveChannels", () => guarded(({ live }) => live.liveChannels(args))); }
// En vivo's search (optional with "channels"): over the whole list, swept once an hour into memory; never the query in a line.
export async function liveSearch(args) { await null; return traced(kino, clock, "liveSearch", () => guarded(({ live }) => live.liveSearch(args))); }
// Pure like sign: it never builds the other deps. An unreadable value is `null`; only a bug becomes `unavailable`.
const migrator = makeMigrate();
export async function migrate(input) {
  await null;
  try { return await traced(kino, clock, "migrate", () => migrator.migrate(input), { kind: input && typeof input.kind === "string" ? input.kind : "?" }); }
  catch (e) {
    if (isKinoError(e)) throw e;
    report(kino, "migrate", "fail", { code: errCode(e) });
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}

// The settings form runs even with no account saved: it needs the session, never the catalog.
let settingsInstance = null;
const settings = () => (settingsInstance ??= (() => {
  const { session, portal } = getDeps();
  return makeSettings({ kino, session, clock, registration: makeRegistration({ kino, portal, session, clock }) });
})());
export async function settingsStatus() {
  await null;
  try { return await traced(kino, clock, "settingsStatus", () => settings().settingsStatus()); }
  catch (e) { trace(kino, "settings", "status_fail", { code: errCode(e) }); return { status: "No se pudo consultar el estado" }; }
}
export async function action(key) {
  await null;
  try { return await traced(kino, clock, "action", () => settings().action(key), { key: typeof key === "string" ? key : "?" }); }
  catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}
export async function validateSettings(values) {
  await null;
  try { return await traced(kino, clock, "validateSettings", () => settings().validateSettings(values)); }
  catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}
