// Connector group B (spec §5.1 rows and §7 Step 2 "Connector edits"): supertv + xtream, futbollibre, deportv,
// sports. A fake Kino (same runtime across calls); each "call" starts with beginCall(), a cold runtime also with
// ls._resetMemory(). Fixtures are shaped like the recordings in S/live-tvconn and S/live-b (category names only;
// hosts are allowlisted names with made-up users, never a real account).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const live = await import("../src/live.js");
const { hexEnc } = await import("../src/liveMap.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { liveRef } = await import("../src/refs.js");
const stvMod = await import("../src/sources/supertv.js");
const xtream = await import("../src/sources/xtream.js");
const flMod = await import("../src/sources/futbollibre.js");
const dtvMod = await import("../src/sources/deportv.js");
const sports = await import("../src/sources/sports.js");
const supertv = stvMod.default;
const futbollibre = flMod.default;
const deportv = dtvMod.default;

const M = 60_000, H = 60 * M, D = 24 * H;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (u) => { try { return new URL(u).host; } catch (_) { return ""; } };

/** A device: a fresh fake Kino with a Bearer, a cold live memory, and a new call. */
async function device(opts = {}) {
  const storage = { ...(opts.storage || {}), "o2:bearer": "bearer-token" };
  const k = installKino({ ...opts, storage });
  await clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  k.writes.length = 0;
  ls._resetMemory();
  beginCall();
  return k;
}
/** The next plugin call in the same runtime (cold = also a new runtime). */
function nextCall(k, { cold = false } = {}) {
  if (cold) ls._resetMemory();
  beginCall();
  k.requests.length = 0;
  k.writes.length = 0;
}
/** A connector context like the framework's, recording what the connector hands back. */
function fakeCtx() {
  const ctx = { set: [], put: {}, once: undefined };
  ctx.setCats = (cats) => { ctx.set.push(cats); };
  ctx.putList = (cat, list) => { ctx.put[cat] = list; };
  return ctx;
}

test.afterEach(() => live._setSources(null));

// ═════════════════════════════ supertv + xtream ═════════════════════════════

// Category names as a real account lists them (S/live-tvconn, line.krishkaz.com), plus a duplicated id and 18+ groups.
const CATS = [["1804", "ES ▎GENERAL"], ["1805", "ES ▎DEPORTE"], ["2956", "ES ▎DAZN"], ["2957", "ES ▎M+ CAMPEONES"],
  ["1807", "ES ▎NIÑOS"], ["2945", "ES ▎LALIGA+"], ["2745", "ES ▎EVENTS"], ["2425", "ES ▎LALIGA REPLAY"],
  ["2792", "UEFA ▎CHAMPIONS LEAGUE"], ["2845", "SPORTS ▎REPLAY"], ["2090", "FORMULA 1"], ["2776", "MOTO GP"],
  ["2845", "SPORTS ▎REPLAY"], ["2176", "PPV ▎PAY PER VIEW"], ["2777", "NL ▎VIAPLAY PREMIER LEAGUE ʀᴀᴡ"],
  ["1745", "FR ▎SPORTS"], ["2697", "FR ▎LIGUE 1+"], ["2793", "DE ▎SKY BUNDESLIGA"], ["1338", "UK ▎SPORTS"],
  ["2361", "UK ▎PREMIER LEAGUE"], ["2292", "UK ▎CHAMPIONSHIP"], ["2279", "PT ▎DESPORTO"], ["2426", "IT ▎SERIE A REPLAY"],
  ["1295", "AR ▎MBC | إم بي سي"], ["1139", "AR ▎BEIN SPORTS 4K"], ["2373", "AR ▎BEIN SPORTS HD"], ["2182", "US ▎TUDNXTRA"],
  ["2085", "US ▎NBA"], ["2107", "US ▎MLS"], ["2408", "US ▎SOCCER"],
  ["9001", "LATINO ▎EVENTOS ADULTOS +18"], ["9002", "XXX | VIP 18+"], ["9003", "ADULTOS XXX"]]
  .map(([category_id, category_name]) => ({ category_id, category_name, parent_id: 0 }));

// Candidate servers in the bootstrap's order (all allowlisted hosts; users are made up).
const SERVERS = ["line.znn8.xyz", "line.zee-ott.xyz", "line.krishkaz.com", "fv99.nesewvp.top:8080", "pp.tresinl.xyz",
  "capitanhero.com", "goodbom.net"];
const serversText = () => SERVERS.map((h, i) => `http://${h}/get.php?username=u${i}&password=p${i}&type=m3u_plus 🏳`).join("\n");
const accOf = (i) => ({ url: "http://" + SERVERS[i], username: "u" + i, password: "p" + i });
const STV_BOOT = "vegetatvv2.duckdns.org";

/**
 * The VegetaTV bootstrap + Xtream servers. `need` = the minimum version code; `modes[host]` = "block" (302 to the
 * coljuegos.gov.co block page), "down", "auth0", "slow" (answers after 25 ms), else ok. `cats[host]` overrides CATS.
 */
function stvWorld(o = {}) {
  const need = o.need || 25;
  const modes = { "line.znn8.xyz": "block", "line.zee-ott.xyz": "slow", "capitanhero.com": "auth0", ...(o.modes || {}) };
  return async (url, init) => {
    const u = new URL(url);
    if (u.host === STV_BOOT) {
      if (o.bootDown) return Object.assign(new Error("down"), { code: "network" });
      const code = Number(init.headers["X-Vegeta-Version-Code"]);
      if (u.searchParams.get("servers") === "1") return res(200, serversText(), { "content-type": "text/plain" });
      if (code < need) return res(426, JSON.stringify({ ok: false, minimum_version_code: need, latest_version_code: need }), { "content-type": "application/json" });
      return res(200, JSON.stringify({ ok: true, minimum_version_code: need, latest_version_code: need, servers_text: "", servers_url: `http://${STV_BOOT}/bootstrap.php?servers=1` }), { "content-type": "application/json" });
    }
    if (u.pathname === "/player_api.php") {
      const mode = modes[u.host] || "ok";
      if (mode === "block") return res(302, "", { Location: "https://www.coljuegos.gov.co/publicaciones/301824" });
      if (mode === "down") return Object.assign(new Error("timeout"), { code: "timeout" });
      if (mode === "auth0") return res(200, JSON.stringify({ server_info: {}, user_info: { auth: 0, status: "Invalid" } }));
      if (mode === "slow") await sleep(25);
      const action = u.searchParams.get("action");
      if (action === "get_live_categories") return res(200, JSON.stringify((o.cats && o.cats[u.host]) || CATS));
      if (action === "get_live_streams") {
        const cat = u.searchParams.get("category_id");
        return res(200, JSON.stringify([1, 2, 3].map((n) => ({ stream_id: Number(cat) * 10 + n, name: `${u.host} ${cat}/${n}`, stream_icon: "https://logo.test/" + n + ".png", category_id: cat }))));
      }
    }
    if (u.host === "www.coljuegos.gov.co") return res(200, "<html>bloqueado</html>", { "content-type": "text/html" });
    return undefined;
  };
}
const stvStored = (k) => JSON.parse(k.store.get("o2:stv"));
const apiCalls = (k, action) => k.requests.filter((r) => r.url.includes("action=" + action));

test("supertv categories: sports only, Spanish / Latin American first then football, never 18+, ≤ 30, deduped", () => {
  const rank = stvMod.rankSupertv;
  assert.equal(rank("ES ▎DEPORTE"), 0);
  assert.equal(rank("ESPAÑA DEPORTES"), 0);
  assert.equal(rank("DEPORTES LATINOS"), 0);
  assert.equal(rank("ES | UEFA Liga de Campeones"), 0);
  assert.equal(rank("ES ▎EVENTS"), 0);
  assert.equal(rank("UEFA ▎CHAMPIONS LEAGUE"), 1);
  assert.equal(rank("US ▎TUDNXTRA"), 1);
  assert.equal(rank("ES ▎GENERAL"), -1, "not sports");
  assert.equal(rank("LAME | ARGENTINA VIP"), -1, "a country's general channels are not sports");
  assert.equal(rank("AR ▎BEIN SPORTS HD"), -1, "AR = Arabic on these panels");
  assert.equal(rank("FORMULA 1"), -1);
  assert.equal(rank("PT ▎DESPORTO"), -1);
  assert.equal(rank("UK ▎CHAMPIONSHIP"), -1, "'champions' is a whole word");
});

test("supertv cold: learns the version code from a 426 and keeps it; the coljuegos redirect is a failure (never followed); the first success in priority order wins; the probe's categories are reused", async () => {
  const k = await device({ routes: [stvWorld({ need: 26 })] });
  const cats = await supertv.categories({});
  // bootstrap: 426 (code 25) → 200 (code 26) → servers list; then ONE batch of 6 probes (the 7th server is not needed)
  const boot = k.requests.filter((r) => hostOf(r.url) === STV_BOOT);
  assert.deepEqual(boot.map((r) => r.headers["X-Vegeta-Version-Code"]), ["25", "26", "26"]);
  const probes = apiCalls(k, "get_live_categories");
  assert.deepEqual(probes.map((r) => hostOf(r.url)), SERVERS.slice(0, 6));
  for (const r of probes) assert.ok(r.timeoutMs <= 3000, "probe timeoutMs " + r.timeoutMs);
  assert.equal(k.requests.length, 3 + 6);
  assert.ok(!k.requests.some((r) => hostOf(r.url) === "www.coljuegos.gov.co"), "the block page is never requested");
  // zee-ott (2nd, slower) beats krishkaz (3rd, faster): priority order, not speed; its categories, no 2nd request
  const st = stvStored(k);
  assert.equal(st.acct.server, "http://line.zee-ott.xyz");
  assert.equal(st.boot.ver, "26");
  assert.equal(st.boot.servers.length, SERVERS.length);
  assert.equal(probes.filter((r) => hostOf(r.url) === "line.zee-ott.xyz").length, 1);
  // ES / LatAm sports first, then football; no 18+, no general, no Arabic beIN, the duplicated id once
  assert.deepEqual(cats.map((c) => c.title), ["ES ▎DEPORTE", "ES ▎DAZN", "ES ▎M+ CAMPEONES", "ES ▎LALIGA+", "ES ▎EVENTS",
    "ES ▎LALIGA REPLAY", "UEFA ▎CHAMPIONS LEAGUE", "NL ▎VIAPLAY PREMIER LEAGUE ʀᴀᴡ", "FR ▎LIGUE 1+", "DE ▎SKY BUNDESLIGA",
    "UK ▎PREMIER LEAGUE", "IT ▎SERIE A REPLAY", "US ▎TUDNXTRA", "US ▎MLS", "US ▎SOCCER"]);
  assert.ok(cats.every((c) => !c.adult));
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length);
  // the next bootstrap (stored one past 24 h) asks with the learned code at once: no 426
  const aged = stvStored(k);
  aged.boot.at = Date.now() - 25 * H;
  delete aged.acct;
  k.store.set("o2:stv", JSON.stringify(aged));
  nextCall(k, { cold: true });
  await supertv.categories({});
  assert.deepEqual(k.requests.filter((r) => hostOf(r.url) === STV_BOOT).map((r) => r.headers["X-Vegeta-Version-Code"]), ["26", "26"]);
});

