"""Minimal PostgreSQL runtime for restoring captured Supabase extensions.

Only extension names/versions and the database name come from capture metadata.
No source GUC, image environment, startup script or key-fetch command is reused.
The extension allowlist below is deliberately not a list of every installed
extension: most extensions can be created without shared preloading.

Upstream constraints checked for this profile:
* pg_cron v1.6.4 needs preload and the matching cron.database_name. Its worker
  mode computes max_worker_processes - 1, so worker mode must remain OFF when
  max_worker_processes is zero.
* pg_net v0.20.4 needs preload; PostgreSQL 17 RegisterBackgroundWorker logs and
  returns when the zero-worker limit is reached. Its shared-memory setup still
  runs. The extension SQL does not invoke wait_until_running or HTTP functions.
* pgaudit and pg_tle require shared preload. pg_tle clientauth and password-check
  hooks remain explicitly disabled.
* pgsodium and supabase_vault must NOT be preloaded here: their preload paths
  execute a getkey script. Their ordinary load paths return before doing so.

This permits logical restoration, not validation of Vault plaintext or TCE keys.

Primary implementation references (reviewed without executing upstream code):
https://github.com/postgres/postgres/blob/REL_17_11/src/backend/postmaster/bgworker.c
https://github.com/citusdata/pg_cron/blob/v1.6.4/src/pg_cron.c
https://github.com/citusdata/pg_cron/blob/v1.6.4/pg_cron.sql
https://github.com/supabase/pg_net/blob/v0.20.4/src/worker.c
https://github.com/supabase/pg_net/blob/v0.20.4/sql/pg_net.sql
https://github.com/pgaudit/pgaudit/blob/17.0/pgaudit.c
https://github.com/aws/pg_tle/blob/v1.4.0/src/clientauth.c
https://github.com/aws/pg_tle/blob/main/src/tleextension.c
https://github.com/michelp/pgsodium/blob/main/src/pgsodium.c
https://github.com/supabase/vault/blob/main/src/supabase_vault.c
"""
from dataclasses import dataclass
import re


# These names are literals, never paths or arbitrary metadata values.
SHARED_PRELOADS = ('pg_cron', 'pg_net', 'pg_stat_statements', 'pg_tle', 'pgaudit')
NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_.-]{0,127}')
VERSION = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}')
DATABASE = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,62}')

# Rows have exactly [extension_name, available_version, default_version].
# pg_dump's ordinary CREATE EXTENSION omits VERSION, so checking only whether
# the archived version is available would permit silent restoration at a newer
# version. Reject that situation before loading globals or database SQL.
AVAILABLE_EXTENSIONS_SQL = """SELECT coalesce(json_agg(
 json_build_array(v.name,v.version,a.default_version)
 ORDER BY v.name,v.version),'[]'::json)
FROM pg_available_extension_versions AS v
JOIN pg_available_extensions AS a USING(name);"""


class ProfileError(Exception):
    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__(reason_code)


def require(condition, reason='DRILL_DATABASE_METADATA_INVALID'):
    if not condition:
        raise ProfileError(reason)


@dataclass(frozen=True)
class RuntimeProfile:
    database: str
    extensions: tuple
    preloads: tuple
    # Every item is a single argv argument to postgres -c, never shell code.
    startup_settings: tuple
    # Only settings legal in startup PGOPTIONS; no POSTMASTER/SIGHUP GUCs.
    pgoptions: tuple


def build_runtime_profile(database_metadata):
    require(isinstance(database_metadata, dict))
    database = database_metadata.get('database')
    require(isinstance(database, str) and DATABASE.fullmatch(database))
    extensions = database_metadata.get('extensions')
    require(isinstance(extensions, list) and len(extensions) <= 1000)
    by_name = {}
    for row in extensions:
        require(isinstance(row, list) and len(row) == 2)
        name, version = row
        require(isinstance(name, str) and NAME.fullmatch(name)
                and isinstance(version, str) and VERSION.fullmatch(version)
                and name not in by_name)
        by_name[name] = version
    preloads = tuple(name for name in SHARED_PRELOADS if name in by_name)
    settings = [
        'shared_preload_libraries=' + ','.join(preloads),
        'session_preload_libraries=', 'local_preload_libraries=',
        'max_worker_processes=0', 'max_parallel_workers=0',
        'max_logical_replication_workers=0', 'max_wal_senders=0',
        'autovacuum=off',
    ]
    options = ['session_preload_libraries=', 'local_preload_libraries=']
    if 'pg_cron' in by_name:
        settings += [
            'cron.database_name=' + database,
            'cron.launch_active_jobs=off', 'cron.max_running_jobs=0',
            'cron.use_background_workers=off', 'cron.log_statement=off',
            'cron.log_run=off',
        ]
    if 'pg_net' in by_name:
        settings += ['pg_net.database_name=' + database, 'pg_net.batch_size=0']
    if 'pg_tle' in by_name:
        settings += ['pgtle.enable_clientauth=off', 'pgtle.enable_password_check=off']
    if 'pg_stat_statements' in by_name:
        options += ['pg_stat_statements.track=none']
    if 'pgaudit' in by_name:
        options += ['pgaudit.log=none', 'pgaudit.log_client=off', 'pgaudit.role=']
    # Database/role settings may override session-settable settings. Apply them
    # at postmaster start AND for each restore/validation client connection.
    settings += options[2:]
    return RuntimeProfile(database, tuple(sorted(by_name.items())), preloads,
                          tuple(settings), tuple(options))


def check_available_extensions(profile, rows):
    """Refuse unavailable or different default versions before starting restore.

    A matching default is necessary because the genuine dump is not rewritten.
    No extension is installed or upgraded by this function.
    """
    reason = 'DRILL_EXTENSION_PREFLIGHT_INVALID'
    require(isinstance(profile, RuntimeProfile), reason)
    require(isinstance(rows, list) and len(rows) <= 20000, reason)
    available, defaults = set(), {}
    for row in rows:
        require(isinstance(row, list) and len(row) == 3, reason)
        name, version, default = row
        require(isinstance(name, str) and NAME.fullmatch(name)
                and isinstance(version, str) and VERSION.fullmatch(version)
                and (default is None or isinstance(default, str)
                     and VERSION.fullmatch(default)), reason)
        require((name, version) not in available, reason)
        require(name not in defaults or defaults[name] == default, reason)
        available.add((name, version))
        defaults[name] = default
    for name, version in profile.extensions:
        require((name, version) in available, 'DRILL_EXTENSION_VERSION_UNAVAILABLE')
        require(defaults[name] == version,
                'DRILL_EXTENSION_DEFAULT_VERSION_MISMATCH')
    return True
