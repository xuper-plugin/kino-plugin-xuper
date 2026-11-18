// The live tabs' channel grid (src/screenView.js channelBody) as tests read it: a lazy ListView of tiles keyed
// `<p>Grid[-<category>][-p<page>]`, each tile the plugin's card (its tap a go.play) or, for an 18+ channel, Kino's titleCard.

function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k], fn);
}

/** The channel grid of live tab `p` ("vivo" | "sp") in `tree`, or undefined. */
export function gridOf(tree, p) {
  let out;
  walk(tree, (n) => {
    if (!out && n.type === "ListView" && typeof n.key === "string" && (n.key === p + "Grid" || n.key.startsWith(p + "Grid-"))) out = n;
  });
  return out;
}

/** The tiles the grid draws now (none without a grid). */
export const tilesOf = (tree, p) => { const g = gridOf(tree, p); return g ? g.items : []; };

/** The channel a tile plays: `{ id, ref, title, kind, poster?, adult? }` (a card's go.play and its logo, or a titleCard's item). */
export function tileChannel(t) {
  if (t.type === "titleCard") return { ...t.item };
  const play = t.onTap.go.play;
  const logo = t.children[0];
  return { id: play.id, ref: play.ref, title: play.title, kind: play.kind, ...(logo.url ? { poster: logo.url } : {}) };
}

/** The channels the grid of live tab `p` draws now, in order. */
export const channelsOf = (tree, p) => tilesOf(tree, p).map(tileChannel);
