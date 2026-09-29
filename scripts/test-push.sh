#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicit disposable database only; all fixture objects and test records roll back.
if [[ -n "${BOS_TEST_POSTGRES_CONTAINER:-}" ]]; then
  runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1)
else
  : "${BOS_TEST_DATABASE_URL:?Set an explicit disposable test database URL}"
  runner=(psql "$BOS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1)
fi
migration=supabase/migrations/20260929163737_web_push_v211.sql
cat tests/sql/push-schema.sql "$migration" "$migration" tests/sql/push-assertions.sql | "${runner[@]}"
