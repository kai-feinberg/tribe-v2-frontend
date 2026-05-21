#!/usr/bin/env bash
set -euo pipefail

SSH_KEY="${TRIBE_SSH_KEY:-$HOME/.ssh/hetzner_tribev2}"
SSH_HOST="${TRIBE_SSH_HOST:-root@204.168.145.117}"
LOCAL_PORT="${TRIBE_LOCAL_PORT:-8000}"
REMOTE_HOST="${TRIBE_REMOTE_HOST:-localhost}"
REMOTE_PORT="${TRIBE_REMOTE_PORT:-8000}"
HEALTH_URL="http://127.0.0.1:${LOCAL_PORT}/health"

tunnel_pid=""

cleanup() {
  if [ -n "${tunnel_pid}" ] && kill -0 "${tunnel_pid}" 2>/dev/null; then
    kill "${tunnel_pid}" 2>/dev/null || true
    wait "${tunnel_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
  echo "TRIBE API already reachable at ${HEALTH_URL}"
else
  echo "Opening SSH tunnel ${LOCAL_PORT} -> ${SSH_HOST}:${REMOTE_PORT}"
  ssh -N \
    -i "${SSH_KEY}" \
    -L "${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT}" \
    "${SSH_HOST}" &
  tunnel_pid="$!"

  for _ in $(seq 1 30); do
    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
      echo "TRIBE API reachable at ${HEALTH_URL}"
      break
    fi
    sleep 1
  done

  if ! curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    echo "Timed out waiting for ${HEALTH_URL}" >&2
    exit 1
  fi
fi

echo "Starting Vite. Use /api as the API base URL."
vite
