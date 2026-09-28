// Xuper -- the Magis portal as a Kino plugin. This script never touches the network itself: every
// call goes to `kino.xuper.*`, which Kino only provides to the plugin installed from exactly
// `xuper-plugin/kino-plugin-xuper` (a fork or a copy gets plain `kino`, without `xuper`). Session,
// portal calls, ranking and stream headers all stay inside the app; what comes back is already in
// the plugin output shape, so each export only unwraps the envelope.
//
// That is also why the manifest's one host is a placeholder: nothing here calls `kino.fetch`.

// Every `kino.xuper.*` call answers `{ ok: true, data }` or `{ ok: false, code, message }`, with
// `code` one of the five standard plugin error codes.
function unwrap(envelope) {
  if (envelope && envelope.ok === true) return envelope.data;
  const code = envelope && envelope.code;
  const message = envelope && envelope.message;
  throw kino.error(code || "unavailable", message || "Xuper no respondió");
}

function xuper() {
  if (!kino.xuper) throw kino.error("unavailable", "Xuper solo funciona instalado desde xuper-plugin/kino-plugin-xuper");
  return kino.xuper;
}

export async function search(query) {
  return unwrap(await xuper().search({
    q: query.q,
    type: query.type ?? null,
    season: query.season ?? 0,
    episode: query.episode ?? 0,
    tmdbId: query.tmdbId ?? 0,
  }));
}

export async function home() {
  return unwrap(await xuper().home());
}

export async function browse(ref, cursor) {
  return unwrap(await xuper().browse(ref, cursor ?? null));
}

export async function episodes(ref) {
  return unwrap(await xuper().episodes(ref));
}

export async function resolve(ref) {
  return unwrap(await xuper().resolve(ref));
}
