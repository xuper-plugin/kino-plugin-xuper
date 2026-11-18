// src/sources/sports.js — detección de categorías DEPORTIVAS por nombre (compartido: supertv + el agregador).
// Normaliza (minúsculas, sin acentos) y matchea contra palabras clave de alta precisión (genéricas es/en +
// marcas de canales + ligas). Se usa para (1) filtrar SuperTV a solo deportes y (2) armar el tab "Canales"
// de la pantalla Deportes con las categorías deportivas de las fuentes mixtas.

export const SPORTS_KW = [
  "deporte", "deportiv", "sport", "futbol", "football", "soccer", "espn", "fox sport", "fox deportes",
  "dazn", "bein", "tnt sport", "sky sport", "directv sport", "win sport", "tudn", "goltv", "gol tv",
  "formula", "moto gp", "motogp", "nascar", "nba", "nfl", "nhl", "mlb", "mls", "ufc", "wwe", "aew",
  "boxeo", "boxing", "tennis", "tenis", "golf", "cricket", "rugby", "champions", "laliga", "la liga",
  "premier league", "serie a", "bundesliga", "ligue 1", "eurosport", "dsports", "d sport", "libertadores",
  "sudamericana", "olimpic", "olympic", "wimbledon", "pga", "handball", "voley", "volley", "hockey",
];

export function normCat(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function isSports(name) {
  const n = normCat(name);
  for (const kw of SPORTS_KW) if (n.indexOf(kw) >= 0) return true;
  return false;
}

// FÚTBOL (best-effort) para el tab "Canales" de Deportes: ligas/copas/competencias + marcas de canal
// dominadas por fútbol en LatAm (ESPN, Fox Sports, WIN, DSports, beIN, GolTV, TNT Sports, DirecTV Sports...).
// Deja FUERA lo que es claramente OTRO deporte (F1, MotoGP, NBA, NFL, UFC, tenis, golf, cricket, hockey...).
export const FOOTBALL_KW = [
  "futbol", "football", "soccer", "laliga", "la liga", "premier league", "champions", "libertadores", "sudamericana",
  "conmebol", "eliminatorias", "uefa", "fifa", "bundesliga", "serie a", "ligue 1", "eredivisie", "mls",
  "brasileirao", "copa", "mundial", "liga 1", "liga pro", "primera", "futsal", "win sport", "goltv", "gol tv",
  "gol ", "dsport", "directv sport", "espn", "fox sport", "fox deportes", "bein", "tnt sport",
  "sportv", "sky sport", "liga1", "tudn", "ligamx", "liga mx",
];

export function isFootball(name) {
  const n = normCat(name);
  for (const kw of FOOTBALL_KW) if (n.indexOf(kw) >= 0) return true;
  return false;
}
