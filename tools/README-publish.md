# Publisher de datos de Xuper (desde el Mac)

Este Mac **genera** el catálogo y los partidos de fútbol **localmente**, con el generador (`tools/gen_catalog.py` del
checkout del backend; trial anónimo, nunca con las credenciales de la cuenta), y los **publica en GitHub como
`xuper-plugin`**. No hay servidor, ni endpoint, ni token propio: el plugin solo lee archivos públicos de GitHub.

Se publica en dos lugares:

| Dónde | Qué | Quién lo lee |
|---|---|---|
| Rama `data` de `xuper-plugin/kino-plugin-xuper` (se sirve por `raw.githubusercontent.com`) | `index.json` + `v2/c/<h12>.json` (catálogo) + `v2/m/<h12>.json` (partidos) | Xuper 3.0.0 en adelante (fuente principal cuando existe) |
| Release `catalog` del mismo repo | `home.json` + `matches.json` (formato viejo) | Xuper 3.0.0 en adelante mientras no hay rama `data`, y como respaldo |

## Requisitos

- `gh` con la cuenta **xuper-plugin** iniciada. Comprueba que tiene token (sin imprimirlo):
  ```bash
  gh auth token --user xuper-plugin >/dev/null && echo ok
  ```
  En este Mac hay varias cuentas de `gh`: el publisher **siempre** usa `GH_TOKEN="$(gh auth token --user xuper-plugin)"`
  y, antes de escribir, verifica que `gh api user` responda `xuper-plugin`. No cambies la cuenta activa con
  `gh auth switch`.
- `node` 18 o más nuevo y `python3` con las dependencias del generador.
- `~/.config/xuper-catalog/publish.env` (fuera del repo):
  ```bash
  XUPER_GENERATOR=/path/to/backend          # obligatorio: el checkout que tiene tools/gen_catalog.py
  # opcionales:
  XUPER_PYTHON=/path/to/python3             # si el python con las dependencias no es el python3 del PATH
  XUPER_LIVE_OFF=supertv,xuper              # interruptor de En vivo (ver más abajo); vacío = nada apagado
  XUPER_SMOKE=0                             # salta la comprobación final contra raw.githubusercontent.com
  ```

## Modos

```bash
tools/publish.sh data      # lo que corre launchd cada 2 h (ver abajo)
tools/publish.sh catalog   # solo home.json al Release (uso manual)
tools/publish.sh matches   # solo matches.json al Release (uso manual)
```

Banderas para cualquier modo:

- `--dry-run`: genera, arma, valida y lee GitHub, pero **no escribe nada** en GitHub ni guarda estado. Úsalo antes de
  la primera corrida real.
- `--force`: regenera el catálogo aunque no le toque y sube los assets del Release aunque no hayan cambiado.

`catalog` y `matches` también se saltan la subida cuando el contenido no cambió (usa `--force` para subir igual) y, si
ya existe la otra mitad en `~/.config/xuper-catalog/work/`, pasan por la misma validación que `data`.

### Qué hace `publish.sh data`

1. Toma un candado (`~/.config/xuper-catalog/publish.lock/`). Si otra corrida lo tiene, sale sin hacer nada; un
   candado de más de 30 minutos se considera abandonado y se retoma.
2. Genera los partidos en cada corrida y el catálogo solo cuando le toca: después de las 06:00 y de las 18:00 (hora
   del Mac), o si todavía no hay ninguno.
3. Arma el formato v2 con **el mismo `src/v2.js` que corre en el aparato** (`tools/to-v2.mjs`) y lo valida con los
   límites de Kino. Si un archivo recién generado no pasa, **no se usa** (ni se guarda como último bueno) y sale el
   último bueno; si nada pasa, no se publica nada y los aparatos siguen con lo que tienen.
4. Publica la rama `data` con **un solo commit** por la API de datos de git (`tools/publish-data.mjs`): blobs → tree
   → commit → mover la rama (solo avance rápido). Si el índice no cambió (sin contar `gen`), **no hace commit**, así
   los aparatos siguen recibiendo un 304. El autor y el committer son `xuper-plugin`, sin coautores. Si alguien movió
   la rama mientras tanto (error 422), reintenta una vez desde cero. Al final comprueba que
   `raw.githubusercontent.com` ya sirve el índice nuevo (si tarda, lo dice en el log; el commit queda hecho).
5. Sube al Release solo los assets que cambiaron: compara un hash del contenido **sin `generatedAt`** con el de la
   última subida. Así un archivo regenerado pero igual no se vuelve a subir y su ETag no cambia.
6. Escribe el resumen en `~/.config/xuper-catalog/publish-status.json` (tamaños, hashes, resultados, duración).

Código de salida: `0` todo bien (o nada que publicar), `1` algo falló (el detalle está en el log y en el status).

### Retención de la rama `data`

Los archivos `v2/**` nunca se reescriben: un contenido nuevo es un nombre nuevo. Cada commit deja en el árbol los
archivos del índice nuevo y los de los **dos índices anteriores**, y borra los demás `v2/**`. Cualquier otro archivo
que agregues a mano en la rama (por ejemplo un README) se conserva.

