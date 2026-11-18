// SuperTV's world for the tests that cross it with the other 1.0.46 work (seeds, channel tiles): the VegetaTV
// bootstrap and Xtream panels answering with the REAL categories of 9 panels (test/fixtures/stv-panels.json), as in
// test/supertv-slots.test.mjs. Users and passwords are made up; `o.cred(i)` can mark them (e.g. "SECRET") so a test can
// scan everything the plugin lets out for them.
import { readFileSync } from "node:fs";
import { res } from "./fake-kino.mjs";

export const BOOT = "vegetatvv2.duckdns.org";
export const PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6,\nseg1.ts\n";
const PANELS = JSON.parse(readFileSync(new URL("../fixtures/stv-panels.json", import.meta.url), "utf8")).panels;
const DAZN = JSON.parse(readFileSync(new URL("../fixtures/stv-dazn.json", import.meta.url), "utf8"));
/** The bootstrap's order as the Mac sees it: znn8 blocked (302 to Coljuegos), zee-ott the primary, fv99 + tresinl the slots. */
export const MAC = ["line.znn8.xyz", "line.zee-ott.xyz", "line.krishkaz.com", "fv99.nesewvp.top:8080", "pp.tresinl.xyz", "capitanhero.com",
  "line.tmpes.com", "ltv.ddns.net:8080", "reborned.cc:8080", "nexotvplus.com:8080", "myultratv.com:8080"];
export const hostOf = (u) => { try { return new URL(u).hostname; } catch (_) { return ""; } };
const plainCred = (i) => ({ username: "u" + i, password: "p" + i });

/** The made-up credentials of every server of the world (to scan for). */
export function credsOf(o = {}) {
  const cred = o.cred || plainCred;
  return (o.servers || MAC).map((_, i) => cred(i));
}

/**
 * A route for installKino / seed-world: the bootstrap + the panels. `o.modes[hostname]`, read at each request: "block"
 * (302 to Coljuegos), "auth0", "down" (timeout), "list403" (lists refused), or a function (URL) → response;
 * `o.stream(url)` answers the playlists. Anything else: undefined (the next route answers).
 */
export function stvWorld(o = {}) {
  const servers = o.servers || MAC;
  const cred = o.cred || plainCred;
  const base = { "line.znn8.xyz": "block", "capitanhero.com": "auth0" };
  // read at each request: a test may change `o.modes` between calls (a panel that starts refusing)
  const modeOf = (h) => (o.modes && o.modes[h]) || base[h] || "ok";
  const text = servers.map((h, i) => {
    const c = cred(i);
    return `http://${h}/get.php?username=${encodeURIComponent(c.username)}&password=${encodeURIComponent(c.password)}&type=m3u_plus 🏳`;
  }).join("\n");
  return async (url) => {
    let u;
    try { u = new URL(url); } catch (_) { return undefined; }
    if (u.host === BOOT) {
      if (u.searchParams.get("servers") === "1") return res(200, text, { "content-type": "text/plain" });
      return res(200, JSON.stringify({ ok: true, minimum_version_code: 25, latest_version_code: 25, servers_text: "", servers_url: `http://${BOOT}/bootstrap.php?servers=1` }));
    }
    if (u.pathname === "/player_api.php") {
      const mode = modeOf(u.hostname);
      if (typeof mode === "function") { const r = mode(u); if (r) return r; }
      if (mode === "block") return res(302, "", { Location: "https://www.coljuegos.gov.co/publicaciones/301824" });
      if (mode === "auth0") return res(200, JSON.stringify({ user_info: { auth: 0 } }));
      if (mode === "down") return Object.assign(new Error("timeout"), { code: "timeout" });
      const action = u.searchParams.get("action");
      if (action === "get_live_categories") return res(200, JSON.stringify((PANELS[u.hostname] || []).map(([category_id, category_name]) => ({ category_id, category_name, parent_id: 0 }))));
      if (action === "get_live_streams") {
        if (mode === "list403") return res(403, "");
        const cat = u.searchParams.get("category_id");
        const rows = u.hostname === "line.zee-ott.xyz" && cat === "2956" ? DAZN.zeeott
          : u.hostname === "pp.tresinl.xyz" && cat === "196" ? DAZN.tresinl
            : [1, 2, 3].map((n) => [Number(cat) * 10 + n, u.hostname + " " + cat + "/" + n]);
        return res(200, JSON.stringify(rows.map(([stream_id, name]) => ({ stream_id, name, category_id: cat,
          stream_icon: "https://logos.example.com/" + stream_id + ".png" }))));
      }
    }
    if (u.pathname.startsWith("/live/")) return o.stream ? o.stream(url) : res(200, PLAYLIST);
    return undefined;
  };
}
