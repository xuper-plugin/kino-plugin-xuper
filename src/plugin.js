export async function search() { await null; return []; }
export async function home() { await null; return []; }
export async function browse() { await null; return { items: [] }; }
export async function episodes() { await null; throw kino.error("not_found", "todavía no"); }
export async function resolve() { await null; throw kino.error("unavailable", "todavía no"); }
export async function settingsStatus() { await null; return { text: "todavía no" }; }
export async function action() { await null; throw kino.error("unavailable", "todavía no"); }
