#!/usr/bin/env bash
# publish.sh — the Mac publisher of Xuper's catalog data. The generator (tools/gen_catalog.py of the backend
# checkout) makes the data locally (anonymous trial, never the account's credentials) and this script publishes it to
# GitHub as xuper-plugin. No server, no endpoint.
#
#   publish.sh data    [--force] [--dry-run]  launchd, every 2 h: matches every run, the catalog when its 06:00/18:00
#                                             slot is due; v2 payloads to the `data` branch (one commit, or none when
#                                             nothing changed); then the changed legacy assets to the Release.
#   publish.sh catalog [--force] [--dry-run]  legacy home.json    → Release `catalog` (only when its content changed)
#   publish.sh matches [--force] [--dry-run]  legacy matches.json → Release `catalog` (only when its content changed)
#
#   --force    regenerate the catalog even when its slot is not due; upload Release assets even when unchanged
#   --dry-run  generate and build locally and read GitHub, but write nothing to GitHub and record no state
#
# Config (never in the repo): ~/.config/xuper-catalog/publish.env with XUPER_GENERATOR=<the generator checkout>.
# Optional there:
#   XUPER_PYTHON (default python3), XUPER_LIVE_OFF (comma list of live source ids hidden through index.json),
#   XUPER_SMOKE=0 (skip the raw.githubusercontent.com smoke check).
# State (never in the repo), under ~/.config/xuper-catalog (XUPER_CONF_DIR overrides it):
#   work/home.json, work/matches.json  the last-good legacy files (the data mode rebuilds v2 from them)
#   state/<asset>.hash                 canonical hash (without generatedAt) of the last Release upload: hash-skip
#   state/slots.json                   when the catalog was last generated
#   publish.lock/                      mkdir lock; one taken more than 30 min ago is considered stale
#   publish-status.json                the last run's summary (sizes, hashes, timings, results)
# Every gh call runs with GH_TOKEN="$(gh auth token --user xuper-plugin)": several accounts are logged in here.
set -euo pipefail

REPO="xuper-plugin/kino-plugin-xuper"
TAG="catalog"
GH_USER="xuper-plugin"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${XUPER_CONF_DIR:-$HOME/.config/xuper-catalog}"
ENVFILE="${XUPER_PUBLISH_ENV:-$CONF/publish.env}"
WORK="$CONF/work"
STATE="$CONF/state"
LOCK="$CONF/publish.lock"
STATUS="$CONF/publish-status.json"
LOCK_STALE_MIN=30

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
usage() { echo "usage: $0 <data|catalog|matches> [--force] [--dry-run]" >&2; exit 2; }
now_ms() { echo "$(( $(date +%s) * 1000 ))"; }

mode="${1:-}"
[ $# -gt 0 ] && shift
FORCE=0
DRY=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    *) usage ;;
  esac
done
case "$mode" in data|catalog|matches) ;; *) usage ;; esac

STARTED="$(now_ms)"
FAILED=0
REL_ARGS=""        # "--release <asset>=<result>" pairs for the status file (values never contain spaces)
LOCKED=0
tmpdir=""

cleanup() {
  if [ -n "$tmpdir" ] && [ -d "$tmpdir" ] && [ ! -L "$tmpdir" ]; then
    case "$tmpdir" in */xuper-publish.*) rm -rf -- "$tmpdir" ;; esac
  fi
  if [ "$LOCKED" = 1 ]; then
    rm -f -- "$LOCK/pid"
    rmdir -- "$LOCK" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# finish <exit code>: writes publish-status.json (not on a dry run) and exits.
finish() {
  local code="$1"
  if [ "$DRY" != 1 ] && [ -n "${NODE:-}" ]; then
    # shellcheck disable=SC2086
    "$NODE" "$HERE/publish-state.mjs" status --file "$STATUS" --mode "$mode" --started "$STARTED" --exit "$code" \
      --to-v2 "${tmpdir:-/nonexistent}/to-v2.json" --data "${tmpdir:-/nonexistent}/data.json" $REL_ARGS \
      || log "could not write $STATUS"
  fi
  log "done: mode $mode, exit $code, ${SECONDS} s"
  exit "$code"
}
die() { log "ERROR: $*"; finish 1; }