Más o menos una vez al año, para que el repo no crezca, puedes reiniciar la historia: un commit sin padres reemplaza
la rama, y los archivos y las rutas siguen iguales. Hazlo con launchd descargado o entre dos corridas:

```bash
node tools/to-v2.mjs --in ~/.config/xuper-catalog/work --out /tmp/xuper-v2
node tools/publish-data.mjs --dir /tmp/xuper-v2 --reset-history
```

## Primeras corridas (antes de cargar launchd)

1. **En seco:**
   ```bash
   tools/publish.sh data --dry-run
   ```
   La primera vez debe decir que haría un commit en una rama nueva (`would commit … on a new orphan branch`) y que
   subiría `home.json` y `matches.json`.
2. **Primera corrida real:**
   ```bash
   tools/publish.sh data
   ```
   Crea la rama `data`. Revisa:
   ```bash
   curl -s https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/data/index.json
   GH_TOKEN="$(gh auth token --user xuper-plugin)" gh api repos/xuper-plugin/kino-plugin-xuper/commits/data --jq '.commit.author'
   cat ~/.config/xuper-catalog/publish-status.json
   ```
   La primera vez los dos assets del Release se suben aunque no hayan cambiado, porque todavía no hay hash guardado.
   Es normal y pasa una sola vez.
3. **Segunda corrida**, enseguida: debe decir `index unchanged … nothing to publish` y `unchanged … skipped` para los
   dos assets.
4. **Tercera corrida**, unas horas después. Con tres corridas limpias, carga launchd.

La rama `data` es opcional: sin ella el plugin lee el Release `catalog`. Para publicar solo el Release, usa los modos
`catalog` y `matches`.

## launchd (lo cargas tú)

`tools/com.xuper.publish-data.plist` es una plantilla: corre `publish.sh data` cada 7200 s y una vez al cargarla.
Reemplaza a cualquier agente anterior que publique el catálogo o los partidos: descárgalo antes
(`launchctl bootout gui/$(id -u)/<su etiqueta>`).

1. Llena la plantilla con la ruta del checkout, tu carpeta personal y un PATH donde estén `node`, `gh` y `python3`:
   ```bash
   REPO="$HOME/kino-plugin-xuper"
   sed -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
       -e "s#__PATH__#$(dirname "$(command -v node)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin#g" \
       "$REPO/tools/com.xuper.publish-data.plist" > ~/Library/LaunchAgents/com.xuper.publish-data.plist
   plutil -lint ~/Library/LaunchAgents/com.xuper.publish-data.plist
   ```
2. Cárgala:
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xuper.publish-data.plist
   ```

Para el día a día:

```bash
launchctl print gui/$(id -u)/com.xuper.publish-data | head -30   # estado y última salida
launchctl kickstart gui/$(id -u)/com.xuper.publish-data          # correr ya
launchctl bootout gui/$(id -u)/com.xuper.publish-data            # descargar
tail -50 ~/.config/xuper-catalog/publish-data.log                # log
cat ~/.config/xuper-catalog/publish-status.json                  # resumen de la última corrida
```

Si el Mac está dormido, la corrida pendiente se hace al despertar. Si el Mac pasa días apagado, los aparatos siguen
con lo último que bajaron y los partidos viejos se ocultan solos.

## Interruptor de En vivo (`live.off`)

Para ocultar una fuente de En vivo en todos los aparatos sin sacar una versión del plugin, ponla en
`XUPER_LIVE_OFF` en `publish.env` (ids: `tvenvivo`, `caracol`, `cablevisionhd`, `premiumtv`, `supertv`,
`futbollibre`, `nuvio-sports`, `deportv`, `cncverse`, `xuper`) y corre `tools/publish.sh data`. Para volver a
mostrarla, quítala y corre otra vez. El índice publicado siempre sale de `publish.env`: si editas `index.json` a mano
en la rama, la siguiente corrida lo pisa.

## Archivos de estado (fuera del repo)

| Ruta | Qué es |
|---|---|
| `~/.config/xuper-catalog/work/home.json`, `work/matches.json` | Los últimos archivos buenos (ya validados); `data` arma el v2 con ellos |
| `~/.config/xuper-catalog/state/<asset>.hash` | Hash (sin `generatedAt`) de la última subida de cada asset del Release |
| `~/.config/xuper-catalog/state/slots.json` | Cuándo se generó el catálogo por última vez |
| `~/.config/xuper-catalog/publish-status.json` | Resumen de la última corrida (no se escribe con `--dry-run`) |
| `~/.config/xuper-catalog/publish-data.log` | Log de launchd (crece unos KB por día; puedes borrarlo cuando quieras) |

## Para desarrolladores

```bash
node tools/to-v2.mjs --home <home.json> --matches <matches.json> --out <dir>   # only builds and validates, no network
node --test test/to-v2.test.mjs test/publish-data.test.mjs                     # fake gh, no network
```

Los tests usan `test/helpers/fake-gh.mjs`, un modelo en memoria de la API de datos de git: nunca llaman al `gh` real.
