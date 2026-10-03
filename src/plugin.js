import { guarded, clock, getDeps } from "./wiring.js";
import { signRequest } from "./liveSign.js";
import { makeMigrate } from "./migrate.js";
import { makeSettings } from "./settings.js";
import { makeRegistration } from "./registration.js";
import { isKinoError } from "./util.js";
import { trace, traced, errCode } from "./trace.js";


export async function search(query) { await null; return traced(kino, clock, "search", () => guarded(({ catalog }) => catalog.search(query))); }
export async function home() { await null; return traced(kino, clock, "home", () => guarded(({ catalog }) => catalog.home())); }
export async function browse(ref, cursor) { await null; return traced(kino, clock, "browse", () => guarded(({ catalog }) => catalog.browse(ref, cursor))); }
// apiVersion 6: Xuper's own section (one tab per root) and its Categorías tiles, over Home's trees.
export async function section(arg) { await null; return traced(kino, clock, "section", () => guarded(({ section: s }) => s.section(arg))); }
export async function categories() { await null; return traced(kino, clock, "categories", () => guarded(({ categories: c }) => c.categories())); }
export async function episodes(ref) { await null; return traced(kino, clock, "episodes", () => guarded(({ catalog }) => catalog.episodes(ref))); }
// `options` (the retry reason) drives a live channel's reopen; VOD ignores it.
export async function resolve(ref, options) { await null; return traced(kino, clock, "resolve", () => guarded(({ resolve: resolveRef }) => resolveRef.resolve(ref, options))); }
// Signing lane: pure, never builds the other deps (no storage, no network); a broken context is an `unavailable`.
export async function sign(request) {
  await null;
  try { return signRequest(request, clock.now()); }
  catch (e) {
    if (isKinoError(e)) throw e;
    trace(kino, "sign", "fail", { why: typeof e?.why === "string" ? e.why : errCode(e) });
    throw kino.error("unavailable", "No se pudo firmar la petición del canal");
  }
}
export async function liveCategories() { await null; return traced(kino, clock, "liveCategories", () => guarded(({ live }) => live.liveCategories())); }
export async function liveChannels(args) { await null; return traced(kino, clock, "liveChannels", () => guarded(({ live }) => live.liveChannels(args))); }
// Pure like sign: it never builds the other deps. An unreadable value is `null`; only a bug becomes `unavailable`.
const migrator = makeMigrate();
export async function migrate(input) {
  await null;
  try { return await migrator.migrate(input); }
  catch (e) {
    if (isKinoError(e)) throw e;
    trace(kino, "migrate", "fail", { code: errCode(e) });
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
  try { return await settings().settingsStatus(); }
  catch (e) { trace(kino, "settings", "status_fail", { code: errCode(e) }); return { status: "No se pudo consultar el estado" }; }
}
export async function action(key) {
  await null;
  try { return await traced(kino, clock, "action", () => settings().action(key)); }
  catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}
export async function validateSettings(values) {
  await null;
  try { return await traced(kino, clock, "validate", () => settings().validateSettings(values)); }
  catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}
