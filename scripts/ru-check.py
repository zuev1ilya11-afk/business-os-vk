#!/usr/bin/env python3
"""Read-only RU intake diagnosis. Prints metadata/counts, never credentials or rows.

Run on the Docker host: python3 ru-check.py [external_order_id]
No installs, writes, restarts, provider requests, imports or notifications.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

SYNC_BYTES = 738  # Filled from the reviewed public v11 fixture.
SYNC_SHA256 = "a632f57d533e429cabb3493b0928d5fbebfa5852007cd9b7f28b9830e754f7f1"


class CheckError(Exception):
    pass


def run(args, timeout=20):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise CheckError("command unavailable or timed out") from None
    if result.returncode:
        # Docker/psql errors can include sensitive connection data.
        raise CheckError("command failed; exit=" + str(result.returncode))
    return result.stdout


def emit(key, value):
    print(key + "=" + json.dumps(value, ensure_ascii=True, separators=(",", ":")))


def name(container):
    return container["Name"].lstrip("/")


def env(container):
    return dict(item.split("=", 1) for item in container["Config"].get("Env", []) if "=" in item)


def find_db(rest, containers):
    uri = env(rest).get("PGRST_DB_URI", "")
    try:
        parsed = urlsplit(uri)
        if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
            raise ValueError()
        dbname = unquote(parsed.path.lstrip("/"))
        if not re.fullmatch(r"[A-Za-z0-9_]+", dbname):
            raise ValueError()
        host = parsed.hostname
    except ValueError:
        raise CheckError("REST database connection format unknown") from None
    rest_networks = rest["NetworkSettings"]["Networks"]
    found = []
    for item in containers:
        if not name(item).endswith("-db"):
            continue
        networks = item["NetworkSettings"]["Networks"]
        for network in set(rest_networks) & set(networks):
            info = networks[network]
            aliases = (info.get("Aliases") or []) + (info.get("DNSNames") or [])
            if host in [name(item), info.get("IPAddress"), *aliases]:
                found.append(item)
                break
    if len(found) != 1:
        raise CheckError("REST database target is missing or ambiguous")
    return found[0], dbname


def sql(db, dbname, query):
    # Each call is an explicit read-only transaction, regardless of DB defaults.
    statement = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; " + query + "; COMMIT;"
    output = run(["docker", "exec", "-u", "postgres", db["Id"], "psql", "-X", "-qAt",
                  "-U", "postgres", "-d", dbname, "-v", "ON_ERROR_STOP=1", "-c", statement])
    return json.loads(output.strip())


def columns(db, dbname, table):
    return sql(db, dbname, "SELECT coalesce(json_agg(column_name),'[]'::json) "
               "FROM information_schema.columns WHERE table_schema='public' AND table_name='" + table + "'")


def incident_predicate(incident):
    if not re.fullmatch(r"[0-9]{1,20}", incident):
        raise CheckError("numeric external order ID required")
    # Private v11 imports use hands:<id>; retain compatibility with legacy bare IDs.
    return ("external_source='hands' AND CAST(external_id AS TEXT) IN ('" + incident +
            "','hands:" + incident + "')")


def sources(edge):
    root = None
    for mount in edge.get("Mounts", []):
        if mount.get("Destination") == "/bos-src" and mount.get("Type") == "bind":
            root = pathlib.Path(mount["Source"]).resolve()
    if root is None or not root.is_relative_to(pathlib.Path("/opt/business-os/deploy")):
        raise CheckError("source mount differs from reviewed RU layout")
    emit("sources", str(root))
    matches = []
    for path in root.rglob("*.ts"):
        if len(matches) >= 8:
            break
        if "hands-api" not in path.parts and path.name != "hands-api.ts":
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(root) or path.stat().st_size > 2000000:
            continue
        content = path.read_bytes()
        marker = b"async function syncOrders("
        start = content.find(marker)
        if start < 0:
            continue
        exact = (content.count(marker) == 1 and
                 hashlib.sha256(content[start:start + SYNC_BYTES]).hexdigest() == SYNC_SHA256 and
                 (len(content) == start + SYNC_BYTES or content[start + SYNC_BYTES:start + SYNC_BYTES + 1] == b"\n"))
        matches.append({"file": str(path.relative_to(root)), "v11_sync_exact": exact,
                        "sync_helper_present": b"hands-sync.ts" in content,
                        "old_supabase_host_present": b"obsropbslfwtanyspjbi.supabase.co" in content})
    emit("hands_source", matches)


def main():
    incident = sys.argv[1] if len(sys.argv) == 2 else None
    if len(sys.argv) > 2 or (incident is not None and not re.fullmatch(r"[0-9]{1,20}", incident)):
        raise CheckError("usage: python3 ru-check.py [numeric_external_id]")
    print("BOS_RU_CHECK_V1 READ_ONLY")
    ids = run(["docker", "ps", "-q"]).split()
    if not ids:
        raise CheckError("no running containers")
    containers = json.loads(run(["docker", "inspect", *ids]))
    edges = [item for item in containers if name(item).startswith("bos-release-") and name(item).endswith("-edge")]
    if len(edges) != 1:
        raise CheckError("expected exactly one running RU release edge")
    edge = edges[0]
    prefix = name(edge)[:-len("-edge")]
    emit("release", prefix)
    emit("running_db_containers", [name(item) for item in containers if name(item).endswith("-db")])
    try:
        sources(edge)
    except (CheckError, OSError) as error:
        emit("source_check", str(error) if isinstance(error, CheckError) else "source read unavailable")
    rests = [item for item in containers if name(item) == prefix + "-rest"]
    if len(rests) != 1:
        raise CheckError("release REST container not found")
    db, dbname = find_db(rests[0], containers)
    emit("rest_database_target", name(db))
    cols = columns(db, dbname, "orders")
    if not {"external_source", "external_id", "created_at"}.issubset(cols):
        raise CheckError("orders schema differs; no application rows queried")
    emit("orders", sql(db, dbname, "SELECT json_build_object('total',count(*),"
         "'hands',count(*) FILTER(WHERE external_source='hands'),"
         "'latest_created_at',max(created_at),'latest_hands_created_at',"
         "max(created_at) FILTER(WHERE external_source='hands'),'checked_at',now()) FROM public.orders"))
    if incident is not None:
        emit("incident_matches", sql(db, dbname, "SELECT to_json(count(*)) FROM public.orders "
             "WHERE " + incident_predicate(incident)))
    emit("orders_unique_keys", sql(db, dbname, "SELECT coalesce(json_agg(keys),'[]'::json) FROM ("
         "SELECT array_agg(a.attname ORDER BY k.n) AS keys FROM pg_index i "
         "CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,n) "
         "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum "
         "WHERE i.indrelid='public.orders'::regclass AND i.indisunique AND i.indisvalid "
         "AND k.n<=i.indnkeyatts GROUP BY i.indexrelid) x"))
    tables = sql(db, dbname, "SELECT coalesce(json_agg(tablename),'[]'::json) FROM pg_tables "
                 "WHERE schemaname='public' AND tablename LIKE '%hands%' AND tablename LIKE '%webhook%'")
    emit("webhook_tables", tables)
    for table in tables[:3]:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", table):
            continue
        table_cols = columns(db, dbname, table)
        time_col = next((key for key in ("received_at", "created_at") if key in table_cols), None)
        if time_col:
            emit("webhook_receipts", sql(db, dbname, "SELECT json_build_object('total',count(*),"
                 "'latest',max(" + time_col + ")) FROM public." + table))
    try:
        emit("cron", sql(db, dbname, "SELECT json_build_object('total',count(*),"
             "'active',count(*) FILTER(WHERE active)) FROM cron.job"))
    except CheckError:
        emit("cron", "unavailable")
    print("BOS_RU_CHECK_DONE (no changes made)")


if __name__ == "__main__":
    try:
        main()
    except CheckError as error:
        emit("CHECK_STOPPED", str(error))
        sys.exit(1)
    except Exception as error:
        # Do not print exception text/tracebacks with private config or query output.
        emit("CHECK_STOPPED", type(error).__name__)
        sys.exit(1)