test("supertv: at most 30 categories, the Spanish ones kept first when a server offers more", async () => {
  const many = [...Array.from({ length: 40 }, (_, i) => ({ category_id: String(5000 + i), category_name: "UK ▎PREMIER LEAGUE " + i })),
    { category_id: "1805", category_name: "ES ▎DEPORTE" }];
  await device({ routes: [stvWorld({ cats: { "line.zee-ott.xyz": many } })] });
  const cats = await supertv.categories({});
  assert.equal(cats.length, 30);
  assert.equal(stvMod.MAX_CATS, 30);
  assert.equal(cats[0].title, "ES ▎DEPORTE");
});

test("supertv: the remembered server first (1 request, no bootstrap); a dead one falls to the candidates without it", async () => {
  const acct = { server: "http://line.krishkaz.com", user: "u2", pass: "p2", at: Date.now() - 7 * H };
  let k = await device({ routes: [stvWorld()], storage: { "o2:stv": JSON.stringify({ acct }) } });
  const cats = await supertv.categories({});
  assert.equal(k.requests.length, 1);
  assert.equal(hostOf(k.requests[0].url), "line.krishkaz.com");
  assert.ok(cats.length > 0);
  assert.ok(stvStored(k).acct.at > acct.at, "verified: its time moves");

  k = await device({ routes: [stvWorld({ modes: { "line.krishkaz.com": "down" } })], storage: { "o2:stv": JSON.stringify({ acct }) } });
  await supertv.categories({});
  const probes = apiCalls(k, "get_live_categories").map((r) => hostOf(r.url));
  assert.equal(probes[0], "line.krishkaz.com", "remembered first");
  assert.equal(probes.filter((h) => h === "line.krishkaz.com").length, 1, "not probed again in the batch");
  assert.equal(stvStored(k).acct.server, "http://line.zee-ott.xyz");
});

