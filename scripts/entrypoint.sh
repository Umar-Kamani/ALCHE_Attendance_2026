#!/bin/sh
set -eu

echo "Running database migrations…"
./node_modules/.bin/prisma migrate deploy

echo "Starting ALCHE Campus Post on port ${PORT:-8000}…"
exec node dist/server.js
