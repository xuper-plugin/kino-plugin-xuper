// xuper's all-channels column ("Todos los canales de Xuper", v.all.xuper): v6/getLiveData pages of 250, often more pages
// than one screen tick can fetch. On the Redmi (2026-11-17) every pick and "Reintentar" ended "cut by this call's budget
// (deadline), nothing stored yet": each page took ~8.5 s to decode in pure JS and nothing partial was kept. Now the
// answer decodes with Kino's native crypto, and a cut listing keeps its pages so far (shown at once) and goes on in the
// next tick or call from where it stopped. On a virtual clock (test/helpers/virtual-kino.mjs): its own test file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { res } from "./helpers/fake-kino.mjs";
import { installVirtualKino } from "./helpers/virtual-kino.mjs";

const vk = installVirtualKino({ storage: { "o2:bearer": "bearer-token" } });
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { screen, screenEvent } = await import("../src/screen.js");
const xuperMod = await import("../src/sources/xuper.js");
const { encryptBody, decryptBlob } = await import("../src/sources/xuper-crypto.js");
const xuper = xuperMod.default;

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";
const SN = "abcdef0123456789";
const ALL = "76182";            // the portal's "ChannelList" column (xuper.3736313832 on the Redmi)
const CAT = "v.all.xuper";
const PAGE = 250;
const M = 60_000, H = 60 * M;

/** A fresh device: the Bearer, the portal secret, the device's own anonymous session and xuper's categories stored. */
function fresh() {
  vk.reset();
  vk.clearStore();
  const now = vk.now();
  vk.store.set("o2:bearer", "bearer-token");
  vk.store.set("o2:xcfg", JSON.stringify({ magisKey: KEY, email: "", password: "", at: now }));
  vk.store.set("o2:xsn", JSON.stringify({ sn: SN, at: now }));
  vk.store.set("o2:xsess", JSON.stringify({ sn: SN, userId: "anon", userToken: "tok", at: now }));
  ls._resetMemory();
  xuperMod._resetSession();
  live._setSources([xuper]);
  beginCall();
  ls.setCats("xuper", [{ id: ALL, title: { es: "Todos", en: "All channels" } }, { id: "31", title: "Colombia" }]);
  ls.flushMeta();
}

/** A fake Magis portal (real 3DES wire): the all-channels column holds `total` channels; each answer takes `ms`. */
function portal(total, ms = 2000) {
  const pages = [];
  vk.setRoute((url, init) => {
    const m = /\/api\/portalCore\/(.+)$/.exec(url);
    if (!m) return { ms: 10, res: res(404, "") };
    const bean = JSON.parse(decryptBlob(init.body, KEY));
    if (m[1] !== "v6/getLiveData") return { ms, res: res(200, JSON.stringify({ returnCode: "0", data: encryptBody("{}", KEY) })) };
    pages.push(bean.pageNum);
    const from = (bean.pageNum - 1) * PAGE;
    const n = Math.max(0, Math.min(PAGE, total - from));
    const channelList = Array.from({ length: n }, (_, i) => ({ channelCode: "ch" + (from + i), name: "Canal " + (from + i) }));
    return { ms, res: res(200, JSON.stringify({ returnCode: "0", data: encryptBody(JSON.stringify({ channelList }), KEY) })) };
  });
  return pages;
}

/** One screen event as its own plugin call. */
async function event(name, state, value) {
  vk.requests.length = 0;
  beginCall();
  const t0 = vk.now();
  const out = await vk.run(() => screenEvent({ name, state, value }));
  return { out, heldMs: vk.now() - t0, reqs: vk.requests.length };
}
async function draw(state) {
  beginCall();
  return vk.run(() => screen({ state, device: "phone" }));
}
const timersOf = (tree) => (Array.isArray(tree.every) ? tree.every : tree.every ? [tree.every] : []).map((t) => t.event);
async function shown() {
  beginCall();
  const st = await live.screenList(CAT);
  return st.items ? st.items.length : null;
}