test("supertv bootstrap: a stored one is used for 24 h (0 requests), served stale up to 7 d when the bootstrap is down", async () => {
  const servers = SERVERS.map((h, i) => accOf(i));
  let k = await device({ routes: [stvWorld({ bootDown: true })], storage: { "o2:stv": JSON.stringify({ boot: { servers, ver: "25", at: Date.now() - 3 * D } }) } });
  await supertv.categories({});
  assert.equal(k.requests.filter((r) => hostOf(r.url) === STV_BOOT).length, 1, "tried once, failed, stale servers used");
  assert.equal(stvStored(k).acct.server, "http://line.zee-ott.xyz");

  k = await device({ routes: [stvWorld()], storage: { "o2:stv": JSON.stringify({ boot: { servers, ver: "25", at: Date.now() - 2 * H } }) } });
  await supertv.categories({});
  assert.equal(k.requests.filter((r) => hostOf(r.url) === STV_BOOT).length, 0);

  k = await device({ routes: [stvWorld({ bootDown: true })], storage: { "o2:stv": JSON.stringify({ boot: { servers, ver: "25", at: Date.now() - 8 * D } }) } });
  await assert.rejects(() => supertv.categories({}));
});

test("supertv channels: a fresh remembered account lists with 1 request; ids and refs are 1.0.43's", async () => {
  const acct = { server: "http://line.krishkaz.com", user: "u2", pass: "p2", at: Date.now() - H };
  const k = await device({ routes: [stvWorld()], storage: { "o2:stv": JSON.stringify({ acct }) } });
  const ctx = fakeCtx();
  const list = await supertv.channels("1805", ctx);
  assert.equal(k.requests.length, 1);
  assert.ok(k.requests[0].url.includes("action=get_live_streams") && k.requests[0].url.includes("category_id=1805"));
  assert.equal(list.length, 3);
  const raw = xtream.encodeChannel(accOf(2), 18051);
  assert.equal(list[0].id, raw);
  assert.equal(list[0].logo, "https://logo.test/1.png");
  const [kino0] = live.normalizeChannels("supertv", list);
  assert.equal(kino0.id, "supertv_" + live.hashId(raw));
  assert.equal(kino0.ref, liveRef("supertv", raw));
  assert.deepEqual(ctx.set, [], "no pick, no categories handed over");
  // resolve is pure string building (no request)
  nextCall(k);
  const out = await supertv.resolve(raw);
  assert.equal(out.url, "http://line.krishkaz.com/live/u2/p2/18051.m3u8");
  assert.equal(k.requests.length, 0);
});