[ -f "$ENVFILE" ] || { log "ERROR: missing $ENVFILE (XUPER_GENERATOR=<the generator checkout>)"; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENVFILE"; set +a
: "${XUPER_GENERATOR:?XUPER_GENERATOR is missing in $ENVFILE (the generator checkout: the folder with tools/gen_catalog.py)}"
PY="${XUPER_PYTHON:-python3}"
NODE="${XUPER_NODE:-node}"
command -v "$NODE" >/dev/null 2>&1 || { NODE=""; die "node not found in PATH ($PATH)"; }
command -v gh >/dev/null 2>&1 || die "gh not found in PATH ($PATH)"
command -v "$PY" >/dev/null 2>&1 || die "$PY not found in PATH ($PATH)"
export XUPER_STATE_DIR="$STATE"

# One publish at a time (launchd, a manual run and a dry run all take the same lock).
mkdir -p "$CONF" "$WORK" "$STATE"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -type d -mmin +"$LOCK_STALE_MIN" 2>/dev/null)" ]; then
    log "the lock is older than $LOCK_STALE_MIN min (pid $(cat "$LOCK/pid" 2>/dev/null || echo '?')): taking it over"
    rm -f -- "$LOCK/pid"
    rmdir -- "$LOCK" 2>/dev/null || true
    mkdir "$LOCK" 2>/dev/null || { log "another publish took the lock: exit"; exit 0; }
  else
    log "another publish is running (pid $(cat "$LOCK/pid" 2>/dev/null || echo '?')): exit"
    exit 0
  fi
fi
LOCKED=1
echo "$$" > "$LOCK/pid"

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/xuper-publish.XXXXXX")"

# xuper-plugin's token for every gh call (an inherited GH_TOKEN of another account is ignored).
GH_TOKEN="$(env -u GH_TOKEN -u GITHUB_TOKEN gh auth token --user "$GH_USER" 2>/dev/null || true)"
[ -n "$GH_TOKEN" ] || die "gh has no token for $GH_USER (gh auth login, as $GH_USER)"
export GH_TOKEN
unset GITHUB_TOKEN || true

GEN="$tmpdir/gen"
mkdir -p "$GEN"

asset_of() { case "$1" in catalog) echo "home.json" ;; matches) echo "matches.json" ;; esac; }

# generate <catalog|matches>: the generator writes the legacy file into $GEN/<asset>; 0 only when it is valid JSON.
# A generated file becomes the last-good copy (work/<asset>) only after to-v2 accepted it: see promote.
generate() {
  local what="$1" out
  out="$GEN/$(asset_of "$what")"
  if ( cd "$XUPER_GENERATOR" && "$PY" tools/gen_catalog.py "$what" "$out" ) && [ -s "$out" ] \
     && "$PY" -c "import json,sys; json.load(open(sys.argv[1]))" "$out"; then
    log "generated $(basename "$out") ($(wc -c < "$out" | tr -d ' ') bytes)"
    return 0
  fi
  rm -f -- "$out"
  return 1
}

# promote <asset>: the accepted generated file replaces work/<asset> (copied next to it, then renamed: atomic).
promote() {
  cp -- "$GEN/$1" "$WORK/.$1.new.$$"
  mv -f -- "$WORK/.$1.new.$$" "$WORK/$1"
}

# to_v2 <home.json> <matches.json> <out dir>: builds and validates v2 with the device's src/v2.js (summary on
# $tmpdir/to-v2.json, problems on stderr). 0 = accepted.
to_v2() {
  "$NODE" "$HERE/to-v2.mjs" --home "$1" --matches "$2" --out "$3" > "$tmpdir/to-v2.json"
}

ensure_release() {
  gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 || \
    gh release create "$TAG" -R "$REPO" --title "Catálogo Xuper (datos)" \
      --notes "Assets de datos del catálogo, generados localmente y subidos por el publisher. No es un release de código."
}

# release_upload <asset> <file>: uploads <file> (named <asset>) to the Release only when its canonical hash (without
# generatedAt) differs from the last upload's, so an identical regeneration keeps the asset and its ETag (devices
# then get a 304 with 0 bytes).
release_upload() {
  local asset="$1" f="$2" rc=0 h=""
  [ "$(basename "$f")" = "$asset" ] || die "release_upload: $f is not named $asset"
  h="$("$NODE" "$HERE/publish-state.mjs" changed "$asset" "$f")" || rc=$?
  if [ "$rc" -ge 2 ]; then
    log "release $asset: cannot hash it (exit $rc): not uploaded"
    REL_ARGS="$REL_ARGS --release $asset=error"; FAILED=1; return 0
  fi
  if [ "$rc" = 1 ] && [ "$FORCE" != 1 ]; then
    log "release $asset: unchanged ($h): skipped"
    REL_ARGS="$REL_ARGS --release $asset=unchanged"; return 0
  fi
  if [ "$DRY" = 1 ]; then
    log "release $asset: dry run, would upload ($h)"
    REL_ARGS="$REL_ARGS --release $asset=dry-run"; return 0
  fi
  if ensure_release && gh release upload "$TAG" "$f" --clobber -R "$REPO"; then
    "$NODE" "$HERE/publish-state.mjs" mark "$asset" "$f" >/dev/null || log "release $asset: uploaded, but its hash was not recorded"
    log "release $asset: uploaded ($h, $(wc -c < "$f" | tr -d ' ') bytes)"
    REL_ARGS="$REL_ARGS --release $asset=uploaded"
  else
    log "release $asset: upload failed"
    REL_ARGS="$REL_ARGS --release $asset=failed"; FAILED=1
  fi
}

