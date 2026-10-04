#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicit disposable database only. CREATE TABLE fails if real app tables exist.
if [[ -n "${BOS_TEST_POSTGRES_CONTAINER:-}" ]]; then
  runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1)
else
  : "${BOS_TEST_DATABASE_URL:?Set an explicit disposable test database URL}"
  runner=(psql "$BOS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1)
fi
migration=supabase/migrations/20261004100840_manual_order_completion.sql
cat tests/sql/order-guards-schema.sql tests/sql/manual-completion-schema.sql \
  supabase/migrations/20260929160000_capture_live_order_guards.sql "$migration" "$migration" \
  tests/sql/manual-completion-assertions.sql | "${runner[@]}"

# Separate sessions exercise the row lock, not an in-memory simulation.
# Commit only disposable fixtures; every object is removed by the cleanup trap.
tmp=$(mktemp -d)
cleanup(){
  "${runner[@]}" <<'SQL'
DROP TABLE IF EXISTS public.orders,public.business_staff,public.manual_test_effects CASCADE;
DROP FUNCTION IF EXISTS public.bos_manual_complete_order(bigint,uuid,text,timestamptz);
DROP FUNCTION IF EXISTS public.guard_manual_completion_audit(),public.manual_test_capture(),public.guard_order_completion(),public.touch_updated_at(),public.zero_payouts_on_cancelled_orders();
SQL
  rm -rf "$tmp"
}
# Do not install cleanup until schema creation succeeds: never drop a pre-existing orders table.
{ cat tests/sql/order-guards-schema.sql tests/sql/manual-completion-schema.sql \
    supabase/migrations/20260929160000_capture_live_order_guards.sql "$migration"; echo 'COMMIT;'; } | "${runner[@]}"
trap cleanup EXIT
for actor in 1 2; do
  "${runner[@]}" >"$tmp/$actor.log" <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.bos_manual_complete_order(10,'00000000-0000-0000-0000-00000000000$actor','Проверено','2026-10-04T09:00:00Z');
SELECT pg_sleep(0.3);
COMMIT;
SQL
  if [[ "$actor" == 1 ]]; then first_pid=$!; else second_pid=$!; fi
done
wait "$first_pid"; wait "$second_pid"
"${runner[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT status FROM public.orders WHERE id=10)<>'Выполнена' OR (SELECT jsonb_array_length(manual_completion_history) FROM public.orders WHERE id=10)<>1 THEN RAISE EXCEPTION 'Concurrent completion did not produce one audit event'; END IF;
 IF (SELECT count(*) FROM public.manual_test_effects WHERE order_id=10)<>1 THEN RAISE EXCEPTION 'Concurrent completion repeated side effects'; END IF;
END $$;
SQL
