#!/bin/sh
# Genera el Home pre-armado de Xuper en el Mac (IP que alcanza el portal) y publica home/feed.enc.json.
# Lo dispara launchd 2 veces al día. Trabaja en un CLON DEDICADO (no en el repo de trabajo del autor),
# así nunca pisa cambios sin commitear. Reusa el cliente del seed-minter (3DES + clave + seeds locales).
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

REMOTE="https://github.com/xuper-plugin/kino-plugin-xuper.git"
WORK="$HOME/.cache/kino-xuper-feed"
MINTER="$HOME/kino-seed-minter"

if [ ! -d "$WORK/.git" ]; then
  mkdir -p "$(dirname "$WORK")"
  git clone -q "$REMOTE" "$WORK"
fi
cd "$WORK"
git fetch -q origin main
git reset -q --hard origin/main   # seguro: clon dedicado

# El generador hace chdir al minter (para su .env), por eso --out va en ruta ABSOLUTA. El feed se publica CIFRADO (feed.enc.json).
python3 scripts/gen-home.py --minter "$MINTER" --out "$WORK/home/feed.enc.json"

git rm -q --ignore-unmatch home/feed.json   # ya no se publica el plano
git add home/feed.enc.json
if git diff --cached --quiet; then
  echo "$(date '+%F %T') sin cambios en home/feed.enc.json"
  exit 0
fi
git -c user.name=xuper-plugin -c user.email=335105665+xuper-plugin@users.noreply.github.com \
  commit -q -m "Home pre-armado: actualiza home/feed.enc.json"
if git pull -q --rebase origin main && git push -q origin HEAD:main; then
  echo "$(date '+%F %T') publicado"
else
  echo "$(date '+%F %T') push falló (se reintenta en la próxima corrida)"; exit 1
fi
