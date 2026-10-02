import { guarded } from "./wiring.js";

export async function search(query) { await null; return guarded(({ catalog }) => catalog.search(query)); }
export async function home() { await null; return guarded(({ catalog }) => catalog.home()); }
export async function browse(ref, cursor) { await null; return guarded(({ catalog }) => catalog.browse(ref, cursor)); }
export async function episodes() { await null; throw kino.error("not_found", "todavía no"); }
export async function resolve() { await null; throw kino.error("unavailable", "todavía no"); }
export async function settingsStatus() { await null; return { text: "todavía no" }; }
export async function action() { await null; throw kino.error("unavailable", "todavía no"); }
