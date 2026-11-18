// 1.0.46: supertv's live channels from 2–3 independent panels — the connectors (src/sources/supertv.js, xtream.js)
// through the framework (src/live.js). The world: the VegetaTV bootstrap and Xtream panels answering with the REAL
// categories of 9 panels (test/fixtures/stv-panels.json; users and passwords are made up). From the Mac's network
// line.znn8.xyz answers 302 to the Coljuegos block page and capitanhero.com's account is dead (auth 0), as measured.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { decodeRef } = await import("../src/refs.js");
const stvMod = await import("../src/sources/supertv.js");
const { accountKey } = await import("../src/sources/panels.js");
const supertv = stvMod.default, { supertv2, supertv3 } = stvMod;

const M = 60_000, H = 60 * M;
const PANELS = JSON.parse(readFileSync(new URL("./fixtures/stv-panels.json", import.meta.url), "utf8")).panels;
const DAZN = JSON.parse(readFileSync(new URL("./fixtures/stv-dazn.json", import.meta.url), "utf8"));
const BOOT = "vegetatvv2.duckdns.org";
const PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6,\nseg1.ts\n";
// The bootstrap's order as the Mac sees it (fv99 and the LatAm panels on port 8080).
const MAC = ["line.znn8.xyz", "line.zee-ott.xyz", "line.krishkaz.com", "fv99.nesewvp.top:8080", "pp.tresinl.xyz", "capitanhero.com",
  "line.tmpes.com", "ltv.ddns.net:8080", "reborned.cc:8080", "nexotvplus.com:8080", "myultratv.com:8080"];
const hostOf = (u) => { try { return new URL(u).hostname; } catch (_) { return ""; } };
const accOf = (servers, h) => { const i = servers.indexOf(h); return { url: "http://" + h, username: "u" + i, password: "p" + i }; };

/**
 * The bootstrap + panels. `modes[hostname]`: "block" (302 to coljuegos), "auth0", "down" (timeout), "list403" (lists
 * refused with 403, categories answer), or a function (url) → response; `stream(url)` answers the playlists.
 */
function world(o = {}) {
  const servers = o.servers || MAC;
  const modes = { "line.znn8.xyz": "block", "capitanhero.com": "auth0", "avefenixtv.com": "auth0", ...(o.modes || {}) };
  const text = servers.map((h, i) => `http://${h}/get.php?username=u${i}&password=p${i}&type=m3u_plus 🏳`).join("\n");
  return async (url, init) => {
    const u = new URL(url);
    if (u.host === BOOT) {
      if (u.searchParams.get("servers") === "1") return res(200, text, { "content-type": "text/plain" });
      return res(200, JSON.stringify({ ok: true, minimum_version_code: 25, latest_version_code: 25, servers_text: "", servers_url: `http://${BOOT}/bootstrap.php?servers=1` }));
    }
    if (u.pathname === "/player_api.php") {
      const mode = modes[u.hostname] || "ok";
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
        return res(200, JSON.stringify(rows.map(([stream_id, name]) => ({ stream_id, name, category_id: cat }))));
      }
    }
    if (u.pathname.startsWith("/live/")) return o.stream ? o.stream(url) : res(200, PLAYLIST);
    return undefined;
  };
}

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
function nextCall(k, { cold = false, routes } = {}) {
  ls.flushMeta();
  if (cold) ls._resetMemory();
  if (routes) { const store = Object.fromEntries(k.store); return device({ routes, storage: store }); }
  beginCall();
  k.requests.length = 0;
  k.writes.length = 0;
  k.logs.length = 0;
  return k;
}
const stv = (k) => JSON.parse(k.store.get("o2:stv"));
const stvs = (k) => JSON.parse(k.store.get("o2:stvs") || "{}");
const api = (k, action) => k.requests.filter((r) => r.url.includes("action=" + action));
const hostsOf = (reqs) => reqs.map((r) => hostOf(r.url));
/** Ages every stamp of the live meta and the slot memory by `ms` (the clock moved on). */
function age(k, ms) {
  const lm = JSON.parse(k.store.get("o2:lm"));
  for (const kind of ["c", "l"]) for (const e of Object.values(lm[kind])) { for (const f of ["at", "failAt", "w"]) if (e[f]) e[f] -= ms; }
  k.store.set("o2:lm", JSON.stringify(lm));
  const lc = JSON.parse(k.store.get("o2:lc"));
  for (const e of Object.values(lc.src)) e.at -= ms;
  k.store.set("o2:lc", JSON.stringify(lc));
  const s = stvs(k);
  for (const n of ["prim", "s2", "s3"]) if (s[n] && s[n].at) { s[n].at -= ms; if (s[n].soft) s[n].soft.at -= ms; }
  if (s.bad) for (const key of Object.keys(s.bad)) s.bad[key] -= ms;
  k.store.set("o2:stvs", JSON.stringify(s));
  const v = stv(k);
  if (v.acct) v.acct.at -= ms;
  if (v.boot) v.boot.at -= ms;
  k.store.set("o2:stv", JSON.stringify(v));
}
const membersOf = (c) => (c.ref.startsWith("M:") ? decodeRef(c.ref).members.map((m) => m.ref) : [c.ref]);

test.afterEach(() => live._setSources(null));

