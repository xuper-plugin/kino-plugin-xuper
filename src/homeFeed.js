// Home pre-armado: un proceso (launchd, en el Mac del autor) baja y descifra las columnas raíz del portal y publica
// home/feed.json en el repo. El plugin lo baja UNA vez y, en arranque frío, arma el Home desde ahí — sin portal ni sesión ni
// seeds (browsing resiliente aunque el portal o las seeds estén caídos). Reproducir/entrar a una categoría sí usa la sesión.
//
// El feed trae, por raíz, la MISMA respuesta de getNextColumns (recortada) que el plugin parsea con parseTree. Si falta, está
// viejo o falla, se cae a la carga normal del portal.
const FEED_URL = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/main/home/feed.json";
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // más viejo que esto: se ignora y se usa el portal
const ROOT_KEYS = ["peliculas", "series", "anime", "infantil"];

/**
 * Baja el feed (memoizado por instancia: una sola descarga). Devuelve `{ roots: { <root>: <respuesta getNextColumns> } }`
 * o null (sin feed, viejo, no válido o falló). Nunca lanza.
 */
export function makeHomeFeed({ kino, clock, url = FEED_URL }) {
  let promise = null;
  async function fetchOnce() {
    try {
      // Cache-bust por hora: refresca la CDN sin pedir siempre de nuevo.
      const bust = Math.floor(clock.now() / 3600000);
      const res = await kino.fetch(`${url}?v=${bust}`, { headers: { Accept: "application/json" } });
      if (!res || res.ok === false) return null;
      const d = JSON.parse(res.text());
      if (!d || d.v !== 1 || !d.roots || typeof d.roots !== "object") return null;
      if (typeof d.at === "number" && clock.now() - d.at > MAX_AGE_MS) return null;
      const roots = {};
      for (const k of ROOT_KEYS) {
        const r = d.roots[k];
        if (r && Array.isArray(r.recommendList) && r.recommendList.length) roots[k] = r;
      }
      return Object.keys(roots).length ? { roots } : null;
    } catch (_) { return null; }
  }
  return {
    // La respuesta getNextColumns pre-armada de una raíz, o null. Comparte una sola descarga entre las 4 raíces.
    async rootResponse(root) {
      if (!promise) promise = fetchOnce();
      const feed = await promise;
      return feed && feed.roots[root] ? feed.roots[root] : null;
    },
  };
}