test("supertv channels: a dead remembered account → another one is picked, its categories go to the framework", async () => {
  const acct = { server: "http://line.krishkaz.com", user: "u2", pass: "p2", at: Date.now() - H };
  const servers = SERVERS.map((h, i) => accOf(i));
  const k = await device({ routes: [stvWorld({ modes: { "line.krishkaz.com": "down" } })],
    storage: { "o2:stv": JSON.stringify({ acct, boot: { servers, ver: "25", at: Date.now() } }) } });
  const ctx = fakeCtx();
  const list = await supertv.channels("1805", ctx);
  assert.ok(list[0].id.startsWith("http://line.zee-ott.xyz\u0001u1\u0001p1\u0001"));
  assert.equal(ctx.set.length, 1);
  assert.equal(ctx.set[0][0].title, "ES ▎DEPORTE");
  assert.equal(stvStored(k).acct.server, "http://line.zee-ott.xyz");
  // a category the new server does not have: no list request, a failure (the framework keeps the stored list)
  nextCall(k);
  const k2 = await device({ routes: [stvWorld()], storage: {} });
  await assert.rejects(() => supertv.channels("424242", fakeCtx()), /not on the current server/);
  assert.equal(apiCalls(k2, "get_live_streams").length, 0);
});

test("supertv through the framework: cold liveCategories once, then 0 requests; a list 1 request; event lists 1 h / 6 h; o2:stv is JSON", async () => {
  live._setSources([supertv]);
  const k = await device({ routes: [stvWorld()] });
  const cats = await live.liveCategories();
  assert.equal(JSON.parse(k.store.get("o2:lc")).src.supertv.cats.length, 15, "15 raw categories stored");
  assert.ok(cats.length < 15 && cats.every((c) => c.id.startsWith("v.")), "grouped by country and events: " + cats.map((c) => c.id).join(" "));
  assert.equal(k.requests.length, 2 + 6, "bootstrap 2 + one batch of 6 probes");
  for (const r of k.requests) assert.ok(r.timeoutMs <= 4000, "first-fill bound " + r.timeoutMs);
  assert.doesNotThrow(() => JSON.parse(k.store.get("o2:stv")));
  assert.notEqual(k.store.get("o2:stv"), "[object Object]");

  nextCall(k, { cold: true });
  assert.deepEqual((await live.liveCategories()).map((c) => c.id), cats.map((c) => c.id));
  assert.equal(k.requests.length, 0);
  assert.deepEqual(k.writes, []);

  nextCall(k, { cold: true });
  const page = await live.liveChannels({ categoryId: "supertv." + hexEnc("1805"), cursor: null });
  assert.equal(page.items.length, 3);
  assert.equal(k.requests.length, 1, "the account is remembered: get_live_streams only");
  assert.ok(!k.writes.includes("o2:stv"), "a list does not rewrite o2:stv");

  // event / ppv / replay categories: fresh 1 h, stale up to 6 h; others the source's 6 h / 24 h
  nextCall(k);
  assert.deepEqual(live.listPolicy(supertv, "2745"), { fresh: H, maxStale: 6 * H, code: false });   // ES ▎EVENTS
  assert.deepEqual(live.listPolicy(supertv, "2425"), { fresh: H, maxStale: 6 * H, code: false });   // ES ▎LALIGA REPLAY
  assert.deepEqual(live.listPolicy(supertv, "1805"), { fresh: 6 * H, maxStale: D, code: false });
});

test("supertv: a remembered account that changes drops every stored list of the source (cache-3)", async () => {
  live._setSources([supertv]);
  const acct = { server: "http://line.krishkaz.com", user: "u2", pass: "p2", at: Date.now() - H };
  const servers = SERVERS.map((h, i) => accOf(i));
  let k = await device({ routes: [stvWorld()], storage: { "o2:stv": JSON.stringify({ acct, boot: { servers, ver: "25", at: Date.now() } }) } });
  await live.liveCategories();
  nextCall(k);
  const deporte = "supertv." + hexEnc("1805"), general = "supertv." + hexEnc("1804");
  assert.ok((await live.liveChannels({ categoryId: deporte })).items[0].ref.includes("line.krishkaz.com"));
  nextCall(k);
  await live.liveChannels({ categoryId: general });
  // the remembered account dies; a third category is listed: another server is picked
  k = await device({ routes: [stvWorld({ modes: { "line.krishkaz.com": "down" } })], storage: Object.fromEntries(k.store) });
  const champions = await live.liveChannels({ categoryId: "supertv." + hexEnc("2792") });
  assert.ok(champions.items[0].ref.includes("line.zee-ott.xyz"));
  assert.equal(stvStored(k).acct.server, "http://line.zee-ott.xyz");
  ls.flushMeta();
  // the list stored under the dead account (fresh for 6 h by policy) is not served: it is listed again on the new one
  nextCall(k, { cold: true });
  const again = await live.liveChannels({ categoryId: deporte });
  assert.ok(again.items.every((c) => c.ref.includes("line.zee-ott.xyz")), JSON.stringify(again.items.map((c) => c.ref)));
  assert.deepEqual(apiCalls(k, "get_live_streams").map((r) => hostOf(r.url)), ["line.zee-ott.xyz"], "one list request, to the new server");
  assert.equal(k.store.get("o2:ll:" + general), undefined, "the other stored list is gone too");
});

