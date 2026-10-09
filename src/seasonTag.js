// The season tag the portal puts in a title ("T2", "Temp. 2", "Temporada 2", "S2"), as a regex source with the number in a
// capture group. Its own module so search.js and titleClean.js can both read it without importing each other.
const B = "(?<![\\p{L}\\p{N}_])";
const E = "(?![\\p{L}\\p{N}_])";
export const SEASON_SOURCE = `(?:${B}T\\s?([0-9]{1,2})${E}|${B}Temp\\.?\\s?([0-9]{1,2})${E}|${B}Temporada\\s?([0-9]{1,2})${E}|${B}S([0-9]{1,2})${E})`;
