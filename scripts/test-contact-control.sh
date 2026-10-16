#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${BOS_TEST_POSTGRES_CONTAINER:-}" ]]; then
 runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1)
else
 : "${BOS_TEST_DATABASE_URL:?Use an explicit disposable database}"
 runner=(psql "$BOS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1)
fi
schema=(tests/sql/push-schema.sql tests/sql/control-tasks-schema.sql tests/sql/contact-control-schema.sql \
 supabase/migrations/20260929163737_web_push_v211.sql supabase/migrations/20261001074029_order_control_tasks_v2.sql \
 supabase/migrations/20261002101000_master_contact_confirmation.sql supabase/migrations/20261004183000_master_contact_journal.sql \
 supabase/migrations/*_contact_control_pilot.sql)
# A repeat apply must not rename the wrappers recursively or reactivate the pilot.
cat "${schema[@]}" supabase/migrations/*_contact_control_pilot.sql tests/sql/contact-control-assertions.sql | "${runner[@]}"
# The existing manual control contract must still hold with the new wrappers.
cat "${schema[@]}" tests/sql/control-tasks-assertions.sql | "${runner[@]}"
