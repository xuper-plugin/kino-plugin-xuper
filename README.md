# Xuper plugin for Kino

Xuper (the Magis portal) presented through Kino's plugin lifecycle: install it, disable it, or
uninstall it exactly like any other plugin. Unlike every other plugin, its real network calls never
happen in this script — they run natively, inside Kino itself, gated to this exact repository.

## Why this one is different

Every other Kino plugin gets one thing from the app: `kino.fetch` and a declared, approved list of
hosts it may call. This plugin gets a second, narrower thing instead: `kino.xuper`, five functions
(`search`, `home`, `browse`, `episodes`, `resolve`) that run Xuper's actual portal session, ranking
and stream resolution natively, entirely inside Kino. This script never touches the network — every
export below just unwraps what `kino.xuper` already answered.

`kino.xuper` is only ever handed to the plugin installed from **exactly**
`xuper-plugin/kino-plugin-xuper`. A fork, a copy under a different name, or a repo that only claims the
same manifest `id` gets ordinary `kino`, with no `.xuper` — its `search`/`home`/`browse`/`episodes`/
`resolve` would all fail with `unavailable`. So this repository is not a starting point for your own
plugin the way the other example plugins are; see [Write your own plugin](#write-your-own-plugin)
for those instead.

## What it does

| Capability | How |
| --- | --- |
| `search` | Xuper's real portal search, exactly as it already ranks and filters results, wrapped in the plugin's item shape. |
| `home` | Xuper's real Home rows (the same ones the app's own Home screen reads), each with a `ref` so Kino ends it with a "Ver más" card. |
| `browse` | "Ver más" on a Home row: pages the row's already-fetched items, no new portal call. |
| `episodes` | A series' chapters, cross-referenced with TMDB for stills and synopses when Xuper's portal gives an IMDb id. |
| `resolve` | The real stream Xuper's session resolves, with its session headers attached natively — this script never sees them. |

The manifest's one host is a placeholder: this script never calls `kino.fetch`, so it never reaches
the network on its own.

## Install it in Kino

In Kino open Ajustes > Plugins and type the address of this repository:

```
xuper-plugin/kino-plugin-xuper
```

Kino reads `kino-plugin.json` and `plugin.js` from the repository root. Because this plugin never
declares a host it actually calls, the install screen shows Xuper's own protected-connection notice
instead of a host list.

If you activated Xuper before this plugin existed, Kino installs it for you automatically, once,
with no prompt — it only continues giving you access to a source you already unlocked.

## Write your own plugin

This repository is not that starting point — `kino-plugin-archive` and `kino-plugin-own-server` are.
[`GUIDE.md`](GUIDE.md), [`contract.json`](contract.json), [`kino.d.ts`](kino.d.ts) and [`sdk/`](sdk)
here are the same generic SDK material those repositories ship, kept here only so this plugin's own
`plugin.js` can be linted and run the same way:

```
node sdk/validate.mjs .
```

`sdk/run.mjs`'s calls into `search`/`episodes`/`resolve`/etc. will fail outside the app: the shim has
no real `kino.xuper` to hand them.
