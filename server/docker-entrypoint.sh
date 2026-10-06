#!/bin/sh
# Drop privileges to the unprivileged `node` user after fixing ownership of
# the writable mounts. Named volumes created by an earlier (root-running)
# image are root-owned, and Docker only copies image ownership on FIRST
# volume creation — so an in-place upgrade would otherwise fail every
# /api/save-workflow write with EACCES.
set -e
owned_by_root() { [ "$(stat -c %u "$1" 2>/dev/null)" = "0" ]; }
if [ "$(id -u)" = "0" ]; then
  # /app/data is a named volume: re-own it (recursively) only when it is
  # still root-owned, i.e. created by an earlier root-running image.
  mkdir -p /app/data 2>/dev/null || true
  if owned_by_root /app/data; then chown -R node:node /app/data 2>/dev/null || true; fi
  # /app/dist/examples is a HOST bind mount in docker-compose. Never touch the
  # files inside it — on a Linux host that would rewrite the operator's working
  # tree to uid 1000 and break `git pull`. Only the directory itself, and only
  # if it is root-owned (the image default when nothing is mounted).
  mkdir -p /app/dist/examples 2>/dev/null || true
  if owned_by_root /app/dist/examples; then chown node:node /app/dist/examples 2>/dev/null || true; fi
  # setpriv keeps the environment, so HOME would stay /root and Puppeteer
  # (which writes ~/.config/puppeteer) would fail with EACCES as `node`.
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
