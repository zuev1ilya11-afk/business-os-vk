#!/usr/bin/env python3
"""Bounded, read-only host evidence. Never reads app secrets or customer rows.

Run on the intended host, not in the development container. Writes only stdout.
An unavailable measurement stays unavailable; it never becomes a capacity claim.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def run(argv, limit=256_000, timeout=15):
    try:
        result = subprocess.run(argv, capture_output=True, timeout=timeout, check=False)
        if result.returncode:
            return {"available": False, "reason": "command_failed", "exit_code": result.returncode}
        if len(result.stdout) > limit:
            return {"available": False, "reason": "output_limit"}
        return {"available": True, "value": result.stdout.decode("utf-8", "replace").strip()}
    except (OSError, subprocess.TimeoutExpired):
        return {"available": False, "reason": "command_unavailable_or_timeout"}


def memory():
    try:
        allowed = {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}
        return {line.split(":")[0] + "_KiB": int(line.split()[1])
                for line in Path("/proc/meminfo").read_text().splitlines()
                if line.split(":")[0] in allowed}
    except (OSError, ValueError):
        return {"available": False}


def disk(path):
    try:
        value = shutil.disk_usage(path)
        return {"path": str(path), "total_bytes": value.total, "free_bytes": value.free}
    except OSError:
        return {"path": str(path), "available": False}


def directory_summary(path, maximum=100_000):
    """Sizes only, never filenames or contents; do not follow symlinks."""
    files, size, incomplete = 0, 0, False
    try:
        root = Path(path)
        if not root.is_dir() or root.is_symlink():
            return {"available": False, "reason": "not_a_real_directory"}
        for base, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if not Path(base, d).is_symlink()]
            for name in names:
                p = Path(base, name)
                if p.is_symlink():
                    continue
                try:
                    size += p.stat().st_size
                    files += 1
                except OSError:
                    incomplete = True
                if files >= maximum:
                    return {"files_at_least": files, "bytes_at_least": size, "complete": False}
        return {"files": files, "bytes": size, "complete": not incomplete}
    except OSError:
        return {"available": False, "reason": "unreadable"}


def identifier(value):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,100}", value):
        raise argparse.ArgumentTypeError("use a plain existing container/database/user name")
    return value


SCHEMA_SQL = """
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT json_build_object(
 'database_bytes',pg_database_size(current_database()),
 'orders_columns',(SELECT coalesce(json_agg(column_name ORDER BY ordinal_position),'[]'::json)
   FROM information_schema.columns WHERE table_schema='public' AND table_name='orders'),
 'registration_triggers',(SELECT coalesce(json_agg(json_build_object('schema',event_object_schema,
   'table',event_object_table,'trigger',trigger_name,'event',event_manipulation)),'[]'::json)
   FROM information_schema.triggers WHERE (event_object_schema='auth' AND event_object_table='users')
   OR (event_object_schema='public' AND event_object_table='business_staff')),
 'portal_tables',(SELECT coalesce(json_agg(table_name),'[]'::json)
   FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'client_%')
);
ROLLBACK;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage-dir", type=Path)
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--postgres-container", type=identifier)
    parser.add_argument("--database", type=identifier, default="postgres")
    parser.add_argument("--database-user", type=identifier, default="postgres")
    args = parser.parse_args()
    result = {
        "captured_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "kind": "single_read_only_snapshot_not_a_capacity_guarantee",
        "cpu_logical": os.cpu_count(), "memory": memory(), "disks": [disk(Path("/"))],
        "uptime": run(["uptime"]),
        "docker_statistics": run(["docker", "stats", "--no-stream", "--format", "{{json .}}"]),
        "docker_states": [],
        "backup_restore_tested": False,
        "historical_peaks_measured": False,
        "production_identity_verified": False,
    }
    ids = run(["docker", "ps", "-aq"], limit=32_000)
    if ids.get("available"):
        for cid in ids["value"].splitlines()[:100]:
            if re.fullmatch(r"[a-f0-9]{12,64}", cid):
                # Explicit projection: no Config.Env, labels, logs, or mounted secrets.
                fmt = '{"id":"{{.Id}}","name":"{{.Name}}","state":{{json .State.Status}},"oom_killed":{{.State.OOMKilled}},"restarts":{{.RestartCount}},"memory_limit":{{.HostConfig.Memory}},"nano_cpus":{{.HostConfig.NanoCpus}}}'
                state = run(["docker", "inspect", "--format", fmt, cid], limit=8_000)
                if state.get("available"):
                    try:
                        result["docker_states"].append(json.loads(state["value"]))
                    except ValueError:
                        result["docker_states"].append({"available": False})
    for kind in ("storage", "backup"):
        path = getattr(args, kind + "_dir")
        if path:
            result[kind + "_metadata"] = directory_summary(path)
            result["disks"].append(disk(path))
    if args.postgres_container:
        sql = run(["docker", "exec", args.postgres_container, "psql", "-X", "-w", "-qAt",
                   "-v", "ON_ERROR_STOP=1", "-U", args.database_user, "-d", args.database,
                   "-c", SCHEMA_SQL], timeout=10)
        if sql.get("available"):
            try:
                result["database"] = json.loads(sql["value"])
            except ValueError:
                result["database"] = {"available": False, "reason": "unexpected_result"}
        else:
            result["database"] = sql
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
