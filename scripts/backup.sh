#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-alche}"
POSTGRES_DB="${POSTGRES_DB:-alche}"
STAMP="$(date +%Y%m%d_%H%M%S)"
DEST_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$DEST_DIR"
FILE="$DEST_DIR/alche_${STAMP}.sql.gz"

docker compose exec -T db pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format plain \
  --no-owner \
  --no-privileges \
  | gzip -9 > "$FILE"

echo "Backup written to $FILE"

# Keep the 30 most recent backups.
ls -1t "$DEST_DIR"/alche_*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm --

echo "Backup retention: $(ls -1 "$DEST_DIR"/alche_*.sql.gz 2>/dev/null | wc -l) file(s) retained."
