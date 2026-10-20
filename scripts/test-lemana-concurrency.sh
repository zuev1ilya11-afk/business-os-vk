#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Separate real PostgreSQL sessions, disposable database only; no live credentials.
: "${BOS_TEST_POSTGRES_CONTAINER:?Requires the disposable CI PostgreSQL container}"
dbname="bos_lemana_${RANDOM}_$$"
tmpdir="$(mktemp -d)"
runner=(docker exec -i "$BOS_TEST_POSTGRES_CONTAINER")
cleanup(){ "${runner[@]}" dropdb -U postgres --if-exists "$dbname" >/dev/null; rm -rf "$tmpdir"; }
trap cleanup EXIT
"${runner[@]}" createdb -U postgres "$dbname"
psql=("${runner[@]}" psql -X -q -U postgres -d "$dbname" -v ON_ERROR_STOP=1)
node - <<'JS' > "$tmpdir/setup.sql"
const fs=require('node:fs'),{schema}=require('./tests/helpers/lemana-schema.cjs');
console.log(schema.replace(/create role (\w+);/g,(_,role)=>`do $$begin create role ${role}; exception when duplicate_object then null; end$$;`));
console.log(fs.readFileSync('supabase/migrations/20261020140000_manual_order_intake.sql','utf8'));
console.log(fs.readFileSync('supabase/migrations/20261020180000_lemana_import_work_items.sql','utf8'));
JS
"${psql[@]}" < "$tmpdir/setup.sql"
node - <<'JS' > "$tmpdir/call.sql"
const {row,owner}=require('./tests/helpers/lemana-schema.cjs');
console.log(`begin; select bos_import_lemana_order('${owner}',$row$${JSON.stringify(row())}$row$::jsonb)->>'kind'; select pg_sleep(1); commit;`);
JS
"${psql[@]}" -At < "$tmpdir/call.sql" > "$tmpdir/first" & first=$!
"${psql[@]}" -At < "$tmpdir/call.sql" > "$tmpdir/second" & second=$!
wait "$first"; wait "$second"
cat "$tmpdir/first" "$tmpdir/second" | sort > "$tmpdir/results"
test "$(grep -c '^created$' "$tmpdir/results")" = 1
test "$(grep -c '^skipped$' "$tmpdir/results")" = 1
# Race an importer against a manual order from another source. No test-side locks.
node - <<'JS' > "$tmpdir/import.sql"
const {row,owner}=require('./tests/helpers/lemana-schema.cjs');
console.log(`begin; select bos_import_lemana_order('${owner}',$row$${JSON.stringify(row('00043'))}$row$::jsonb)->>'kind'; select pg_sleep(1); commit;`);
JS
cat > "$tmpdir/manual.sql" <<'SQL'
begin;
do $$begin
 insert into orders(source,external_source,external_id,order_number,client,address,work)
 values('Телефон','mini_app','app_concurrent','00043','Тест','Тест','Тест');
 exception when unique_violation then null;
end$$;
select pg_sleep(1);
commit;
SQL
"${psql[@]}" -At < "$tmpdir/import.sql" > "$tmpdir/import-result" & first=$!
"${psql[@]}" -At < "$tmpdir/manual.sql" > "$tmpdir/manual-result" & second=$!
wait "$first"; wait "$second"
"${psql[@]}" <<'SQL'
do $$begin
 if (select count(*) from orders where order_number='00042')<>1 then raise exception 'Concurrent duplicate';end if;
 if (select count(*) from orders where order_number='00043')<>1 then raise exception 'Cross-source concurrent duplicate';end if;
 if (select master_payout from orders where id=1)<>321 then raise exception 'Historic payout changed';end if;
end$$;
SQL
echo 'PASS: independent PostgreSQL sessions created one order; history unchanged'
