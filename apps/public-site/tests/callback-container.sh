#!/usr/bin/env bash
# Run on a disposable CI host, after the hm-phone-smoke image has been built.
set -euo pipefail
database="hm-qa-db-${GITHUB_RUN_ID:?}"
site="hm-qa-intake-${GITHUB_RUN_ID}"
password="$(openssl rand -hex 24)"
cleanup() { docker rm -f "$site" "$database" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$database" -e POSTGRES_PASSWORD="$password" \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
for i in $(seq 1 40); do
  if docker exec "$database" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 1
done
psql_qa() { docker exec -i "$database" psql -XAtq -v ON_ERROR_STOP=1 -U postgres; }
psql_qa < client-portal/staging/base.sql
psql_qa < supabase/migrations/20261020140000_manual_order_intake.sql
psql_qa < apps/public-site/lib/site-intake.sql
printf "alter role hm_site_intake password '%s';\n" "$password" | psql_qa
port="$(docker port "$database" 5432/tcp | cut -d: -f2)"
docker run -d --name "$site" --network host --read-only --tmpfs /tmp \
  --tmpfs /app/apps/public-site/.next/cache -e HOST=127.0.0.1 -e PORT=4186 \
  -e WEBSITE_INTAKE_DATABASE_URL="postgresql://hm_site_intake:$password@127.0.0.1:$port/postgres" hm-phone-smoke >/dev/null
curl -fsS --retry 20 --retry-all-errors --retry-delay 1 http://127.0.0.1:4186/healthz
node apps/public-site/tests/callback-browser.cjs
result="$(printf "%s\n" "select count(*) from orders where phone='+79990001122' and source='website' and master_staff_id is null and not amount_confirmed and amount=0;" | psql_qa)"
test "$result" = "1"
echo "Confirmed one unassigned callback in PostgreSQL through the dedicated login."
