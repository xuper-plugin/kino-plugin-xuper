// A portal season that TMDB splits into several (2.2.30). The portal lists "Dragon Ball Kai" as T1 with 98 chapters and T2 with 69,
// TMDB as seasons of ~26: crossing a chapter's number with TMDB's season of the same number is wrong, so the plugin refused to attach
// stills when the totals differ. When SEVERAL CONSECUTIVE TMDB seasons add up to EXACTLY the portal season's declared total, at season
// boundaries and in one way only, the portal's chapters are those seasons' chapters in order, and the stills can be crossed by their
// continuous number. Anything else (no exact sum, more than one way) is no run: the caller attaches nothing, as before.

/** `[{ season, count }]` of a TMDB /tv/{id} answer: the real seasons (1 and up) that have chapters, in order. `null` when it is not an object. */
export function parseSeasonCounts(body) {
  const o = typeof body === "string" ? safeParse(body) : body;
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  const seasons = Array.isArray(o.seasons) ? o.seasons : [];
  const out = [];
  for (const s of seasons) {
    if (s === null || typeof s !== "object") continue;
    const season = Number(s.season_number);
    const count = Number(s.episode_count);
    if (Number.isInteger(season) && season >= 1 && Number.isInteger(count) && count > 0) out.push({ season, count });
  }
  out.sort((a, b) => a.season - b.season);
  return out;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

/**
 * The consecutive TMDB seasons, `[{ season, count }]` in order, whose counts add up to exactly `total`, or `null`.
 * `portalSeason` 1 starts at TMDB's first season; a later one may start at any season boundary, and counts only when ONE run adds up.
 */
export function pickSeasonRun(counts, total, portalSeason) {
  if (!Array.isArray(counts) || counts.length === 0 || !Number.isInteger(total) || total <= 0) return null;
  const runs = [];
  const starts = portalSeason === 1 ? [0] : counts.map((_, i) => i);
  for (const from of starts) {
    let sum = 0;
    for (let i = from; i < counts.length; i++) {
      sum += counts[i].count;
      if (sum === total) { runs.push(counts.slice(from, i + 1)); break; }
      if (sum > total) break;
    }
  }
  return runs.length === 1 ? runs[0] : null;
}
