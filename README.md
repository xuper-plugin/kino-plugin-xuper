# Xuper para Kino

*English below.*

Plugin de Kino: películas, series, anime y canales en vivo, con su propia pantalla (Inicio, Fútbol, En vivo y
Ajustes), filas en el Inicio de Kino, búsqueda y reproducción en el reproductor de Kino.

## Xuper 3.0.3

- **Carátulas oficiales:** las películas y series muestran su portada vertical, también en la búsqueda, y se usa la
  portada aunque venga como GIF (antes salía una imagen ancha que se veía rara).
- **Donar desde la TV:** en el televisor, «Apoyar» muestra un código QR para escanear con el celular y donar, en vez de
  un enlace que en la TV no lleva a ningún lado.

## Xuper 3.0.2

- **Aportar, ahora al servidor de Xuper:** con «Aportar una sesión anónima» encendido, de vez en cuando se comparte una
  sesión anónima nueva (nunca la tuya) directamente con el servidor de Xuper, que la ofrece a quien está en una región
  bloqueada. Ya no depende del diagnóstico de Kino. Puedes apagarlo cuando quieras.
- **Sesiones para regiones bloqueadas:** si tu región no está bloqueada, a veces también se prepara una sesión de prueba
  para alguien que sí lo está (como mucho una cada 3 horas).
- **Región bloqueada:** si Xuper no puede funcionar en tu región, ahora lo dice claramente en vez de un error genérico.

## Xuper 3.0.1

- **«Ver más» en cada fila del Inicio de Xuper:** abre todo el contenido de esa fila, no solo sus primeros títulos.
- **Apoyar:** la pantalla de bienvenida y Ajustes tienen un botón para apoyar a Xuper en Ko-fi.

## Xuper 3.0.0

Es una versión nueva por dentro, con el mismo plugin por fuera: mismo nombre, mismo id (`xuper`) y mismo repositorio.

- **Para actualizar** basta con tocar **Actualizar** en Kino ▸ Ajustes ▸ Plugins. Kino muestra lo que pide la versión
  nueva (identidad, conexiones nuevas) y la instala cuando lo apruebas. No hace falta desinstalar nada.
- **Necesita Kino 0.9.88 o más nuevo.** Una versión anterior de Kino sigue con Xuper 2.x y te invita a actualizar Kino.
- **Activación:** la primera vez, abre Xuper desde el menú (o desde Ajustes ▸ Plugins ▸ Xuper ▸ «Abrir Xuper»). Si ya
  usabas Xuper, se conecta solo al abrirlo; si no, toca «Activar».
- **Lo que ya tenías sigue ahí:** «Continuar viendo», el historial, Mis listas y los favoritos de En vivo de la versión
  anterior se siguen reproduciendo, y el ajuste «Aportar una sesión anónima» conserva tu elección.
- La cuenta propia de Xuper y el país de Inicio de la versión anterior ya no se usan.

## Para desarrolladores

| Ruta | Qué es |
|---|---|
| `kino-plugin.json` | El manifiesto (apiVersion 27, firmado). |
| `src/` | El código; `plugin.js` es el paquete que instala Kino (`npm run build`). |
| `test/` | Las pruebas (`npm test`). |
| `tools/` | Empaquetar un `.kinoplugin` (`npm run pack`) y el publicador del catálogo (`tools/README-publish.md`). |

```bash
npm install
npm run build       # src/ → plugin.js
npm test
# Firma, después del último cambio a plugin.js o a la versión (la llave del autor nunca entra al repositorio):
node <kit>/seal.mjs --sign --repo xuper-plugin/kino-plugin-xuper --manifest kino-plugin.json --key <llave del autor>
```

`plugin.js` y `kino-plugin.json` se guardan byte por byte (`.gitattributes`): la firma cubre los bytes exactos que
sirve `raw.githubusercontent.com`.

Este plugin se mantiene de forma independiente de Kino. Kino no aloja ni controla su contenido.

---

# Xuper for Kino

A Kino plugin: movies, series, anime and live channels, with its own screen (Home, Football, Live and Settings), rows
on Kino's Home, search, and playback in Kino's player.

## Xuper 3.0.3

- **Proper covers:** movies and series show their vertical poster, search included, and the cover is used even when it
  comes as a GIF (before, a wide image showed up and looked off).
- **Donate from the TV:** on a television, "Support" shows a QR code to scan with your phone and donate, instead of a
  link that leads nowhere on a TV.

## Xuper 3.0.2

- **Contribute, now to Xuper's server:** with "Share an anonymous session" on, now and then a new anonymous session
  (never yours) is shared directly with Xuper's server, which offers it to people in a blocked region. It no longer
  depends on Kino's diagnostics. You can turn it off at any time.
- **Sessions for blocked regions:** if your region is not blocked, sometimes a trial session is also prepared for
  someone whose region is (at most one every 3 hours).
- **Blocked region:** when Xuper cannot work in your region, it now says so clearly instead of a generic error.

## Xuper 3.0.1

- **"See more" on every row of Xuper's Home:** opens the row's whole content, not just its first titles.
- **Support:** the welcome screen and Settings have a button to support Xuper on Ko-fi.

## Xuper 3.0.0

New on the inside, the same plugin on the outside: same name, same id (`xuper`) and same repository.

- **To update**, tap **Update** in Kino ▸ Settings ▸ Plugins. Kino shows what the new version asks for (identity, new
  connections) and installs it once you approve. Nothing needs to be uninstalled.
- **Needs Kino 0.9.88 or newer.** An older Kino keeps Xuper 2.x and invites you to update Kino.
- **Activation:** the first time, open Xuper from the menu (or from Settings ▸ Plugins ▸ Xuper ▸ "Open Xuper"). If you
  already used Xuper, it connects by itself when it opens; otherwise tap "Activate".
- **What you had is still there:** "Continue watching", the history, My lists and the Live favourites of the previous
  version keep playing, and the "Share an anonymous session" setting keeps your choice.
- The previous version's own Xuper account and Home country are no longer used.

## For developers

| Path | What it is |
|---|---|
| `kino-plugin.json` | The manifest (apiVersion 27, signed). |
| `src/` | The code; `plugin.js` is the bundle Kino installs (`npm run build`). |
| `test/` | The tests (`npm test`). |
| `tools/` | Packing a `.kinoplugin` (`npm run pack`) and the catalog publisher (`tools/README-publish.md`). |

```bash
npm install
npm run build       # src/ → plugin.js
npm test
# Sign after the last change to plugin.js or the version (the author key never enters the repository):
node <kit>/seal.mjs --sign --repo xuper-plugin/kino-plugin-xuper --manifest kino-plugin.json --key <author key>
```

`plugin.js` and `kino-plugin.json` are stored byte for byte (`.gitattributes`): the signature covers the exact bytes
`raw.githubusercontent.com` serves.

This plugin is maintained independently of Kino. Kino neither hosts nor controls its content.
