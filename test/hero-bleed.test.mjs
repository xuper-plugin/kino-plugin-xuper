// The catalog's hero runs edge to edge (owner, 2026-11-22): the list has no side padding, every other item carries the
// page's side room as its own margin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

globalThis.kino = { lang: "es", config: {} };
const { catalogView } = await import("../src/screenView.js");
const { SECTIONS } = await import("../src/config.js");
const TAB = SECTIONS[0].name;

const item = (id) => ({ id: String(id), kind: "movie", title: "T" + id, poster: "https://img.example.com/" + id + ".jpg", ref: "vod:" + id });
const view = {
  slides: [{ id: "1", title: "Uno", image: "https://img.example.com/b1.jpg", ref: "vod:1", kind: "movie" },
    { id: "2", title: "Dos", image: "https://img.example.com/b2.jpg", ref: "vod:2", kind: "movie" }],
  rails: [{ title: "Estrenos", items: [item(1), item(2)] }, { title: "Acción", items: [item(3)] }],
  genres: [],
};
const list = (v) => v.body.children.find((n) => n.type === "ListView");

test("the list has no side padding; the hero has no margin; every other item has the side margin", () => {
  const l = list(catalogView({ tab: TAB, view, device: "phone" }));
  assert.deepEqual(l.padding, { compact: { bottom: 12 }, expanded: { bottom: 24 } });
  const [hero, ...rest] = l.items;
  assert.equal(hero.type, "PageView");
  assert.equal(hero.margin, undefined, "the hero touches both edges");
  assert.ok(rest.length >= 2);
  for (const n of rest) assert.deepEqual(n.margin, { compact: { x: 12 }, expanded: { x: 24 } }, n.key);
});

test("the loading skeleton's hero block is edge to edge too, its rails inset", () => {
  const l = list(catalogView({ tab: TAB, view: null, device: "phone" }));
  assert.equal(l.items[0].key, "heroSkel");
  assert.equal(l.items[0].margin, undefined);
  for (const n of l.items.slice(1)) assert.ok(n.margin, n.key);
});

const KIT = process.env.KINO_SCREEN_KIT || "C:/dev/kino-app/plugins/sdk/screen.mjs";
test("Kino's screen rules keep every node and every margin (ES/EN × phone/TV)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  for (const lang of ["es", "en"]) for (const device of ["phone", "tv"]) {
    globalThis.kino.lang = lang;
    for (const v of [view, null]) {
      const r = checkScreenTree(catalogView({ tab: TAB, view: v, device }), lang, undefined, { apiVersion: 30 });
      assert.deepEqual(r.dropped, [], `${lang} ${device}`);
      const logs = JSON.stringify(r.logs || r.log || []);
      assert.doesNotMatch(logs, /margin|padding/i, `no spacing dropped (${lang} ${device}): ${logs}`);
    }
  }
  globalThis.kino.lang = "es";
});
