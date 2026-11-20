# Xuper para Kino

*English below.*

Plugin de Kino: películas, series, anime y canales en vivo, con su propia pantalla (Inicio, Fútbol, En vivo y
Ajustes), filas en el Inicio de Kino, búsqueda y reproducción en el reproductor de Kino.

## Xuper 3.1.3

- **Series largas en la búsqueda:** las series con muchas temporadas (como realities de 40+ temporadas) vuelven a mostrar
  todas sus temporadas en la búsqueda, en vez de aparecer como una sola entrada. Las series cortas se siguen mostrando
  como una entrada, con sus temporadas en el selector del detalle.

## Xuper 3.1.2

- **Solo para miembros del grupo de Kino:** si dejas de estar en el grupo de Kino en Telegram, Xuper te muestra una
  pantalla para unirte de nuevo (con un botón al grupo y «Ya me uní, reintentar»), en vez de un error confuso. Cuando
  vuelves al grupo y reintentas, Xuper se reconecta solo. Quien sigue en el grupo no nota ningún cambio.
- **Ir a la búsqueda de Kino:** en la búsqueda de Xuper hay un botón «Buscar en todo Kino» que te lleva a la pantalla de
  búsqueda de Kino, sin tener que escribir nada.

## Xuper 3.1.1

- **Aviso cuando hay que reautenticar:** si Xuper deja de reconocer tu acceso, ahora te deja un aviso en la campanita de
  Inicio de Kino («Reautentícate en Xuper») que al tocarlo te lleva a Xuper, en vez de dejarte descubrirlo solo. Al
  actualizar, Kino te pide aprobar dos permisos nuevos: avisos en la campanita y una tarea en segundo plano (puedes
  dejarla apagada; el aviso igual aparece cuando abres Xuper).

## Xuper 3.1.0

- **Botón «Reautenticar»:** en Ajustes de Xuper hay un botón para volver a conectar tu acceso con tu identidad de Kino,
  sin desconectarte. Sirve cuando Xuper dejó de reconocer tu identidad (lo que antes solo se arreglaba reinstalando). Si
  falla, te dice que revincules tu Telegram en Kino, en vez de dejarte sin saber qué pasó. Una reautenticación que falla
  nunca te desconecta: tu sesión actual se conserva.
- **Descargas otra vez:** vuelve a poder descargarse el contenido (se había perdido esa función). Al actualizar, Kino te
  pide aprobar de nuevo el permiso de descarga.

## Xuper 3.0.10

- **Arreglo de reproducción:** vuelven a reproducirse las películas y series. (Se habían bloqueado porque el servidor de
  video cambió a direcciones que Kino, por seguridad, no dejaba reproducir; ahora están autorizadas.)

## Xuper 3.0.9

- **Mensaje claro cuando falla «Activar»:** si tu permiso de identidad está apagado, Xuper ahora te dice exactamente
  dónde encenderlo (Kino ▸ Ajustes ▸ Plugins ▸ Xuper), en vez del genérico «acepta el permiso» que no ayudaba. Y si el
  problema es del servidor, lo dice claro en vez de culpar al permiso.

## Xuper 3.0.8

- **Diagnóstico de activación más completo:** cuando falla «Activar», se anota el motivo exacto en todos los pasos (de
  forma anónima, sin ningún dato tuyo).

## Xuper 3.0.7

- **Diagnóstico de activación:** cuando falla «Activar», Xuper ahora anota la causa (de forma anónima, sin ningún dato
  tuyo) para poder arreglar el problema de raíz.

## Xuper 3.0.6

- **Películas más precisas:** Xuper le pasa a Kino el id (IMDb) de la película, para que su página muestre el logo, la
  sinopsis y el reparto de la película correcta (antes, con un título ambiguo o con doblaje, Kino podía fijar otra).
- **Un solo resultado por serie también en «Ver más»:** las filas y categorías ya no repiten las temporadas de una serie.