test("first install: 1.0.45's requests (bootstrap + one batch of 6), the same primary, both secondary panels from that batch at no extra request", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  const k = await device({ routes: [world()] });
  const cats = await live.liveCategories();
  assert.equal(k.requests.filter((r) => hostOf(r.url) === BOOT).length, 2);
  assert.deepEqual(hostsOf(api(k, "get_live_categories")), MAC.slice(0, 6).map((h) => h.split(":")[0]), "one batch; every account probed once");
  assert.equal(k.requests.length, 2 + 6);
  // the primary as 1.0.45 picks it (znn8 is blocked here); o2:stv keeps exactly 1.0.45's shape
  assert.equal(stv(k).acct.server, "http://line.zee-ott.xyz");
  assert.deepEqual(Object.keys(stv(k)).sort(), ["acct", "boot"]);
  // the slots: fv99 (5 Spanish categories) and tresinl (2); krishkaz is zee-ott's panel, never held
  const s = stvs(k);
  assert.equal(s.s2.server, "http://fv99.nesewvp.top:8080");
  assert.equal(s.s3.server, "http://pp.tresinl.xyz");
  assert.ok(s.s2.sk && s.s3.sk && s.prim.sk, "panel sketches kept");
  assert.equal(s.prim.a, accountKey(accOf(MAC, "line.zee-ott.xyz")));
  assert.equal(s.prim.main, "v.sp.es");
  assert.ok(Object.keys(s.bad).length >= 3, "znn8 (blocked), krishkaz (zee-ott's panel), capitanhero (auth 0) are not probed again for a day");
  assert.ok(JSON.stringify(s).length < 6000, "o2:stvs " + JSON.stringify(s).length + " bytes");
  // their categories: no event, PPV or replay category
  const lc = JSON.parse(k.store.get("o2:lc")).src;
  assert.deepEqual(lc.supertv2.cats.map((c) => c.title).slice(0, 5), ["ES | LALIGA VIP", "ES | UEFA Liga de Campeones", "ES | DEPORTES VIP", "ES |  Baloncesto ACB VIP", "ES | UFC"]);
  assert.ok(lc.supertv3.cats.some((c) => c.title === "ESPAÑA DAZN") && !lc.supertv3.cats.some((c) => /EVENTOS/.test(c.title)));
  // no new category: the exposed ids are those of supertv alone
  live._setSources([supertv]);
  const k1 = await device({ routes: [world()] });
  assert.deepEqual(cats.map((c) => c.id), (await live.liveCategories()).map((c) => c.id));
  assert.equal(k1.requests.length, 8);
});

test("the phone (znn8 reachable): primary znn8 as 1.0.45 picks it; slots fv99 and zee-ott (best fit first); krishkaz, zee-ott's panel, is never a third", async () => {
  // znn8's own categories: the 30 the phone stored (┃ES┃ naming, its own ids)
  const REAL = JSON.parse(readFileSync(new URL("./fixtures/live-categories-121.json", import.meta.url), "utf8")).categories;
  PANELS["line.znn8.xyz"] = REAL.filter((c) => c.src === "supertv").map((c) => [c.rawId, c.title]);
  try {
    const servers = ["capitanhero.com", "line.znn8.xyz", "line.zee-ott.xyz", "line.krishkaz.com", "fv99.nesewvp.top:8080", "pp.tresinl.xyz", "line.tmpes.com"];
    live._setSources([supertv, supertv2, supertv3]);
    const k = await device({ routes: [world({ servers, modes: { "line.znn8.xyz": "ok" } })] });
    const cats = await live.liveCategories();
    assert.equal(k.requests.length, 2 + 6);
    assert.equal(stv(k).acct.server, "http://line.znn8.xyz");
    assert.equal(stvs(k).s2.server, "http://fv99.nesewvp.top:8080", "5 more Spanish categories");
    assert.equal(stvs(k).s3.server, "http://line.zee-ott.xyz", "4 more, and Netherlands, Germany, UK");
    assert.deepEqual(cats.map((c) => c.id).sort(), ["v.events", "v.sp.de", "v.sp.es", "v.sp.eu", "v.sp.gb", "v.sp.nl"]);
  } finally { delete PANELS["line.znn8.xyz"]; }
});

test("stored and fresh: liveCategories and Kino's first page of 'Deportes · España' make 0 requests; a channel merges across two panels", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  k = nextCall(k, { cold: true });
  await live.liveCategories();
  assert.equal(k.requests.length, 0);
  assert.deepEqual(k.writes, []);
  // the first listing loads the primary's lists, then the other panels' inside the 2.5 s budget
  k = nextCall(k, { cold: true });
  const page = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  const byHost = new Map();
  for (const h of hostsOf(api(k, "get_live_streams"))) byHost.set(h, (byHost.get(h) || 0) + 1);
  assert.ok(byHost.get("line.zee-ott.xyz") >= 4 && byHost.get("fv99.nesewvp.top") >= 1 && byHost.get("pp.tresinl.xyz") >= 1, JSON.stringify([...byHost]));
  assert.equal(api(k, "get_live_categories").length, 0, "a list never probes a slot first");
  const d1 = page.items.find((c) => c.title === "DAZN 1 FHD");
  assert.deepEqual([...new Set(membersOf(d1).map((r) => decodeRef(r).source))], ["supertv", "supertv3"], "zee-ott's copies, then tresinl's");
  assert.ok(membersOf(d1).every((r) => r.length < 120));
  // every row is one of the primary's: a channel only the other panels list is not listed (its id and ref would encode
  // the slot's account, which changes on any refusal: a favourite of it could never survive)
  assert.ok(page.items.length > 0 && page.items.every((c) => membersOf(c).some((r) => decodeRef(r).source === "supertv")));
  // every list stored and fresh: 0 requests, 0 list writes
  k = nextCall(k, { cold: true });
  const again = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.equal(k.requests.length, 0);
  assert.deepEqual(again.items.map((c) => c.id), page.items.map((c) => c.id));
  assert.ok(!k.writes.some((w) => w.startsWith("o2:ll:") || w === "o2:stvs" || w === "o2:stv"), JSON.stringify(k.writes));
});

