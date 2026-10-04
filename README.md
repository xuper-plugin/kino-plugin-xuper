# Xuper plugin for Kino

A plain Kino plugin (SDK apiVersion 6, Kino 0.9.50 or newer): movies, series and live channels,
with its account settings in Ajustes ▸ Xuper. Everything runs inside the plugin's own sandbox,
through the hosts its manifest declares.

- `src/` — sources; `plugin.js` is the bundle Kino installs (`npm run build`).
- `test/` — the test suite (`npm test`).
- `sdk/` — the Kino plugin kit (validator, local runner).

This plugin is maintained independently of Kino. Kino neither hosts nor controls its content.
