"""Summarize retained PostgreSQL logs using only fixed public-safe vocabulary.

This reader does not execute SQL or return source log lines. The headline
category is taken from actual ERROR/FATAL/PANIC records; startup LOG/NOTICE
messages cannot replace it. Unknown values, quoted strings, paths, numeric
identifiers and multiline DETAIL/HINT/CONTEXT/STATEMENT content are omitted.
"""
import re

MAX_BYTES = 128 * 1024
MAX_EVENTS = 16
LOG_NAMES = ('db', 'init', 'bootstrap')
SEVERITIES = frozenset(('ERROR', 'FATAL', 'PANIC', 'LOG', 'WARNING', 'NOTICE'))
SQLSTATES = frozenset(('0A000', '08001', '08006', '22023', '25006', '28000',
    '28P01', '3D000', '3F000', '42501', '42601', '42703', '42704', '42804',
    '42883', '42P01', '42P02', '53100', '53200', '53300', '53400', '55000',
    '55P03', '57014', '57P01', '57P02', '57P03', '58030', '58P01', 'XX000',
    'XX001', 'XX002'))
IDENTIFIERS = frozenset('''
pg_stat_activity pg_stat_get_activity pg_authid pg_roles pg_db_role_setting
pg_extension pg_trigger pg_stat_statements pg_cron pg_net pg_tle pgaudit
pgsodium supabase_vault pgcrypto plpgsql pg_graphql uuid-ossp http pgjwt
public.orders public.business_staff storage.objects public.guard_order_completion
trg_guard_order_completion shared_preload_libraries session_preload_libraries
local_preload_libraries search_path transaction_read_only default_transaction_read_only
cron.database_name cron.launch_active_jobs cron.max_running_jobs cron.use_background_workers
pg_net.database_name pg_net.batch_size pgtle.enable_clientauth pgtle.enable_password_check
pg_stat_statements.track pgaudit.log pgaudit.log_client pgaudit.role
max_worker_processes max_parallel_workers max_logical_replication_workers
max_wal_senders server_version_num listen_addresses json_build_object json_agg
current_setting current_database to_regprocedure to_regclass count
'''.split())
# Tokens are constants, not arbitrary matched text. They keep an unrecognized
# error useful while preventing database values, passwords and SQL from export.
WORDS = frozenset('''
could not cannot failed to open access read write load find create remove rename
directory file library shared object memory segment resource relation schema
database role user function column operator type parameter configuration setting
permission denied does exist exists missing unavailable invalid value argument
unrecognized syntax error at or near for in on of is are must be loaded preload
extension control runtime connection server socket address closed refused timeout
timed out starting shutting down recovery ready accepting connections authentication
password login authorized no such and the a an this with without from as by
disk space left device too many locks files descriptors process processes workers
out allocate allocation available requested unsupported supported version incompatible
collation locale provider encoding mismatch changed undefined ambiguous duplicate
execute query statement select transaction read-only aborted canceled canceling
statement_timeout check invalidated damaged corrupt corrupted corruption block page
unexpected end input eof checksum header checkpoint record wal redo startup
administrator superuser owner member requires required allowed permitted only
integer bigint smallint text boolean json jsonb oid xid uuid unknown cast convert
set reset option options parameter parameters count column columns aggregate
extension extensions initializing initialized disabled enabled system tables table
cache entry lookup index indexes catalog internal fatal panic found path permission
readiness exists target source input output busy limit exceeded exhausted terminating
'''.split())
_PREFIX = (r'(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}'
           r'(?:\.\d+)?(?:\s+(?:UTC|GMT|[+-]\d{2}(?::?\d{2})?))?\s+)?'
           r'(?:\[\d+\]\s+)?')
_RECORD = re.compile(r'^' + _PREFIX + r'(ERROR|FATAL|PANIC|LOG|WARNING|NOTICE):\s*'
                     r'(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)$')
_QUOTED = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'')