## Xuper 3.0.5

- **Un solo resultado por serie en la búsqueda:** si una serie tiene varias temporadas, la búsqueda vuelve a mostrar un
  único «Lupin» (antes salían «Lupin T1», «Lupin T2», «Lupin T3»); las demás temporadas están a un toque en el selector de
  temporada dentro de la serie.

## Xuper 3.0.4

- **Temporadas y episodios como antes:** las series con varias temporadas vuelven a mostrarse agrupadas por temporada, y
  cada episodio recupera su carátula, su nombre real y su resumen (de TMDB) cuando el portal solo los numera. Si no hay
  datos, el listado queda tal como lo da Xuper.

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

## Xuper 3.1.3

- **Long-running shows in search:** shows with many seasons (like 40-season reality series) again list all their seasons
  in search, instead of showing as a single entry. Short series still show as one entry, with their seasons in the
  detail's season selector.

## Xuper 3.1.2

- **Members of the Kino group only:** if you are no longer in the Kino group on Telegram, Xuper now shows a screen to join
  again (with a button to the group and "I joined — retry") instead of a confusing error. Once you rejoin and retry,
  Xuper reconnects by itself. Someone still in the group sees no change.
- **Go to Kino's search:** Xuper's search has a "Search all of Kino" button that opens Kino's search screen, with nothing to type.

## Xuper 3.1.1

- **A reminder when you need to re-authenticate:** if Xuper stops recognizing your access, it now leaves a notice in
  Kino's Home bell ("Re-authenticate in Xuper") that opens Xuper on a tap, instead of leaving you to find out on your
  own. On update, Kino asks you to approve two new permissions: Home-bell notices and a background task (you can leave it
  off; the notice still appears when you open Xuper).

## Xuper 3.1.0

- **"Re-authenticate" button:** Xuper's Settings now has a button to reconnect your access with your Kino identity,
  without disconnecting. It helps when Xuper stopped recognizing your identity (which used to be fixable only by
  reinstalling). If it fails, it tells you to re-link your Telegram in Kino instead of leaving you guessing. A failed
  re-authentication never disconnects you: your current session is kept.
- **Downloads again:** content can be downloaded once more (the feature had been dropped). On update, Kino asks you to
  approve the download permission again.

## Xuper 3.0.10

- **Playback fix:** movies and series play again. (They had stopped because the video server moved to addresses Kino would
  not play for safety; those addresses are now authorised.)

## Xuper 3.0.9

- **A clear message when "Activate" fails:** if your identity permission is off, Xuper now tells you exactly where to turn
  it on (Kino ▸ Settings ▸ Plugins ▸ Xuper) instead of the generic "grant the permission" that didn't help. And when the
  problem is the server, it says so instead of blaming the permission.

## Xuper 3.0.8

- **Fuller activation diagnostics:** when "Activate" fails, the exact reason is recorded at every step (anonymously, with
  no personal data).

## Xuper 3.0.7

- **Activation diagnostics:** when "Activate" fails, Xuper now records the cause (anonymously, with no personal data) so
  the problem can be fixed at its root.

## Xuper 3.0.6

- **More precise movies:** Xuper hands Kino the film's IMDb id, so its page shows the right film's logo, synopsis and
  cast (an ambiguous or dub-tagged title could pin the wrong one before).
- **One result per series in "See more" too:** rows and categories no longer repeat a series' seasons.

## Xuper 3.0.5

- **One result per series in search:** a series with several seasons shows a single "Lupin" in search again (it used to
  list "Lupin T1", "Lupin T2", "Lupin T3"); the other seasons are one tap away in the season selector inside the title.

## Xuper 3.0.4

- **Seasons and episodes as before:** series with several seasons are grouped by season again, and each episode gets its
  still, real title and overview (from TMDB) where the portal only numbers them. With no data, the list stays exactly as
  Xuper gives it.

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
