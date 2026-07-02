#!/usr/bin/env bash
#
# deploy-web.sh - Ship apps/web to production in one command.
#
# Why this exists: the boring-computers Vercel project's production domains
# (boringcomputers.com + www) are pinned via `vercel alias` and do NOT
# auto-promote on `git push`. This script pushes, waits for the build, and
# re-points both domains at the newest ready deployment — so you never have to
# hand-alias again. Run it from anywhere in the repo after committing.
#
# Requires: git, and the Vercel CLI logged in to the goshen-labs scope.
#
set -euo pipefail

PROJECT="boring-computers"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WEB="${ROOT}/apps/web"

log() { printf '\033[1;34m[deploy-web]\033[0m %s\n' "$*"; }

log "Pushing main (triggers the Vercel build)..."
git -C "$ROOT" push origin main

log "Waiting for the new production build to go Ready..."
sleep 40
URL=""
for i in $(seq 1 18); do
  URL="$(cd "$WEB" && vercel ls "$PROJECT" 2>/dev/null \
    | grep '● Ready' \
    | grep -oE 'https://boring-computers-[a-z0-9]+-goshen-labs\.vercel\.app' \
    | head -1)"
  [ -n "$URL" ] && break
  sleep 10
done
[ -n "$URL" ] || { echo "no ready deployment found; check 'vercel ls $PROJECT'"; exit 1; }

log "Pointing the production domains at ${URL} ..."
cd "$WEB"
vercel alias set "$URL" www.boringcomputers.com
vercel alias set "$URL" boringcomputers.com

log "Live: https://www.boringcomputers.com  ->  ${URL}"
log "Verify: curl -s https://www.boringcomputers.com/ | grep -o sslip.io"
