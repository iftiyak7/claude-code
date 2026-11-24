#!/usr/bin/env bash
# Compressed PostgreSQL dump, keeps the last 14 days.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
f="backups/tadbeer-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U tadbeer -d tadbeer --no-owner | gzip -9 > "$f"
chmod 600 "$f"
find backups -name 'tadbeer-*.sql.gz' -mtime +14 -delete
echo "backup written: $f"
