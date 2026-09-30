#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${BOS_TEST_POSTGRES_CONTAINER:-}" ]]; then
 runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1)
else
 : "${BOS_TEST_DATABASE_URL:?Set an explicit disposable test database URL}"
 runner=(psql "$BOS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1)
fi
setup=supabase/migrations/20260930195125_hands_report_delivery.sql
cat tests/sql/hands-report-schema.sql "$setup" "$setup" tests/sql/hands-report-assertions.sql | "${runner[@]}"
