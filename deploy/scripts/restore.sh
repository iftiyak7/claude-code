#!/usr/bin/env bash
# Restore a backup:  ./scripts/restore.sh backups/tadbeer-YYYYmmdd-HHMMSS.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f "${1:-}" ]] || { echo "usage: $0 <backup.sql.gz>"; exit 1; }
read -r -p "This REPLACES the current database. Type 'yes' to continue: " ok
[[ "$ok" == "yes" ]] || exit 1
docker compose stop api
docker compose exec -T db psql -U tadbeer -d postgres -c "DROP DATABASE IF EXISTS tadbeer WITH (FORCE);" -c "CREATE DATABASE tadbeer OWNER tadbeer;"
gunzip -c "$1" | docker compose exec -T db psql -U tadbeer -d tadbeer
docker compose start api
echo "restored ✔"
