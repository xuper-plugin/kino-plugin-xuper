import { guarded } from "./wiring.js";

export async function search(query) { await null; return guarded(({ catalog }) => catalog.search(query)); }
export async function home() { await null; return guarded(({ catalog }) => catalog.home()); }
export async function browse(ref, cursor) { await null; return guarded(({ catalog }) => catalog.browse(ref, cursor)); }
export async function episodes(ref) { await null; return guarded(({ catalog }) => catalog.episodes(ref)); }
// `options` (the retry reason) is not used for VOD yet.
export async function resolve(ref, options) { await null; return guarded(({ resolve: resolveRef }) => resolveRef.resolve(ref, options)); }
export async function settingsStatus() { await null; return { text: "todavía no" }; }
export async function action() { await null; throw kino.error("unavailable", "todavía no"); }