test("resolve: every copy on the primary's account refused (407): its account is passed over and the same channel on another panel plays at the first open (3 probes); the preheat never hops", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  const refused = (url) => (hostOf(url) === "line.zee-ott.xyz" ? Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" }) : res(200, PLAYLIST));
  let k = await device({ routes: [world({ stream: refused })] });
  await live.liveCategories();
  k = nextCall(k);
  const page = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  const ref = page.items.find((c) => c.title === "DAZN 1 FHD").ref;
  k = nextCall(k, { cold: true });
  const out = await live.resolveLive(ref);
  assert.equal(hostOf(out.url), "pp.tresinl.xyz", "the other panel's copy plays");
  const probes = k.requests.filter((r) => r.url.includes("/live/"));
  assert.deepEqual(hostsOf(probes), ["line.zee-ott.xyz", "line.zee-ott.xyz", "pp.tresinl.xyz"], "zee-ott's HD copy (same account) first: one refused stream says nothing about the next");
  assert.ok(k.logs.some((l) => /supertv does not answer \(probe\); supertv does not answer \(probe\); supertv3 ok/.test(l)), k.logs.join("\n"));
  assert.match(out.label, /^SuperTV Deportes 3/);
  // the zapping preheat of a healthy channel (no refusal): the plain order, no probe beyond the first, no demotion
  k = nextCall(k, { cold: true, routes: [world()] });
  live._setSources([supertv, supertv2, supertv3]);
  const k2 = await k;
  const first = await live.resolveLive(ref);
  assert.equal(hostOf(first.url), "line.zee-ott.xyz");
  beginCall();
  const pre = await live.resolveLive(ref);
  assert.equal(pre.url, first.url, "re-resolved by the preheat: the same member");
  assert.equal(ls.demotedAt(membersOf({ ref })[0]), 0);
  assert.ok(k2.requests.filter((r) => r.url.includes("/live/")).length <= 2);
});

// The phone's ┃ES┃ M+ DEPORTES FHD HEVC (M#12vfqp2, 8 members): 4 copies on the primary's znn8 account, then fv99's
// (slot 2) and zee-ott's (slot 3). znn8 refuses member 1 with 407 while member 2 plays 1080p; fv99's copy answers the
// probe with a 302 and the player then gets a body that is no playlist and 403.
const ZNN = { url: "http://line.znn8.xyz", username: "u1", password: "p1" };
const FV = { url: "http://fv99.nesewvp.top:8080", username: "u3", password: "p3" };
const ZEE = { url: "http://line.zee-ott.xyz", username: "u2", password: "p2" };
const memberRef = (src, acc, sid) => "L:" + src + ":" + encodeURIComponent([acc.url, acc.username, acc.password, sid].join("\u0001"));
const MDEP = [memberRef("supertv", ZNN, 101), memberRef("supertv", ZNN, 102), memberRef("supertv", ZNN, 103), memberRef("supertv", ZNN, 104),
  memberRef("supertv2", FV, 501), memberRef("supertv2", FV, 502), memberRef("supertv3", ZEE, 701), memberRef("supertv3", ZEE, 702)];
const MDEP_REF = "M:" + MDEP.map((r) => r.slice(2)).join(",");
const proxyAuth = () => Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" });
const sidOf = (url) => new URL(url).pathname.split("/").pop().split(".")[0];
/**
 * The stream answers: znn8's `refuse` streams 407 (or `znn(sid)` when given), the rest a playlist; fv99 a 302 (or
 * `fv`: "ok"); zee-ott a playlist (or `zee`: "redirect").
 */
const mdepStreams = (refuse, fv = "redirect", zee = "ok", znn = null) => (url) => {
  if (!new URL(url).pathname.startsWith("/live/")) return undefined;
  const h = hostOf(url);
  const redirect = () => res(302, "", { Location: "http://203.0.113.9:8080/live/x.m3u8" });
  if (h === "line.znn8.xyz") return znn ? znn(sidOf(url)) : refuse.has(sidOf(url)) ? proxyAuth() : res(200, PLAYLIST);
  if (h === "fv99.nesewvp.top") return fv === "ok" ? res(200, PLAYLIST) : redirect();
  return zee === "ok" ? res(200, PLAYLIST) : redirect();
};
const probed = (k) => k.requests.filter((r) => r.url.includes("/live/")).map((r) => hostOf(r.url) + ":" + sidOf(r.url));
const playedSid = (out) => sidOf(out.url);

test("B-M1 (the phone's M+ DEPORTES): a 407 on member 1 plays member 2 at the first open, never another panel's copy; Kino's cut chain on member 2 plays members 3 / 4 before any other panel", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  const clock = { now: Date.now() };
  const realNow = Date.now;
  Date.now = () => clock.now;
  try {
    let k = await device({ routes: [mdepStreams(new Set(["101"]))] });
    // fresh process: member 1 refused (407, its stream only), member 2 on the same account plays — as 1.0.45 did
    let out = await live.resolveLive(MDEP_REF);
    assert.equal(playedSid(out), "102");
    assert.deepEqual(probed(k), ["line.znn8.xyz:101", "line.znn8.xyz:102"], "fv99's copy is never tried");
    assert.ok(ls.demotedAt(MDEP[0]) > 0 && ls.demotedAt(MDEP[1]) === 0);
    assert.ok(k.logs.some((l) => /supertv does not answer \(probe\); supertv ok in \d+ ms \(2 of 8\)/.test(l)), k.logs.join("\n"));
    // Kino cuts member 2 (an upstream 509 after it played) and reopens: the first reopen re-checks it (it answers a probe:
    // it plays again), the next one in a row demotes it — one strike against the account, whose next copy plays
    clock.now += 14_000;
    k = nextCall(k);
    assert.equal(playedSid(await live.resolveLive(MDEP_REF)), "102");
    clock.now += 80_000;
    k = nextCall(k);
    out = await live.resolveLive(MDEP_REF);
    assert.equal(playedSid(out), "103", "member 3, not fv99's copy");
    assert.ok(ls.demotedAt(MDEP[1]) > 0);
    assert.deepEqual(probed(k), ["line.znn8.xyz:103"]);
    assert.ok(!out.alternatives.slice(0, 1).some((a) => /fv99|supertv2/.test(a.ref)), "the next alternative is member 4");
  } finally { Date.now = realNow; }
});