test("the all-channels column loads on the own screen: the pick keeps its pages so far, the next tick goes on from there", async () => {
  fresh();
  const pages = portal(1100);   // 5 pages: 250 × 4 + 100
  const pick = await event("liveCat", { nav: "vivo" }, CAT);
  assert.ok(pick.heldMs <= 8500, "the pick stays inside its 8 s: " + pick.heldMs);
  assert.equal(pick.out.state.lvTried, undefined, "not marked failed: what was fetched is shown");
  assert.deepEqual(pages, [1, 2, 3, 4], "pages 1–3 arrived, the 4th was cut by the pick's deadline");
  assert.equal(await shown(), 750, "the 750 channels so far are on screen at once");
  const parts = JSON.parse(vk.store.get("o2:xpart"));
  assert.deepEqual({ page: parts[ALL].page, n: parts[ALL].n }, { page: 4, n: 750 }, "where to go on");

  const state = { nav: "vivo", liveCat: CAT };
  const v = await draw(state);
  assert.ok(timersOf(v).includes("lvRefresh"), "the tick is due: the list is a listing cut short");
  assert.ok(!JSON.stringify(v).includes("No se pudieron cargar los canales"), "no failure banner");

  pages.length = 0;
  const tick = await event("lvRefresh", state);
  assert.deepEqual(pages, [4, 5], "the tick goes on from page 4, never page 1 again");
  assert.ok(tick.heldMs <= 6500, "the tick stays inside its 6 s: " + tick.heldMs);
  assert.equal(await shown(), 1100, "the whole column");
  assert.equal(vk.has("o2:xpart"), false, "the resume point is gone once the listing is whole");
  beginCall();
  assert.equal(ls.listMeta("xuper." + Buffer.from(ALL).toString("hex")).p, false, "a whole list is no longer marked cut");
  assert.deepEqual(tick.out.state.lvTried, { [CAT]: true }, "nothing left: the tick switches itself off");

  // stored and fresh: drawing, the tick's redraw and Kino's own listing make no request
  vk.requests.length = 0;
  const after = await draw({ ...state, ...tick.out.state });
  assert.ok(!timersOf(after).includes("lvRefresh"));
  beginCall();
  const kinoList = await vk.run(() => live.liveChannels({ categoryId: CAT }));
  assert.equal(kinoList.items.length, 500, "Kino's first page of 500");
  assert.ok(kinoList.next, "and a cursor for the rest");
  assert.equal(vk.requests.length, 0, "0 requests once stored and fresh");
});

test("ticks keep going while each one adds channels (one page a tick on a slow network), at most 5 per opening", async () => {
  fresh();
  const pages = portal(1600, 3500);   // 7 pages; a page takes 3.5 s: one per tick
  const pick = await event("liveCat", { nav: "vivo" }, CAT);
  assert.deepEqual(pages, [1, 2, 3], "the pick: two pages, the third cut");
  assert.equal(await shown(), 500);
  let state = { nav: "vivo", liveCat: CAT, ...pick.out.state };
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const v = await draw(state);
    if (!timersOf(v).includes("lvRefresh")) break;
    pages.length = 0;
    const t = await event("lvRefresh", state);
    seen.push({ pages: pages.slice(), n: await shown() });
    state = { ...state, ...t.out.state };
  }
  assert.ok(seen.length <= 5, "at most LV_MAX_TICKS ticks: " + seen.length);
  assert.ok(seen.every((s, i) => i === 0 || s.n > seen[i - 1].n), "each tick added channels");
  assert.equal(seen.flatMap((s) => s.pages).filter((p) => p === 1).length, 0, "page 1 is never asked again");
  assert.equal(seen[seen.length - 1].n, 1600, "the whole column");
});

