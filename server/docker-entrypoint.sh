#!/bin/sh
# Drop privileges to the unprivileged `node` user after fixing ownership of
# the one writable mount (dist/examples). The app has no data volume and
# persists nothing server-side (the /app/data workflow-saves volume was
# removed in Nov 2026 after a data-protection review).
set -e
owned_by_root() { [ "$(stat -c %u "$1" 2>/dev/null)" = "0" ]; }
if [ "$(id -u)" = "0" ]; then
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