test("B-M1: after a cut chain, a second refused copy passes the account over; another panel's copy then plays before member 4 only when its own probe says ok", async () => {
  for (const [fv, zee] of [["redirect", "redirect"], ["redirect", "ok"], ["ok", "ok"]]) {
    live._setSources([supertv, supertv2, supertv3]);
    const clock = { now: Date.now() };
    const realNow = Date.now;
    Date.now = () => clock.now;
    try {
      // member 2 played and Kino's chain demotes it; member 3 is refused too (407): two strikes on znn8's account
      let k = await device({ routes: [mdepStreams(new Set(["101", "103"]), fv, zee)] });
      assert.equal(playedSid(await live.resolveLive(MDEP_REF)), "102");
      clock.now += 3_000; k = nextCall(k);
      assert.equal(playedSid(await live.resolveLive(MDEP_REF)), "102", "re-checked: it answers");
      clock.now += 5_000; k = nextCall(k);
      const out = await live.resolveLive(MDEP_REF);
      if (fv === "redirect" && zee === "redirect") {
        // neither other panel's probe can tell (302): one check per account (fv99's 502 is not probed after 501), then
        // member 4 plays on its own probe; the other panels' copies keep their turn after it
        assert.equal(playedSid(out), "104");
        assert.deepEqual(probed(k), ["line.znn8.xyz:103", "fv99.nesewvp.top:501", "line.zee-ott.xyz:701", "line.znn8.xyz:104"]);
        assert.ok(k.logs.some((l) => /supertv2 not confirmed \(unknown\), after the others; supertv3 not confirmed \(unknown\), after the others/.test(l)), k.logs.join("\n"));
        assert.equal(ls.demotedAt(MDEP[4]), 0, "not demoted: nothing was refused");
        assert.equal(ls.demotedAt(MDEP[6]), 0);
      } else if (fv === "redirect") {
        // fv99's probe cannot tell (302); zee-ott's copy answers a playlist: confirmed, it plays before member 4
        assert.equal(hostOf(out.url), "line.zee-ott.xyz");
        assert.equal(playedSid(out), "701");
        assert.deepEqual(probed(k), ["line.znn8.xyz:103", "fv99.nesewvp.top:501", "line.zee-ott.xyz:701"]);
        assert.equal(ls.demotedAt(MDEP[4]), 0, "not demoted: nothing was refused");
      } else {
        // fv99's copy answers a playlist: confirmed, it plays before member 4
        assert.equal(hostOf(out.url), "fv99.nesewvp.top");
        assert.deepEqual(probed(k), ["line.znn8.xyz:103", "fv99.nesewvp.top:501"]);
      }
    } finally { Date.now = realNow; }
  }
});

test("review D2: the primary's account dead (every znn8 stream 401 or 407): the first open plays the third panel's confirmed copy, never an unprobed copy on the account passed over", async () => {
  for (const [label, znn] of [["401", () => res(401, "")], ["407 on 1-3", (sid) => (sid === "104" ? res(200, PLAYLIST) : proxyAuth())]]) {
    live._setSources([supertv, supertv2, supertv3]);
    // fv99 answers a redirect (as on the phone), zee-ott a playlist
    const k = await device({ routes: [mdepStreams(new Set(), "redirect", "ok", znn)] });
    const out = await live.resolveLive(MDEP_REF);
    assert.equal(hostOf(out.url), "line.zee-ott.xyz", label);
    assert.equal(playedSid(out), "701", label);
    // two refusals pass znn8 over; fv99's check cannot tell, so fv99's 502 waits; zee-ott's check says ok. The early
    // checks do not take the members' probes (PROBE_MAX), and member 3 is never served unprobed
    assert.deepEqual(probed(k), ["line.znn8.xyz:101", "line.znn8.xyz:102", "fv99.nesewvp.top:501", "line.zee-ott.xyz:701"], label);
    assert.ok(k.logs.some((l) => /supertv2 not confirmed \(unknown\), after the others; supertv3 ok in \d+ ms \(7 of 8\)/.test(l)), k.logs.join("\n"));
    assert.ok(ls.demotedAt(MDEP[0]) > 0 && ls.demotedAt(MDEP[1]) > 0 && ls.demotedAt(MDEP[2]) === 0, label);
    assert.equal(ls.demotedAt(MDEP[4]), 0, label + ": fv99's copy is not demoted (nothing refused it)");
    // the same open with neither other panel able to tell (both redirect): one check per account, then member 3 is
    // probed (the third member probe: the early checks took none) and refused; member 4 plays in its turn, the probes
    // spent (at most PROBE_MAX member probes + AUDITIONS_MAX early checks per resolve)
    const k2 = await device({ routes: [mdepStreams(new Set(), "redirect", "redirect", znn)] });
    live._setSources([supertv, supertv2, supertv3]);
    const blind = await live.resolveLive(MDEP_REF);
    assert.deepEqual(probed(k2), ["line.znn8.xyz:101", "line.znn8.xyz:102", "fv99.nesewvp.top:501", "line.zee-ott.xyz:701", "line.znn8.xyz:103"], label);
    assert.equal(hostOf(blind.url), "line.znn8.xyz", label);
    assert.equal(playedSid(blind), "104", label);
    assert.equal(ls.demotedAt(MDEP[4]) + ls.demotedAt(MDEP[6]), 0, label + ": a redirect refuses nothing");
  }
});

test("B-M1: a secondary panel's copy that played and is cut is demoted by Kino's chain like any member", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  const clock = { now: Date.now() };
  const realNow = Date.now;
  Date.now = () => clock.now;
  try {
    // both znn8 copies refused: fv99's copy plays in its own turn (it redirects: its probe cannot tell)
    const ref = "M:" + [MDEP[0], MDEP[1], MDEP[4], MDEP[6]].map((r) => r.slice(2)).join(",");
    let k = await device({ routes: [mdepStreams(new Set(["101", "102"]))] });
    let out = await live.resolveLive(ref);
    assert.equal(hostOf(out.url), "fv99.nesewvp.top");
    assert.deepEqual(probed(k), ["line.znn8.xyz:101", "line.znn8.xyz:102", "fv99.nesewvp.top:501"]);
    // the player gets 403 and Kino reopens twice: the second in a row demotes it, and zee-ott's copy plays
    clock.now += 3_000; k = nextCall(k);
    assert.equal(hostOf((await live.resolveLive(ref)).url), "fv99.nesewvp.top", "re-check: its redirect cannot tell");
    clock.now += 5_000; k = nextCall(k);
    out = await live.resolveLive(ref);
    assert.ok(ls.demotedAt(MDEP[4]) > 0, "fv99's copy demoted");
    assert.equal(hostOf(out.url), "line.zee-ott.xyz");
  } finally { Date.now = realNow; }
});

