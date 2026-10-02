// src/plugin.js
async function search() {
  await null;
  return [];
}
async function home() {
  await null;
  return [];
}
async function browse() {
  await null;
  return { items: [] };
}
async function episodes() {
  await null;
  throw kino.error("not_found", "todav\xEDa no");
}
async function resolve() {
  await null;
  throw kino.error("unavailable", "todav\xEDa no");
}
async function settingsStatus() {
  await null;
  return { text: "todav\xEDa no" };
}
async function action() {
  await null;
  throw kino.error("unavailable", "todav\xEDa no");
}
export {
  action,
  browse,
  episodes,
  home,
  resolve,
  search,
  settingsStatus
};