data_mode() {
  local rc=0 dflags="" nh="" nm="" oh="" om="" out=""
  # 1. Generate: matches every run, the catalog when its slot is due (or when there is none yet).
  if generate matches; then nm="$GEN/matches.json"; else log "matches generation failed: keeping the last-good file"; FAILED=1; fi
  if [ "$FORCE" = 1 ] || [ ! -s "$WORK/home.json" ] || "$NODE" "$HERE/publish-state.mjs" catalog-due; then
    if generate catalog; then nh="$GEN/home.json"; else log "catalog generation failed: keeping the last-good file"; FAILED=1; fi
  else
    log "catalog slot not due: reusing work/home.json"
  fi
  if [ -s "$WORK/home.json" ]; then oh="$WORK/home.json"; fi
  if [ -s "$WORK/matches.json" ]; then om="$WORK/matches.json"; fi
  [ -n "${nh:-$oh}" ] && [ -n "${nm:-$om}" ] || die "no home.json or matches.json at hand: nothing to publish"

  # 2. v2 with the device's own src/v2.js, validated. A new file that to-v2 refuses is not used (nor kept as
  #    last-good): the other half still goes out. Nothing acceptable → nothing is published anywhere.
  if to_v2 "${nh:-$oh}" "${nm:-$om}" "$tmpdir/v2"; then
    out="$tmpdir/v2"
  elif [ -n "$nh" ] && [ -n "$oh" ] && to_v2 "$oh" "${nm:-$om}" "$tmpdir/v2a"; then
    out="$tmpdir/v2a"; nh=""; FAILED=1; log "to-v2 refused the new catalog: publishing the last-good one"
  elif [ -n "$nm" ] && [ -n "$om" ] && to_v2 "${nh:-$oh}" "$om" "$tmpdir/v2b"; then
    out="$tmpdir/v2b"; nm=""; FAILED=1; log "to-v2 refused the new matches: publishing the last-good ones"
  elif [ -n "$oh" ] && [ -n "$om" ] && { [ -n "$nh" ] || [ -n "$nm" ]; } && to_v2 "$oh" "$om" "$tmpdir/v2c"; then
    out="$tmpdir/v2c"; nh=""; nm=""; FAILED=1; log "to-v2 refused both new files: publishing the last-good ones"
  else
    die "to-v2 refused the files: nothing published (the devices keep their last-good data)"
  fi
  log "v2: $(cat "$tmpdir/to-v2.json")"
  if [ "$DRY" != 1 ]; then
    if [ -n "$nm" ]; then promote matches.json; fi
    if [ -n "$nh" ]; then promote home.json; "$NODE" "$HERE/publish-state.mjs" catalog-done; fi
  fi

  # 3. The data branch: one commit through the git data API, or nothing when the index is unchanged.
  if [ "$DRY" = 1 ]; then dflags="$dflags --dry-run"; fi
  if [ "${XUPER_SMOKE:-1}" = 0 ]; then dflags="$dflags --no-smoke"; fi
  # shellcheck disable=SC2086
  "$NODE" "$HERE/publish-data.mjs" --dir "$out" --repo "$REPO" $dflags > "$tmpdir/data.json" || rc=$?
  case "$rc" in
    0) ;;
    3) log "data branch: published, but raw.githubusercontent.com does not serve it yet (smoke check)" ;;
    *) log "data branch: nothing published (exit $rc)"; FAILED=1 ;;
  esac
  log "data: $(tail -n 1 "$tmpdir/data.json" 2>/dev/null || true)"

  # 4. The legacy Release assets (read while the data branch is missing, and as its fallback), only when changed.
  release_upload home.json "${nh:-$oh}"
  release_upload matches.json "${nm:-$om}"
}

legacy_mode() {
  local asset other h m
  asset="$(asset_of "$mode")"
  generate "$mode" || die "generation failed: nothing uploaded (the published asset stays)"
  # The data mode's gate when the other half is at hand: never upload what a device would refuse.
  if [ "$mode" = catalog ]; then other="$WORK/matches.json"; h="$GEN/home.json"; m="$other"
  else other="$WORK/home.json"; h="$other"; m="$GEN/matches.json"; fi
  if [ -s "$other" ]; then
    to_v2 "$h" "$m" "$tmpdir/v2" || die "to-v2 refused the generated $asset: nothing uploaded (the published asset stays)"
  else
    log "no $(basename "$other") in work/ yet: the to-v2 gate is skipped"
  fi
  if [ "$DRY" != 1 ]; then
    promote "$asset"
    if [ "$mode" = catalog ]; then "$NODE" "$HERE/publish-state.mjs" catalog-done; fi
  fi
  release_upload "$asset" "$GEN/$asset"
}

log "publish $mode$([ "$FORCE" = 1 ] && echo ' --force')$([ "$DRY" = 1 ] && echo ' --dry-run') as $GH_USER"
case "$mode" in
  data) data_mode ;;
  catalog|matches) legacy_mode ;;
esac
finish "$FAILED"
