// The `migrate` capability: claims the values Kino saved while Xuper was native (library titles,
// their chapters, live favorites) and answers them in this plugin's own terms. Pure: no network,
// no storage. Only refs this plugin can read (`magis1:` and the legacy gateway form) and the
// native live provider key are claimed; everything else is `null`, which the app remembers.
import { decode, encode, encodeChapter } from "./refs.js";

/** The provider key the app files native Xuper live favorites/recents under (LiveChannelKeys.XUPER). */
export const LIVE_PROVIDER = "xuper";

// The contract's item id (itemIdPattern): what search/home emit as `id` and liveChannels as a code.
const ITEM_ID = /^[A-Za-z0-9._~-]{1,128}$/;
const MAX_NUMBER = 99999; // contract maxEpisodeNumber
const MAX_SEASON = 999; // contract maxSeasonNumber

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const whole = (v, max) => (Number.isInteger(v) && v >= 1 && v <= max ? v : null);

// A ref this plugin owns, as refs.decode reads it; never the app's own `plg1:` wrapper.
function ownRef(ref) {
  if (typeof ref !== "string" || ref.startsWith("plg1:")) return null;
  return decode(ref);
}

function title(input) {
  const magis = ownRef(input.ref);
  if (!magis || !ITEM_ID.test(magis.contentId)) return null;
  // The same ref search()/home() emit for a title: the chapter number is not part of a title.
  return {
    kind: magis.isSeries ? "series" : "movie",
    id: magis.contentId,
    ref: encode({ contentId: magis.contentId, programType: magis.programType, episode: 0 }),
  };
}

function chapter(input) {
  const magis = ownRef(input.ref);
  if (!magis || !ITEM_ID.test(magis.contentId)) return null;
  // The number the ref carries is what resolve() looks the chapter up by, so it wins; a ref that
  // says "first chapter" (<= 0) takes the number the app saved next to it.
  // None at all: resolve() reads "no chapter" (<= 0) as the first one (findChapter), so 1 is faithful.
  const number = whole(magis.episode, MAX_NUMBER) ?? whole(input.episode, MAX_NUMBER) ?? 1;
  const out = { kind: "episode", ref: encodeChapter(number, magis.contentId), number };
  const season = whole(input.season, MAX_SEASON);
  if (season !== null) out.season = season;
  return out;
}

function live(input) {
  if (input.provider !== LIVE_PROVIDER) return null;
  return typeof input.code === "string" && ITEM_ID.test(input.code) ? { kind: "live", code: input.code } : null;
}

export function makeMigrate() {
  async function migrate(input) {
    await null;
    try {
      if (!isObject(input)) return null;
      if (input.kind === "title") return title(input);
      if (input.kind === "chapter") return chapter(input);
      if (input.kind === "live") return live(input);
      return null;
    } catch (_) {
      return null; // a value this plugin cannot read is simply not its own
    }
  }
  return { migrate };
}
