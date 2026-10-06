#!/bin/sh
# Drop privileges to the unprivileged `node` user after fixing ownership of
# the writable mounts. Named volumes created by an earlier (root-running)
# image are root-owned, and Docker only copies image ownership on FIRST
# volume creation — so an in-place upgrade would otherwise fail every
# /api/save-workflow write with EACCES.
set -e
if [ "$(id -u)" = "0" ]; then
  for dir in /app/data /app/dist/examples; do
    mkdir -p "$dir" 2>/dev/null || true
    chown -R node:node "$dir" 2>/dev/null || true
  done
  # setpriv keeps the environment, so HOME would stay /root and Puppeteer
  # (which writes ~/.config/puppeteer) would fail with EACCES as `node`.
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