test("migration from 1.0.45 ({boot, acct} only): Kino's liveCategories makes 0 requests; the screen's tick probes the remembered primary once and one batch of ≤ 5, both slots assigned; then 0 requests", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  const cats = await live.liveCategories();
  // 1.0.45's storage: its o2:stv and registry, no o2:stvs, no slot categories
  const lc = JSON.parse(k.store.get("o2:lc"));
  delete lc.src.supertv2; delete lc.src.supertv3;
  const lm = JSON.parse(k.store.get("o2:lm"));
  delete lm.c.supertv2; delete lm.c.supertv3;
  const old = { "o2:stv": k.store.get("o2:stv"), "o2:lc": JSON.stringify(lc), "o2:lm": JSON.stringify(lm) };
  k = await device({ routes: [world()], storage: old });
  // En vivo never waits for the other panels' search: nothing they add is a category
  assert.deepEqual((await live.liveCategories()).map((c) => c.id), cats.map((c) => c.id));
  assert.equal(k.requests.length, 0);
  k = nextCall(k, { cold: true });
  await live.fillScreenCategories();
  assert.equal(k.store.get("o2:stv"), old["o2:stv"], "the remembered primary is byte for byte 1.0.45's");
  const probes = hostsOf(api(k, "get_live_categories"));
  assert.equal(probes[0], "line.zee-ott.xyz", "one reference probe of the primary, its account kept");
  assert.equal(probes.filter((h) => h === "line.zee-ott.xyz").length, 1);
  assert.ok(probes.length <= 6, probes.join(" "));
  assert.equal(k.requests.filter((r) => hostOf(r.url) === BOOT).length, 0, "the stored server list, never the bootstrap");
  assert.equal(stvs(k).s2.server, "http://fv99.nesewvp.top:8080");
  assert.equal(stvs(k).s3.server, "http://pp.tresinl.xyz");
  // both slots filled their categories in that one tick
  k = nextCall(k, { cold: true });
  assert.deepEqual(await live.fillScreenCategories(), { n: 0, left: 0 });
  await live.liveCategories();
  assert.equal(k.requests.length, 0);
});

/** A 1.0.45 storage from this one: o2:stv, the registry and the primary's lists; nothing of the other panels. */
function as1045(k) {
  const lc = JSON.parse(k.store.get("o2:lc"));
  delete lc.src.supertv2; delete lc.src.supertv3;
  const lm = JSON.parse(k.store.get("o2:lm"));
  delete lm.c.supertv2; delete lm.c.supertv3;
  for (const key of Object.keys(lm.l)) if (/^supertv[23]\./.test(key)) delete lm.l[key];
  const out = {};
  for (const [key, v] of k.store) if (key !== "o2:stvs" && key !== "o2:bearer" && !/^o2:ll:supertv[23]\./.test(key)) out[key] = v;
  return { ...out, "o2:lc": JSON.stringify(lc), "o2:lm": JSON.stringify(lm) };
}
/** The clock moved on by `ms` for the live meta (lists, categories) and, with `acct`, the primary's account check. */
function ageLive(k, ms, { acct = true } = {}) {
  const lm = JSON.parse(k.store.get("o2:lm"));
  for (const kind of ["c", "l"]) for (const e of Object.values(lm[kind])) { for (const f of ["at", "failAt", "w"]) if (e[f]) e[f] -= ms; }
  k.store.set("o2:lm", JSON.stringify(lm));
  const lc = JSON.parse(k.store.get("o2:lc"));
  for (const e of Object.values(lc.src)) e.at -= ms;
  k.store.set("o2:lc", JSON.stringify(lc));
  const v = stv(k);
  if (acct) v.acct.at -= ms;
  v.boot.at -= ms;
  k.store.set("o2:stv", JSON.stringify(v));
}

test("B-M2: updating from 1.0.45 with Kino's own calls only: the first page that already goes to the network with the primary's 6 h re-check assigns both slots (≤ 5 candidate probes after its lists); stored and fresh stays 0 requests", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  k = nextCall(k);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  const old = as1045(k);
  const acct = JSON.parse(old["o2:stv"]).acct;
  // the update: Kino's En vivo and 'Deportes · España', every list fresh: 0 requests, no search
  k = await device({ routes: [world()], storage: old });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveCategories();
  const fresh = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.equal(k.requests.length, 0, "stored and fresh: 0 requests");
  assert.ok(!k.store.has("o2:stvs"));
  // 7 h later, the lists are stale but the account was checked 1 h ago (a list loaded then): the primary's panel is not
  // known yet (1.0.45 never noted it) and a lean search never probes the primary for it: 0 candidate probes
  ageLive(k, 7 * H);
  const v = stv(k); v.acct.at = Date.now() - H; k.store.set("o2:stv", JSON.stringify(v));
  k = nextCall(k, { cold: true });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveCategories();
  assert.equal(k.requests.length, 0, "Kino's En vivo: 0 requests");
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.ok(api(k, "get_live_streams").length > 0, "its stale lists refresh");
  assert.equal(api(k, "get_live_categories").length, 0, "no reference probe, no candidate");
  assert.ok(!stvs(k).s2 && !stvs(k).s3);
  // 7 h more: the next page re-checks the primary (its 6 h) — the reference comes free — and searches after its lists
  ageLive(k, 7 * H);
  k = nextCall(k, { cold: true });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveCategories();
  assert.equal(k.requests.length, 0, "Kino's En vivo: 0 requests");
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  const probes = hostsOf(api(k, "get_live_categories"));
  assert.equal(probes[0], "line.zee-ott.xyz", "the primary's own 6 h re-check");
  assert.equal(probes.filter((h) => h === "line.zee-ott.xyz").length, 1);
  assert.ok(probes.length - 1 <= 5, "candidates: " + probes.slice(1).join(" "));
  const lastList = k.requests.map((r) => r.url).findLastIndex((u) => u.includes("get_live_streams"));
  const firstCandidate = k.requests.findIndex((r) => r.url.includes("get_live_categories") && hostOf(r.url) !== "line.zee-ott.xyz");
  assert.ok(firstCandidate > lastList, "the search starts after every list of the page");
  assert.equal(k.requests.filter((r) => hostOf(r.url) === BOOT).length, 0, "never the bootstrap");
  assert.equal(stvs(k).s2.server, "http://fv99.nesewvp.top:8080");
  assert.equal(stvs(k).s3.server, "http://pp.tresinl.xyz");
  assert.deepEqual([stv(k).acct.server, stv(k).acct.user, stv(k).acct.pass], [acct.server, acct.user, acct.pass], "the primary's account untouched");
  // the next listing loads their lists (inside its budget) and the channels gain copies on the other panels
  k = nextCall(k, { cold: true });
  live._setSources([supertv, supertv2, supertv3]);
  const page = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.ok(api(k, "get_live_streams").some((r) => hostOf(r.url) === "fv99.nesewvp.top"));
  assert.equal(api(k, "get_live_categories").length, 0);
  assert.ok(page.items.some((c) => membersOf(c).some((r) => decodeRef(r).source !== "supertv")), "copies on the other panels");
  assert.deepEqual(page.items.map((c) => c.id), fresh.items.map((c) => c.id), "the same rows as 1.0.45's");
  // stored and fresh again: 0 requests
  k = nextCall(k, { cold: true });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveCategories();
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.equal(k.requests.length, 0);
});