def _category(message, state):
    low = message.lower()
    if state == '53100' or 'no space left on device' in low:
        return 'DISK_FULL'
    if state == '53200' or 'out of memory' in low or 'cannot allocate memory' in low:
        return 'OUT_OF_MEMORY'
    if 'read-only file system' in low:
        return 'READ_ONLY_FILESYSTEM'
    if state == '25006' or 'read-only transaction' in low:
        return 'READ_ONLY_TRANSACTION'
    if 'shared_preload_libraries' in low and ('must be loaded' in low or 'not in' in low):
        return 'PRELOAD_REQUIRED'
    if state == '28P01' or 'password authentication failed' in low:
        return 'DATABASE_AUTHENTICATION_FAILED'
    if state == '42501' or 'permission denied' in low or 'must be superuser' in low:
        return 'DATABASE_PRIVILEGE_DENIED'
    if 'unrecognized configuration parameter' in low:
        return 'CONFIGURATION_PARAMETER_UNKNOWN'
    if 'invalid value for parameter' in low or 'cannot be changed' in low:
        return 'CONFIGURATION_PARAMETER_INVALID'
    if ('extension control file' in low or re.match(r'extension .+ is not available', low)):
        return 'EXTENSION_UNAVAILABLE'
    if ('could not load library' in low or 'could not load shared library' in low
            or ('could not access file' in low and ('$libdir' in low or '.so' in low))):
        return 'SHARED_LIBRARY_UNAVAILABLE'
    if ('could not open shared memory segment' in low or 'shared memory' in low):
        return 'SHARED_MEMORY_FAILURE'
    if (state in ('XX001', 'XX002') or any(x in low for x in
            ('invalid page', 'invalid checkpoint', 'checksum mismatch', 'database system is corrupted'))):
        return 'DATABASE_CORRUPTION_REPORTED'
    if state == '58P01' or 'no such file or directory' in low:
        return 'FILE_MISSING'
    if state == '42P01' or re.match(r'relation .+ does not exist', low):
        return 'RELATION_MISSING'
    if state == '42703' or re.match(r'column .+ does not exist', low):
        return 'COLUMN_MISSING'
    if state == '42883' or re.match(r'function .+ does not exist', low):
        return 'FUNCTION_MISSING'
    if re.match(r'role .+ does not exist', low):
        return 'ROLE_MISSING'
    if state == '3D000' or re.match(r'database .+ does not exist', low):
        return 'DATABASE_MISSING'
    if state == '42601' or 'syntax error' in low:
        return 'SQL_SYNTAX_ERROR'
    if state == '57014' or 'statement timeout' in low:
        return 'SQL_TIMEOUT'
    if state == '0A000' or 'not supported' in low:
        return 'FEATURE_UNSUPPORTED'
    if 'collation' in low or 'locale' in low:
        return 'LOCALE_OR_COLLATION_FAILURE'
    if state in ('53300', '53400') or 'too many' in low or 'limit exceeded' in low:
        return 'RESOURCE_LIMIT'
    return 'UNCLASSIFIED_DATABASE_MESSAGE'


def _known_identifiers(message):
    # Compare bounded tokens to constants; never echo an arbitrary substring.
    tokens = set(re.findall(r'[A-Za-z_][A-Za-z0-9_.-]*', message[:8192]))
    return sorted(IDENTIFIERS.intersection(tokens))


def _path_kinds(message):
    matches = []
    patterns = (
        ('PGDATA_RELATION', r'(?:^|[\s"\'])?(?:/bos/data/)?(?:base/\d+/\d+|global/\d+)'),
        ('PGDATA_WAL', r'(?:/bos/data/)?pg_wal/'),
        ('PGDATA_STATISTICS', r'(?:/bos/data/)?pg_stat(?:_tmp)?/'),
        ('PGDATA_LOGICAL', r'(?:/bos/data/)?pg_logical/'),
        ('POSTGRES_LIBRARY', r'\$libdir/|/[^\s"\']*postgresql[^\s"\']*\.so\b'),
        ('POSTGRES_SOCKET', r'/tmp/\.s\.PGSQL\.5432\b'),
        ('POSTGRES_CONFIG', r'/bos/data/(?:postgresql(?:\.auto)?\.conf|pg_hba\.conf|pg_ident\.conf)\b'),
        ('POSTGRES_SHMEM', r'/PostgreSQL\.\d+'),
    )
    for label, pattern in patterns:
        if re.search(pattern, message):
            matches.append(label)
    return matches


def _terms(message):
    # Strip all strings/paths/numbers before the allowlist; a quoted password
    # made entirely of ordinary English words still cannot be returned.
    clean = _QUOTED.sub(' REDACTED ', message[:8192])
    clean = re.sub(r'(?:\$libdir|[A-Za-z][A-Za-z0-9+.-]*://|/)[^\s]*', ' REDACTED ', clean)
    tokens = re.findall(r'[A-Za-z_][A-Za-z0-9_.-]*|\d+', clean.lower())
    out = []
    for token in tokens[:128]:
        value = token if token in WORDS else '[REDACTED]'
        if value != '[REDACTED]' or not out or out[-1] != value:
            out.append(value)
        if len(out) >= 64:
            break
    return out


def summarize(raw):
    if not isinstance(raw, bytes):
        raw = b''
    content = raw[:MAX_BYTES]
    errors, notices = [], []
    counts = {level: 0 for level in sorted(SEVERITIES)}
    for line in content.decode('utf-8', errors='replace').splitlines():
        match = _RECORD.fullmatch(line)
        if not match:
            continue
        level, state, message = match.groups()
        counts[level] += 1
        state = state if state in SQLSTATES else None
        event = {'severity': level, 'category': _category(message, state),
                 'sqlstate': state, 'known_identifiers': _known_identifiers(message),
                 'path_kinds': _path_kinds(message), 'message_terms': _terms(message)}
        target = errors if level in ('ERROR', 'FATAL', 'PANIC') else notices
        if len(target) < MAX_EVENTS:
            target.append(event)
    return {'evidence_bytes': len(content), 'truncated': len(raw) > MAX_BYTES,
            'severity_counts': counts, 'errors': errors, 'startup_messages': notices,
            'primary_category': errors[0]['category'] if errors else 'NO_SERVER_ERROR_RECORD',
            'events_truncated': sum(counts.values()) > len(errors) + len(notices)}


def collect_logs(raw_logs):
    return {name: summarize(raw_logs.get(name, b'')) for name in LOG_NAMES}
