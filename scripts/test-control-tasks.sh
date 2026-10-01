#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${BOS_TEST_POSTGRES_CONTAINER:-}" ]]; then
 runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1)
else
 : "${BOS_TEST_DATABASE_URL:?Use an explicit disposable database}"
 runner=(psql "$BOS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1)
fi
migration=$(find supabase/migrations -name '*_order_control_tasks_v2.sql' -print -quit)
[[ -n "$migration" ]] || migration=supabase/order-control-tasks-v2.sql
cat tests/sql/push-schema.sql tests/sql/control-tasks-schema.sql supabase/migrations/20260929163737_web_push_v211.sql "$migration" "$migration" tests/sql/control-tasks-assertions.sql | "${runner[@]}"
cat tests/sql/push-schema.sql tests/sql/control-tasks-schema.sql supabase/migrations/20260929163737_web_push_v211.sql "$migration" tests/sql/control-tasks-isolation.sql | "${runner[@]}"
# Existing sender regressions also run against the extended production RPCs.
cat tests/sql/push-schema.sql tests/sql/control-tasks-schema.sql supabase/migrations/20260929163737_web_push_v211.sql "$migration" tests/sql/push-assertions.sql | "${runner[@]}"