test("supertv: a server whose categories all fail the filter is never picked (nor kept); the next candidate is (cache-4)", async () => {
  const acct = { server: "http://line.krishkaz.com", user: "u2", pass: "p2", at: Date.now() - 7 * H };
  const useless = [{ category_id: "1", category_name: "UK ▎NEWS" }, { category_id: "2", category_name: "XXX | VIP 18+" }];
  const k = await device({ routes: [stvWorld({ cats: { "line.krishkaz.com": useless } })],
    storage: { "o2:stv": JSON.stringify({ acct, boot: { servers: SERVERS.map((h, i) => accOf(i)), ver: "25", at: Date.now() } }) } });
  const cats = await supertv.categories({});
  assert.ok(cats.length > 0, "categories from the next server");
  assert.equal(stvStored(k).acct.server, "http://line.zee-ott.xyz");
  assert.equal(apiCalls(k, "get_live_categories").filter((r) => hostOf(r.url) === "line.krishkaz.com").length, 1);
});

// ═════════════════════════════ futbollibre ═════════════════════════════

const AGENDA_API = "https://api.wqxag.com/diaries.json";
/** Lima (UTC−5) date and hour of an epoch ms, as the agenda API writes them. */
function lima(ms) {
  const d = new Date(ms - 5 * H);
  const p = (n) => String(n).padStart(2, "0");
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, hour: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00` };
}
function primaryAgenda(events) {
  return JSON.stringify({ data: events.map((e, i) => {
    const t = lima(e.start);
    return { id: i, attributes: { diary_description: e.desc, date_diary: t.date, diary_hour: t.hour,
      embeds: { data: e.frames.map((f) => ({ attributes: { embed_iframe: f } })) },
      country: { data: { attributes: { name: "Perú", image: { data: { attributes: { url: "/uploads/pe.png" } } } } } } } };
  }) });
}
// Starts rounded to the minute (the agenda has minutes only).
const minute = (ms) => Math.floor(ms / M) * M;

test("futbollibre categories and 'main' are code (0 requests); 'main' ids are 1.0.43's", async () => {
  const k = await device({ noFetch: true });
  const cats = await futbollibre.categories({});
  assert.deepEqual(cats.map((c) => c.id), ["hoy", "main", "mas"]);
  const main = await futbollibre.channels("main", {});
  assert.equal(main.length, 19);
  assert.deepEqual(main[0], { id: "tvf90.espn,la18.espn", title: "ESPN", logo: "https://verfutbol.pro/img/channels/espn-1.webp" });
  assert.equal(main.find((c) => c.title === "TUDN México").id, "tvf90.tudn_mx,la18.tudn_mx");
  assert.ok(main.every((c) => c.key === undefined), "main keeps its ids");
  assert.equal(k.requests.length, 0);
});

test("futbollibre 'hoy': own Kino ids (no collision with 'main'), refs kept, titles with no 'EN VIVO' or clock", async () => {
  const now = Date.now();
  const events = [
    { desc: "Liga 1: Alianza vs Universitario", start: minute(now - 20 * M), frames: ["https://tvf90.com/5.php?stream=espn"] },
    { desc: "Copa: Perú vs Chile", start: minute(now + 2 * H), frames: ["https://tvf90.com/5.php?stream=espn"] },
    { desc: "Viejo: A vs B", start: minute(now - 5 * H), frames: ["https://tvf90.com/5.php?stream=dsports"] },
  ];
  const k = await device({ routes: [(url) => (url === AGENDA_API ? res(200, primaryAgenda(events), { "content-type": "application/json" }) : undefined)] });
  const hoy = await futbollibre.channels("hoy", {});
  assert.equal(k.requests.length, 1);
  assert.deepEqual(hoy.map((c) => c.title), ["Alianza vs Universitario — Liga 1", "Perú vs Chile — Copa"], "ended matches dropped, no status");
  for (const c of hoy) assert.ok(!/EN VIVO|\d{1,2}:\d{2}/.test(c.title), c.title);
  assert.equal(hoy[0].id, "tvf90.espn,la18.espn", "the raw id (and so the ref) is 1.0.43's");
  assert.deepEqual(hoy.map((c) => c.start), [minute(now - 20 * M), minute(now + 2 * H)], "each event's kick-off (src/liveMerge.js)");
  const main = await futbollibre.channels("main", {});
  const [hoyK] = live.normalizeChannels("futbollibre", hoy);
  const [mainK] = live.normalizeChannels("futbollibre", main);
  assert.notEqual(hoyK.id, mainK.id, "no longer the same Kino id as main's ESPN");
  assert.equal(hoyK.ref, mainK.ref);
  assert.equal(hoyK.ref, liveRef("futbollibre", "tvf90.espn,la18.espn"));
  assert.ok(hoy[0].key.startsWith("hoy."));
  assert.equal(new Set(live.normalizeChannels("futbollibre", hoy).map((c) => c.id)).size, 2, "two events on one channel stay two");
});

test("futbollibre agenda: falls back in order, throws when every source fails, stops at the 10 s budget", async () => {
  const now = Date.now();
  const b1 = JSON.stringify({ events: [{ title: "Liga MX: América vs Chivas", date: lima(now + H).date, time: lima(now + H).hour.slice(0, 5), embeds: [{ iframe: "https://tvf90.com/5.php?stream=foxsportsmx" }] }] });
  let k = await device({ routes: [(url) => (url === AGENDA_API ? res(500, "") : url.endsWith("/api/agenda") ? res(200, b1, { "content-type": "application/json" }) : undefined)] });
  const hoy = await futbollibre.channels("hoy", {});
  assert.deepEqual(hoy.map((c) => c.title), ["América vs Chivas — Liga MX"]);
  assert.equal(k.requests.length, 2);

  k = await device({ routes: [() => res(503, "")] });
  await assert.rejects(() => futbollibre.channels("hoy", {}), /agenda/);
  assert.equal(k.requests.length, 3);

  // a source that answers with no match is a real empty agenda
  k = await device({ routes: [(url) => (url === AGENDA_API ? res(200, primaryAgenda([]), { "content-type": "application/json" }) : res(503, ""))] });
  assert.deepEqual(await futbollibre.channels("hoy", {}), []);

  // the chain's budget: the primary takes 9.5 s and fails → no fallback starts
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    k = await device({ routes: [(url) => { if (url === AGENDA_API) { skew += 9500; return res(500, ""); } return res(200, b1, { "content-type": "application/json" }); }] });
    await assert.rejects(() => futbollibre.channels("hoy", {}));
    assert.deepEqual(k.requests.map((r) => r.url), [AGENDA_API]);
  } finally { Date.now = realNow; }
});

test("futbollibre through the framework: a failed 'hoy' refresh keeps the stored list (never [] over it); 'más' failures throw", async () => {
  live._setSources([futbollibre]);
  const now = Date.now();
  const events = [{ desc: "Liga 1: Alianza vs Universitario", start: minute(now + 30 * M), frames: ["https://tvf90.com/5.php?stream=espn"] }];
  let up = true;
  const k = await device({ routes: [(url) => (url === AGENDA_API && up ? res(200, primaryAgenda(events), { "content-type": "application/json" }) : res(503, ""))] });
  const cat = "futbollibre." + hexEnc("hoy");
  const first = await live.liveChannels({ categoryId: cat, cursor: null });
  assert.equal(first.items.length, 1);
  // 11 min later (past its 10 min freshness) the agenda is down: the stored list is served
  up = false;
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * M;
  try {
    nextCall(k, { cold: true });
    const again = await live.liveChannels({ categoryId: cat, cursor: null });
    assert.deepEqual(again.items.map((c) => c.id), first.items.map((c) => c.id));
    assert.ok(k.requests.length >= 1, "it did try");
  } finally { Date.now = realNow; }
  // "más": an error page or an empty scrape is a failure, not an empty list
  nextCall(k);
  await assert.rejects(() => futbollibre.channels("mas", {}));
  const html = '<a class="channel-card" href="/channel/win-sports"><div class="channel-logo"><img src="/assets/w.png" alt="Win Sports"';
  installKino({ routes: [(url) => (url === "https://futbol-libre.app/channels" ? res(200, html, { "content-type": "text/html" }) : undefined)] });
  beginCall();
  const mas = await futbollibre.channels("mas", {});
  assert.deepEqual(mas, [{ id: "b2c.win-sports.1,b2c.win-sports.4,b2c.win-sports.2,b2c.win-sports.3", title: "Win Sports", logo: "https://futbol-libre.app/assets/w.png" }]);
});

test("futbollibre resolve: the m3u8 check waits at most 2.5 s; old refs still play", async () => {
  const m3u8 = "https://edge.ftlly.com/live/espn/index.m3u8";
  const k = await device({ routes: [(url) => {
    if (url.startsWith("https://tvf90.com/5.php?stream=espn")) return res(200, `<script>var playbackURL = "${m3u8.replace(/\//g, "\\/")}";</script>`, { "content-type": "text/html" });
    if (url === m3u8) return res(200, "#EXTM3U\n#EXT-X-VERSION:3\n", { "content-type": "application/vnd.apple.mpegurl" });
    return undefined;
  }] });
  const out = await futbollibre.resolve("tvf90.espn,la18.espn", {});
  assert.equal(out.url, m3u8);
  const check = k.requests.find((r) => r.url === m3u8);
  assert.ok(check && check.timeoutMs <= flMod.VERIFY_TIMEOUT_MS && flMod.VERIFY_TIMEOUT_MS === 2500, "verify timeoutMs " + (check && check.timeoutMs));
  assert.equal(flMod.AGENDA_BUDGET_MS, 10000);
});

// ═════════════════════════════ deportv ═════════════════════════════

const DTV = "https://elcanaldeportivo.org/partidos.json";
const LM = "Mon, 16 Nov 2026 13:21:30 GMT";
function match(liga, equipos, utc, canal = "ESPN", url = "/ver/espn.php") {
  return { hora_utc: new Date(utc).toISOString(), logo: "img/nat.png", liga: liga + ":", equipos, canales: [{ nombre: canal, url, calidad: "720p" }] };
}
function scheduleNow(now) {
  return [
    match("UEFA Nations League", "Alemania vs. Países Bajos", now - H, "ESPN", "/ver/espn.php"),
    match("UEFA Nations League", "Grecia vs. Serbia", now - 20 * H, "ESPN 4", "/ver/espn4.php"),
    match("liga 1", "Cusco vs. AD Tarma", now + 2 * H, "L1Max", "/ver/liga1maxpe.php"),
    match("Futbol Chileno", "Coquimbo vs. O'Higgins", now + 30 * H, "TNT Sports", "/ver/tntsportspremium.php"),
    match("Liga Vieja", "A vs. B", now - 10 * H),
    match("Liga Lejana", "C vs. D", now + 60 * H),
    match("Mundial 2026", "Catar vs. Suiza", Date.UTC(2026, 5, 12, 19), "Caracol", "/ver/caracol.php"),
  ];
}

test("deportv: If-Modified-Since instead of ?v=; a 304 reuses the stored schedule and recomputes the lists", async () => {
  const now = Date.now();
  let notModified = false;
  const k = await device({ routes: [(url, init) => {
    if (url !== DTV) return undefined;
    if (notModified && init.headers["If-Modified-Since"] === LM) return res(304, "");
    return res(200, JSON.stringify(scheduleNow(now)), { "content-type": "application/json", "Last-Modified": LM });
  }] });
  const ctx = fakeCtx();
  const today = await deportv.channels("today", ctx);
  assert.deepEqual(k.requests.map((r) => r.url), [DTV], "no ?v= cache-buster");
  assert.equal(k.requests[0].headers["If-Modified-Since"], undefined);
  assert.deepEqual(today.map((c) => c.title.split(" · ")[0]), ["Alemania vs. Países Bajos", "Cusco vs. AD Tarma"]);
  assert.deepEqual(today.map((c) => c.start), [now - H, now + 2 * H].map((t) => Date.parse(new Date(t).toISOString())), "each match's kick-off (src/liveMerge.js)");
  const stored = JSON.parse(k.store.get("o2:dtv"));
  assert.equal(stored.lm, LM);
  assert.equal(stored.m.length, 7);
  // the same response stored the categories and the other categories' lists
  assert.deepEqual(ctx.set[0].map((c) => c.id), ["today", "l_uefa-nations-league", "l_liga-1", "l_futbol-chileno"]);
  assert.deepEqual(Object.keys(ctx.put).sort(), ["l_futbol-chileno", "l_liga-1", "l_uefa-nations-league"]);

  notModified = true;
  nextCall(k, { cold: true });
  const again = await deportv.channels("today", fakeCtx());
  assert.equal(k.requests[0].headers["If-Modified-Since"], LM);
  assert.deepEqual(again, today);
  assert.ok(!k.writes.includes("o2:dtv"), "a 304 rewrites nothing");
});

test("deportv: leagues only with a match in [now − 3 h, now + 48 h], their old matches dropped, ≤ 6 categories, ids fit Kino's 128", async () => {
  const now = Date.now();
  const sched = dtvMod.categoriesOf(scheduleNow(now).map((m) => ({ league: m.liga.replace(/:$/, ""), title: m.equipos, utc: Date.parse(m.hora_utc), logo: "", channels: [{ name: "ESPN", path: "/ver/espn.php", quality: "" }] })), now);
  // "Hoy" is stored as { es, en } (src/live.js shows the visible language; checked through the framework below)
  assert.deepEqual(sched.map((c) => (typeof c.title === "object" ? c.title.es : c.title)), ["Hoy", "UEFA Nations League", "liga 1", "Futbol Chileno"]);
  assert.deepEqual(sched[0].title, { es: "Hoy", en: "Today" });
  const k = await device({ routes: [(url) => (url === DTV ? res(200, JSON.stringify(scheduleNow(now)), { "content-type": "application/json" }) : undefined)] });
  const uefa = await deportv.channels("l_uefa-nations-league", fakeCtx());
  assert.deepEqual(uefa.map((c) => c.title.split(" · ")[0]), ["Alemania vs. Países Bajos"], "the 20 h old match is gone");
  assert.deepEqual(await deportv.channels("l_mundial-2026", fakeCtx()), [], "a league out of the window lists nothing");
  assert.equal(k.requests.length, 1, "one schedule per call");
  // ≤ 6
  const many = Array.from({ length: 9 }, (_, i) => ({ league: "Liga " + i, title: "x", utc: now + i * H, logo: "", channels: [] }));
  assert.equal(dtvMod.categoriesOf(many, now).length, dtvMod.MAX_CATS);
  assert.equal(dtvMod.MAX_CATS, 6);
  // capped hex: short ids are 1.0.43's ("l_" + slug ≤ 60), long ones are cut to fit Kino's 128
  assert.equal(dtvMod.leagueId("UEFA Nations League"), "l_uefa-nations-league");
  const long = dtvMod.leagueId("Campeonato Nacional de Fútbol Profesional de la Primera División de Algún País");
  assert.equal(long.length, 60);
  assert.ok(("deportv." + hexEnc(long)).length <= 128);
  assert.match("deportv." + hexEnc(long), /^[A-Za-z0-9._~-]{1,128}$/);
});

test("deportv through the framework: one request lists 'Hoy', stores the categories and the other leagues (0 requests next)", async () => {
  live._setSources([deportv]);
  const now = Date.now();
  const k = await device({ routes: [(url) => (url === DTV ? res(200, JSON.stringify(scheduleNow(now)), { "content-type": "application/json", "Last-Modified": LM }) : undefined)] });
  const today = await live.liveChannels({ categoryId: "deportv." + hexEnc("today"), cursor: null });
  assert.equal(today.items.length, 2);
  assert.equal(k.requests.length, 1);
  // channel ids are 1.0.43's: deportv_<hashId("<base>~<disc>")>
  assert.equal(today.items[0].id, "deportv_" + live.hashId("espn~alemania-vs-paises-bajos-espn"));
  assert.equal(today.items[0].ref, liveRef("deportv", "espn~alemania-vs-paises-bajos-espn"));

  nextCall(k, { cold: true });
  const cats = await live.liveCategories();
  const stored = JSON.parse(k.store.get("o2:lc")).src.deportv.cats;
  assert.deepEqual(stored.map((c) => c.title), [{ es: "Hoy", en: "Today" }, "UEFA Nations League", "liga 1", "Futbol Chileno"], "stored whole ({es, en})");
  assert.deepEqual(cats.map((c) => c.title), ["Eventos en vivo"], "every deportv category is a live event");
  kino.lang = "en";
  assert.equal((await live.liveCategories())[0].title, "Live events", "the title follows a language switch");
  kino.lang = "es";
  const liga1 = await live.liveChannels({ categoryId: "deportv." + hexEnc("l_liga-1"), cursor: null });
  assert.equal(liga1.items.length, 1);
  assert.equal(k.requests.length, 0, "categories and every league came from the one response");
});

// ═════════════════════════════ shared ═════════════════════════════

test("sports.js keeps its helpers (Fútbol ▸ Canales and the supertv filter depend on them)", () => {
  assert.equal(sports.normCat("ESPAÑA Fútbol"), "espana futbol");
  assert.ok(sports.isSports("ES ▎DEPORTE") && sports.isSports("UK ▎SKY SPORTS+"));
  assert.ok(sports.isFootball("Liga MX") && !sports.isFootball("FORMULA 1"));
});

test("group B connectors keep nothing in module memory (no memo, no module-level promise)", () => {
  for (const f of ["supertv", "xtream", "futbollibre", "deportv", "sports"]) {
    const code = readFileSync(new URL("../src/sources/" + f + ".js", import.meta.url), "utf8");
    assert.ok(!/\bMEM\b|function cached\(|\b_cache\b|\bactiveAcc\b|let\s+_\w+\s*=\s*null/.test(code), f + " keeps a memo");
    assert.ok(!/kino\.fetch\s*\(|kino\.storage\./.test(code), f + " bypasses liveFetch / store.js");
  }
});

test("supertv: event / PPV categories get 1 h / 6 h lists; the framework hands listTtl the stored category (no liveStore import)", async () => {
  const lc = { v: 1, src: { supertv: { at: Date.now(), cats: [{ id: "31", title: "ES ▎EVENTS" }, { id: "1805", title: "ES ▎DEPORTE" }] } } };
  await device({ noFetch: true, storage: { "o2:lc": JSON.stringify(lc) } });
  assert.deepEqual(live.listPolicy(supertv, "31"), { fresh: H, maxStale: 6 * H, code: false });
  assert.deepEqual(live.listPolicy(supertv, "1805"), { fresh: 6 * H, maxStale: D, code: false }, "the framework default");
  assert.deepEqual(live.listPolicy(supertv, "999"), { fresh: 6 * H, maxStale: D, code: false }, "not stored: the default");
  const code = readFileSync(new URL("../src/sources/supertv.js", import.meta.url), "utf8");
  assert.ok(!/liveStore/.test(code), "connectors never read the framework's store directly");
});