test("no fit among what the primary probed: 0 extra requests at first install; the next fill probes exactly one batch; none → 0 requests for 1 h", async () => {
  // only panels that cannot serve: zee-ott's own (krishkaz, tmpes), dead accounts, and Latin American panels with one
  // Spanish category at most (they add fewer than 2 to the primary's 'Deportes · España')
  const servers = ["line.znn8.xyz", "line.zee-ott.xyz", "line.krishkaz.com", "line.tmpes.com", "capitanhero.com", "avefenixtv.com", "ltv.ddns.net:8080", "reborned.cc:8080"];
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world({ servers })] });
  await live.liveCategories();
  assert.equal(k.requests.length, 2 + 6, "the first install pays nothing for the slots");
  assert.equal(stvs(k).s2, undefined);
  // 11 min later (past the categories' 10 min backoff), only the slots are missing: Kino's liveCategories never searches,
  // the screen's tick probes one batch of new candidates
  age(k, 11 * M);
  k = nextCall(k, { cold: true });
  await live.liveCategories();
  assert.equal(k.requests.length, 0);
  await live.fillScreenCategories();
  const probed = hostsOf(api(k, "get_live_categories"));
  assert.deepEqual(probed, ["ltv.ddns.net", "reborned.cc"], "the two not probed (or marked) yet, once each");
  assert.deepEqual(stvs(k).s2, { none: 1, at: stvs(k).s2.at, n: 1 });
  assert.deepEqual(stvs(k).s3, { none: 1, at: stvs(k).s3.at, n: 1 });
  assert.ok(k.logs.some((l) => /no other panel fits \(2 probed\); next search in 1 h/.test(l)));
  // inside its 1 h: nothing probed (the framework's own backoff calls cost 0 requests too)
  for (const ms of [11 * M, 31 * M]) {
    age(k, ms);
    k = nextCall(k, { cold: true });
    await live.fillScreenCategories();
    await live.liveCategories();
    assert.equal(k.requests.length, 0);
  }
});

