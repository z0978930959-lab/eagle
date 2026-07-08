#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$DIR/.env"
  set +a
fi
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
echo "Starting baseball-game on $HOSTNAME:$PORT"
node "$DIR/server.js"
