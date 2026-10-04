#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${BOS_TEST_POSTGRES_CONTAINER:-}" ]]; then
 runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1)
else
 : "${BOS_TEST_DATABASE_URL:?Use an explicit disposable database}"
 runner=(psql "$BOS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1)
fi
cat tests/sql/finance-expenses-schema.sql supabase/migrations/20261004191357_finance_expenses.sql tests/sql/finance-expenses-assertions.sql | "${runner[@]}"