test("a slot whose lists are refused: one probe of its account; refused → released (its lists dropped, no search inside a listing); the next fill finds another panel", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  k = nextCall(k);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  // 7 h later fv99 refuses its account (lists 403, categories auth 0)
  age(k, 7 * H);
  const fv = (u) => (u.searchParams.get("action") === "get_live_streams" ? res(403, "") : res(200, JSON.stringify({ user_info: { auth: 0 } })));
  k = await nextCall(k, { cold: true, routes: [world({ modes: { "fv99.nesewvp.top": fv } })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.equal(api(k, "get_live_categories").filter((r) => hostOf(r.url) === "fv99.nesewvp.top").length, 1, "its account re-probed once");
  assert.ok(!api(k, "get_live_categories").some((r) => !["fv99.nesewvp.top", "line.zee-ott.xyz", "pp.tresinl.xyz"].includes(hostOf(r.url))), "no candidate probed inside a listing");
  assert.deepEqual(stvs(k).s2, { none: 1, at: stvs(k).s2.at, n: 0 });
  assert.ok(stvs(k).bad[accountKey(accOf(MAC, "fv99.nesewvp.top:8080"))]);
  ls.flushMeta();
  assert.ok(!Object.keys(JSON.parse(k.store.get("o2:lm")).l).some((key) => key.startsWith("supertv2.") && JSON.parse(k.store.get("o2:lm")).l[key].h), "its lists are dropped");
  // the screen's next fill: one batch of the candidates not marked yet, another independent panel that fits (nexotvplus or
  // myultratv: 4 Spanish categories each)
  k = await nextCall(k, { cold: true, routes: [world({ modes: { "fv99.nesewvp.top": fv } })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.fillScreenCategories();
  assert.deepEqual(hostsOf(api(k, "get_live_categories")), ["line.tmpes.com", "ltv.ddns.net", "reborned.cc", "nexotvplus.com", "myultratv.com"],
    "never the primary, fv99 (refused) or the first batch's (marked); tmpes is zee-ott's panel: probed, not taken");
  assert.ok(["http://nexotvplus.com:8080", "http://myultratv.com:8080"].includes(stvs(k).s2.server), JSON.stringify(stvs(k).s2));
  assert.equal(stvs(k).s3.server, "http://pp.tresinl.xyz", "slot 3 untouched");
});

test("a slot's list that fails while its account answers fails that list only; unreachable twice 10 min apart releases it; this call's own limits never count", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  const flaky = (u) => (u.searchParams.get("action") === "get_live_streams" ? res(500, "") : undefined);
  age(k, 7 * H);
  k = await nextCall(k, { cold: true, routes: [world({ modes: { "fv99.nesewvp.top": flaky } })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.equal(stvs(k).s2.server, "http://fv99.nesewvp.top:8080", "its account answered the probe: kept");
  // unreachable (timeouts): marked once, released only by a second time 10 min or more later. Inside Kino's first-page
  // budget a timeout is the budget's own (never counted); its "Recargar" (the same first page again) has no budget.
  const down = { modes: { "fv99.nesewvp.top": "down" } };
  const listTwice = async () => {
    await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
    beginCall();
    await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  };
  age(k, 11 * M);
  k = await nextCall(k, { cold: true, routes: [world(down)] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.ok(!stvs(k).s2.soft, "a timeout under the first page's budget is not counted");
  beginCall();
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.ok(stvs(k).s2.soft, "marked unreachable once");
  assert.equal(stvs(k).s2.server, "http://fv99.nesewvp.top:8080");
  age(k, 11 * M);
  k = await nextCall(k, { cold: true, routes: [world(down)] });
  live._setSources([supertv, supertv2, supertv3]);
  await listTwice();
  assert.equal(stvs(k).s2.none, 1, "a second time, 11 min later: released");
  assert.ok(!stvs(k).bad[accountKey(accOf(MAC, "fv99.nesewvp.top:8080"))], "unreachable is not refused: not marked bad");
});

test("the primary re-picked onto a slot's panel: that slot is released at once and leaves every category with 0 requests", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  // zee-ott's panel goes down (zee-ott, krishkaz, tmpes): the primary's next pick lands on fv99, slot 2's account
  const gone = { "line.zee-ott.xyz": "down", "line.krishkaz.com": "down", "line.tmpes.com": "down" };
  age(k, 7 * H);
  k = await nextCall(k, { cold: true, routes: [world({ modes: gone })] });
  live._setSources([supertv, supertv2, supertv3]);
  await supertv.categories({ dropLists() {} });
  assert.equal(stv(k).acct.server, "http://fv99.nesewvp.top:8080");
  assert.equal(stvs(k).s2.none, 1, "released at the pick");
  assert.equal(supertv2.active(), false);
  assert.equal(supertv3.active(), true, "tresinl stays: another panel");
  k = nextCall(k, { cold: true });
  live._setSources([supertv, supertv2, supertv3]);
  const reqs = k.requests.length;
  assert.equal(supertv2.active(), false);
  assert.equal(k.requests.length, reqs);
});

test("accountOf names the account a channel plays from; the kill switch on supertv switches its panels off too", async () => {
  const raw = "http://pp.tresinl.xyz\u0001u4\u0001p4\u000196";
  assert.equal(supertv3.accountOf(raw), "http://pp.tresinl.xyz|u4");
  assert.equal(supertv.accountOf("bad"), null);
  assert.equal(supertv2.secondaryOf, "supertv");
  assert.equal(supertv.secondaryOf, undefined);
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  k = nextCall(k);
  const page = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  const ref = page.items.find((c) => c.title === "DAZN 1 FHD").ref;
  k.store.set("o2:ix", JSON.stringify({ schema: 2, live: { off: ["supertv"] } }));
  k = nextCall(k, { cold: true });
  assert.deepEqual(await live.liveCategories(), []);
  await assert.rejects(() => live.resolveLive(ref), /fuente de canal desconocida/);
  assert.equal(k.requests.length, 0);
});

// ── the review of 2026-11-17 (each test failed before its fix) ──

const refuseAccount = (u) => (u.searchParams.get("action") === "get_live_streams" ? res(403, "") : res(200, JSON.stringify({ user_info: { auth: 0 } })));
/** Every get_live_streams of a fixture panel asks one of that panel's own category ids. */
function listsAskOwnCategories(k) {
  for (const r of api(k, "get_live_streams")) {
    const h = hostOf(r.url), cat = new URL(r.url).searchParams.get("category_id");
    if (PANELS[h]) assert.ok(PANELS[h].some(([id]) => String(id) === cat), h + " asked for category " + cat + ", which it does not have");
  }
}

test("a slot's search commits only the slot that asked: the other free slot never gets an account behind its old panel's categories (F1)", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  k = nextCall(k);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  // 7 h later fv99 and tresinl refuse their accounts in one listing: both slots released, their lists dropped; their
  // categories stay stored
  age(k, 7 * H);
  const modes = { "fv99.nesewvp.top": refuseAccount, "pp.tresinl.xyz": refuseAccount };
  k = await nextCall(k, { cold: true, routes: [world({ modes })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.deepEqual([stvs(k).s2.none, stvs(k).s3.none], [1, 1]);
  assert.ok(JSON.parse(k.store.get("o2:lc")).src.supertv3.cats.length > 0, "tresinl's categories are still stored");
  // supertv3 waits in its categories backoff: the screen's tick fills supertv2 alone, whose search finds two panels
  ls.failCats("supertv3");
  k = await nextCall(k, { cold: true, routes: [world({ modes })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.fillScreenCategories();
  assert.ok(stvs(k).s2.server, "slot 2 took an account");
  assert.deepEqual(stvs(k).s3, { none: 1, at: stvs(k).s3.at, n: 0 }, "slot 3 is not committed by slot 2's search");
  assert.equal(supertv3.active(), false);
  // past its backoff supertv3 fills itself: its account and that account's categories, together
  age(k, 11 * M);
  k = await nextCall(k, { cold: true, routes: [world({ modes })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.fillScreenCategories();
  const host3 = hostOf(stvs(k).s3.server);
  assert.ok(host3 && host3 !== hostOf(stvs(k).s2.server));
  const own = new Set(PANELS[host3].map(([id]) => String(id)));
  assert.ok(JSON.parse(k.store.get("o2:lc")).src.supertv3.cats.every((c) => own.has(String(c.id))), "supertv3's stored categories are " + host3 + "'s");
  // the listing asks each panel only for its own categories
  k = nextCall(k, { cold: true });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.ok(api(k, "get_live_streams").some((r) => hostOf(r.url) === host3));
  listsAskOwnCategories(k);
});

test("the primary's pick lands on a slot's account while another slot searches: no crash, every slot's record sane, the primary's account never marked bad (F2)", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  k = nextCall(k);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  // tresinl refuses: slot 3 released
  age(k, 7 * H);
  k = await nextCall(k, { cold: true, routes: [world({ modes: { "pp.tresinl.xyz": refuseAccount } })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.equal(stvs(k).s3.none, 1);
  // 25 h later zee-ott's panel answers 503 (zee-ott, krishkaz, tmpes): liveCategories fills supertv, supertv2 and
  // supertv3 together, and the primary's pick lands on fv99, slot 2's account
  age(k, 25 * H);
  const busy = () => res(503, "");
  const modes = { "pp.tresinl.xyz": refuseAccount, "line.zee-ott.xyz": busy, "line.krishkaz.com": busy, "line.tmpes.com": busy };
  k = await nextCall(k, { cold: true, routes: [world({ modes })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.liveCategories();
  assert.equal(stv(k).acct.server, "http://fv99.nesewvp.top:8080");
  assert.ok(!k.logs.some((l) => /Cannot read properties/.test(l)), k.logs.filter((l) => /failed/.test(l)).join("\n"));
  assert.deepEqual([stvs(k).s2.none, stvs(k).s3.none], [1, 1], "nothing on another panel answered in the pick's batch");
  assert.ok(!stvs(k).bad[accountKey(accOf(MAC, "fv99.nesewvp.top:8080"))], "the primary's own account is not refused");
  assert.ok(stvs(k).bad[accountKey(accOf(MAC, "line.znn8.xyz"))], "the batch's verdicts are kept");
  // the screen's next tick finds two other panels
  age(k, 11 * M);
  k = await nextCall(k, { cold: true, routes: [world({ modes })] });
  live._setSources([supertv, supertv2, supertv3]);
  await live.fillScreenCategories();
  assert.deepEqual([hostOf(stvs(k).s2.server), hostOf(stvs(k).s3.server)].sort(), ["myultratv.com", "nexotvplus.com"]);
});

test("a 5xx or an answer that is not JSON (a captive portal) is not a refusal: the slot is marked unreachable, never released at once, its account never marked bad (F5)", async () => {
  for (const answer of [() => res(503, "Service Unavailable"), () => res(200, "<html><body>Hotel Wi-Fi: sign in</body></html>", { "content-type": "text/html" })]) {
    live._setSources([supertv, supertv2, supertv3]);
    let k = await device({ routes: [world()] });
    await live.liveCategories();
    k = nextCall(k);
    await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
    age(k, 7 * H);
    k = await nextCall(k, { cold: true, routes: [world({ modes: { "fv99.nesewvp.top": answer } })] });
    live._setSources([supertv, supertv2, supertv3]);
    await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
    assert.ok(api(k, "get_live_categories").some((r) => hostOf(r.url) === "fv99.nesewvp.top"), "its list failed: its account was checked");
    assert.equal(stvs(k).s2.server, "http://fv99.nesewvp.top:8080", "kept");
    assert.ok(stvs(k).s2.soft, "marked unreachable once");
    assert.ok(!stvs(k).bad || !stvs(k).bad[accountKey(accOf(MAC, "fv99.nesewvp.top:8080"))], "not refused");
    ls.flushMeta();
    assert.ok(Object.entries(JSON.parse(k.store.get("o2:lm")).l).some(([key, m]) => key.startsWith("supertv2.") && m.h), "its lists are kept");
  }
  // behind the portal every candidate a search probes is unreachable: marked for 6 h, never refused for a day
  live._setSources([supertv, supertv2, supertv3]);
  const portal = () => res(200, "<html>sign in</html>", { "content-type": "text/html" });
  const servers = ["line.znn8.xyz", "line.zee-ott.xyz", "ltv.ddns.net:8080", "reborned.cc:8080", "nexotvplus.com:8080", "myultratv.com:8080"];
  let k = await device({ routes: [world({ servers, modes: { "line.znn8.xyz": "ok", "ltv.ddns.net": portal, "reborned.cc": portal, "nexotvplus.com": portal, "myultratv.com": portal } })] });
  await live.liveCategories();
  age(k, 11 * M);
  k = nextCall(k, { cold: true });
  await live.fillScreenCategories();
  const marks = stvs(k);
  for (const h of ["ltv.ddns.net:8080", "reborned.cc:8080", "nexotvplus.com:8080", "myultratv.com:8080"]) {
    const key = accountKey(accOf(servers, h));
    assert.ok(marks.slow && marks.slow[key], h + " marked unreachable");
    assert.ok(!marks.bad || !marks.bad[key], h + " not refused");
  }
});

test("the screen's ticks at first install: the primary and both slots in one tick (bootstrap + one batch), the batch's refusals kept; the next tick 0 requests (perf-F4)", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.fillScreenCategories();
  assert.equal(k.requests.length, 2 + 6);
  assert.equal(stv(k).acct.server, "http://line.zee-ott.xyz");
  assert.equal(stvs(k).s2.server, "http://fv99.nesewvp.top:8080");
  assert.equal(stvs(k).s3.server, "http://pp.tresinl.xyz");
  assert.ok(stvs(k).bad[accountKey(accOf(MAC, "line.znn8.xyz"))] && stvs(k).bad[accountKey(accOf(MAC, "capitanhero.com"))]);
  for (let i = 0; i < 3; i++) {
    k = nextCall(k, { cold: true });
    assert.deepEqual(await live.fillScreenCategories(), { n: 0, left: 0 });
    assert.equal(k.requests.length, 0);
  }
});

test("a search that will not probe (every free slot inside its search backoff) fetches nothing: no bootstrap past 7 days, no reference probe (perf-F3)", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  let k = await device({ routes: [world()] });
  await live.liveCategories();
  // slot 3 found nothing a moment ago (1 h of search backoff); the stored server list is 8 days old
  const s = stvs(k);
  s.s3 = { none: 1, at: Date.now(), n: 1 };
  k.store.set("o2:stvs", JSON.stringify(s));
  const v = stv(k);
  v.boot.at -= 8 * 24 * H;
  k.store.set("o2:stv", JSON.stringify(v));
  k = nextCall(k, { cold: true });
  live._setSources([supertv, supertv2, supertv3]);
  await live.fillScreenCategories();
  assert.deepEqual(k.requests, []);
  assert.deepEqual(stvs(k).s3, s.s3);
});
