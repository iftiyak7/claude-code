#!/usr/bin/env bash
# Build & (re)start the stack. Safe to run repeatedly — zero data loss.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then echo "Missing deploy/.env (copy .env.example)"; exit 1; fi
GIT_TERMINAL_PROMPT=0 git -C .. pull --ff-only || true

docker compose build --pull api
docker compose up -d --remove-orphans
docker image prune -f >/dev/null

echo "Waiting for API health…"
for i in {1..30}; do
  if docker compose exec -T api wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1; then
    echo "API healthy ✔"; docker compose ps; exit 0
  fi
  sleep 2
done
echo "API did not become healthy:"; docker compose logs --tail=80 api; exit 1