test("Kino's own En vivo goes on with a cut listing and serves its channels so far when cut again (never a failure)", async () => {
  fresh();
  let pages = portal(1100);
  await event("liveCat", { nav: "vivo" }, CAT);
  assert.equal(await shown(), 750);
  pages.length = 0;
  beginCall();
  const first = await vk.run(() => live.liveChannels({ categoryId: CAT }));
  assert.deepEqual(pages, [4, 5], "Kino's listing goes on from page 4");
  assert.equal(first.items.length, 500);
  assert.equal(await shown(), 1100);

  // a column too big for Kino's call too: its listing is cut again and Kino still gets the channels so far
  fresh();
  pages = portal(4000, 3000);   // 16 pages of 3 s
  await event("liveCat", { nav: "vivo" }, CAT);
  assert.equal(await shown(), 500);
  pages.length = 0;
  beginCall();
  const again = await vk.run(() => live.liveChannels({ categoryId: CAT }));
  assert.equal(pages[0], 3, "from page 3");
  assert.ok(pages.length >= 3, "several more pages in Kino's call: " + pages.join(","));
  assert.equal(again.items.length, 500, "Kino gets a page, not a failure");
  const n = await shown();
  assert.ok(n > 500 && n < 4000, "the channels so far grew: " + n);
  assert.equal(JSON.parse(vk.store.get("o2:xpart"))[ALL].n, n, "and where to go on");
});

test("a whole list being refreshed is never replaced by a cut one: it stays, served stale, and no resume point is kept", async () => {
  fresh();
  portal(1100);
  await event("liveCat", { nav: "vivo" }, CAT);
  await event("lvRefresh", { nav: "vivo", liveCat: CAT });
  assert.equal(await shown(), 1100);
  vk.advance(25 * H);   // past xuper's 24 h fresh
  const pages = portal(1100);
  const t = await event("lvRefresh", { nav: "vivo", liveCat: CAT });
  assert.ok(pages.length >= 2 && pages[0] === 1, "a refresh starts at page 1");
  assert.ok(pages.length < 5, "and is cut by the tick's 3 s");
  assert.equal(await shown(), 1100, "the whole stale list stays");
  assert.equal(vk.has("o2:xpart"), false);
  assert.ok(t.out.state.lvTried, "the tick stops: no progress");
});

test("a resume point whose stored list no longer matches starts again from page 1", async () => {
  fresh();
  const pages = portal(1100);
  await event("liveCat", { nav: "vivo" }, CAT);
  const parts = JSON.parse(vk.store.get("o2:xpart"));
  parts[ALL].n = 999;   // the stored list holds 750
  vk.store.set("o2:xpart", JSON.stringify(parts));
  pages.length = 0;
  await event("lvRefresh", { nav: "vivo", liveCat: CAT });
  assert.equal(pages[0], 1, "from page 1");
});

test("portal answers decode with Kino's native 3DES when it has it (same text as the pure path), else the pure path", () => {
  const wire = encryptBody(JSON.stringify({ channelList: [{ channelCode: "a", name: "Señal Ñ" }] }), KEY);
  const want = decryptBlob(wire, KEY);
  const was = vk.kino.crypto.decrypt;
  try {
    const calls = [];
    vk.kino.crypto.decrypt = (alg, o) => {
      calls.push({ alg, keyEncoding: o.keyEncoding, inputEncoding: o.inputEncoding, outputEncoding: o.outputEncoding });
      const d = createDecipheriv(alg, Buffer.from(o.key, "hex"), null);
      return Buffer.concat([d.update(Buffer.from(o.data, "base64")), d.final()]).toString("utf8");
    };
    assert.equal(xuperMod.openBlob(wire, KEY), want);
    assert.deepEqual(calls, [{ alg: "des-ede3-ecb", keyEncoding: "hex", inputEncoding: "base64", outputEncoding: "utf8" }]);
    vk.kino.crypto.decrypt = () => { throw Object.assign(new Error("unknown cipher"), { code: "crypto_error" }); };
    assert.equal(xuperMod.openBlob(wire, KEY), want, "a Kino refusing it: the pure path");
    delete vk.kino.crypto.decrypt;
    assert.equal(xuperMod.openBlob(wire, KEY), want, "a Kino without decrypt: the pure path");
  } finally {
    if (was) vk.kino.crypto.decrypt = was; else delete vk.kino.crypto.decrypt;
  }
});
