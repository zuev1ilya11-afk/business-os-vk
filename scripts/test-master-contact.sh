#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Only an explicit disposable DB; every fixture/migration is rolled back.
if [[ -n "${BOS_TEST_POSTGRES_CONTAINER:-}" ]]; then
  runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1)
else
  : "${BOS_TEST_DATABASE_URL:?Set an explicit disposable test database URL}"
  runner=(psql "$BOS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1)
fi
cat tests/sql/order-guards-schema.sql \
  tests/sql/master-contact-schema.sql \
  supabase/migrations/20260929160000_capture_live_order_guards.sql \
  supabase/migrations/20261002101000_master_contact_confirmation.sql \
  supabase/migrations/20261002101000_master_contact_confirmation.sql \
  tests/sql/master-contact-assertions.sql | "${runner[@]}"
