import { guarded, clock, getDeps } from "./wiring.js";
import { signRequest } from "./liveSign.js";
import { makeMigrate } from "./migrate.js";
import { makeSettings } from "./settings.js";

const isKinoError = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");

export async function search(query) { await null; return guarded(({ catalog }) => catalog.search(query)); }
export async function home() { await null; return guarded(({ catalog }) => catalog.home()); }
export async function browse(ref, cursor) { await null; return guarded(({ catalog }) => catalog.browse(ref, cursor)); }
export async function episodes(ref) { await null; return guarded(({ catalog }) => catalog.episodes(ref)); }
// `options` (the retry reason) drives a live channel's reopen; VOD ignores it.
export async function resolve(ref, options) { await null; return guarded(({ resolve: resolveRef }) => resolveRef.resolve(ref, options)); }
// Signing lane: pure, never builds the other deps (no storage, no network); a broken context is an `unavailable`.
export async function sign(request) {
  await null;
  try { return signRequest(request, clock.now()); }
  catch (e) {
    if (e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_")) throw e;
    try { kino.log("xuper sign: " + String((e && e.name) || "error")); } catch (_) {}
    throw kino.error("unavailable", "No se pudo firmar la petición del canal");
  }
}
export async function liveCategories() { await null; return guarded(({ live }) => live.liveCategories()); }
export async function liveChannels(args) { await null; return guarded(({ live }) => live.liveChannels(args)); }
// Pure like sign: it never builds the other deps. An unreadable value is `null`; only a bug becomes `unavailable`.
const migrator = makeMigrate();
export async function migrate(input) {
  await null;
  try { return await migrator.migrate(input); }
  catch (e) {
    if (isKinoError(e)) throw e;
    try { kino.log("xuper migrate: " + String((e && e.name) || "error")); } catch (_) {}
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}

// The settings form runs even with no account saved: it needs the session, never the catalog.
let settingsInstance = null;
const settings = () => (settingsInstance ??= makeSettings({ kino, session: getDeps().session, clock }));
export async function settingsStatus() {
  await null;
  try { return await settings().settingsStatus(); } catch (_) { return { status: "No se pudo consultar el estado" }; }
}
export async function action(key) {
  await null;
  try { return await settings().action(key); }
  catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}
export async function validateSettings(values) {
  await null;
  try { return await settings().validateSettings(values); }
  catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}
