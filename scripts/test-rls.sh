#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL_TEST:?DATABASE_URL_TEST must be set}"
shopt -s nullglob
for f in tests/rls/*.pgTAP.sql; do
  echo "[rls] running $f"
  psql "$DATABASE_URL_TEST" -v ON_ERROR_STOP=1 -f "$f"
done
echo "[rls] all tests passed"
