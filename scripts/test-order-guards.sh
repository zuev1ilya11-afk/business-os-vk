#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Must target a disposable database: the script creates public.orders, then rolls back.
if [[ -n "${BOS_TEST_POSTGRES_CONTAINER:-}" ]]; then
  runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1)
else
  : "${BOS_TEST_DATABASE_URL:?Set an explicit disposable test database URL}"
  runner=(psql "$BOS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1)
fi
cat tests/sql/order-guards-schema.sql \
  supabase/migrations/20260929160000_capture_live_order_guards.sql \
  supabase/migrations/20260929160000_capture_live_order_guards.sql \
  supabase/migrations/20261001174717_report_uncompleted_items.sql \
  supabase/migrations/20261001193413_master_hands_details.sql \
  supabase/migrations/20261001193413_master_hands_details.sql \
  tests/sql/order-guards-assertions.sql | "${runner[@]}"

# The confirmation guard must also run alongside the captured production guard.
bash scripts/test-master-contact.sh
