"""Summarize retained database and runtime logs with fixed safe vocabulary.

This reader does not execute SQL or return source log lines. The headline
category is taken from actual ERROR/FATAL/PANIC records; startup LOG/NOTICE
messages cannot replace it. Unknown values, quoted strings, paths, numeric
identifiers and multiline DETAIL/HINT/CONTEXT/STATEMENT content are omitted.
Runtime cause chains are recognized only after an actual error prefix; their
messages pass through the same sanitizer and never become raw output.
"""
import json
import re

MAX_BYTES = 128 * 1024
MAX_EVENTS = 16
LOG_NAMES = ('db', 'init', 'bootstrap', 'command', 'rest', 'auth', 'storage', 'edge', 'https')
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
auth public storage extensions schema_migrations auth.schema_migrations auth.users auth.sessions
supabase_auth_admin supabase_storage_admin authenticator postgres supabase_admin
anon authenticated service_role
Deno EdgeRuntime SyntaxError TypeError ReferenceError RangeError URIError EvalError AggregateError
REPORT_ENV_INVALID
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
worker main boot bootstrap graph module modules import imports map specifier export
exports named provide resolve resolution fetch download sending request url dns
network unreachable reset connect host service temporary failure tls certificate
issuer peer entrypoint uncaught promise javascript typescript deno rust event loop
escaped unexpectedly caused because expected reserved word panic panicked thread
relative absolute prefixed cache cached dependency dependencies lockfile
'''.split())
_PREFIX = (r'(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}'
           r'(?:\.\d+)?(?:\s+(?:UTC|GMT|[+-]\d{2}(?::?\d{2})?))?\s+)?'
           r'(?:\[\d+\]\s+)?')
_RECORD = re.compile(r'^' + _PREFIX + r'(ERROR|FATAL|PANIC|LOG|WARNING|NOTICE):\s*'
                     r'(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)$')
_QUOTED = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'')
_ANSI = re.compile(r'\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]')
_ISO = r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})'
_LEVELS = {'fatal': 'FATAL', 'panic': 'PANIC', 'error': 'ERROR',
           'warn': 'WARNING', 'warning': 'WARNING', 'info': 'LOG', 'log': 'LOG',
           'debug': 'LOG', 'trace': 'LOG', 'notice': 'NOTICE'}
_PLAIN = re.compile(r'^(error|fatal|panic|warn(?:ing)?|info|log|notice):\s*'
                    r'(?:([0-9A-Z]{5}):\s*)?(.*)$', re.IGNORECASE)
_TRACING = re.compile(r'^(?:' + _ISO + r'\s+)?(ERROR|FATAL|PANIC|WARN|WARNING|INFO|DEBUG|TRACE)\s+'
                      r'(?:[A-Za-z_][A-Za-z0-9_.:-]{0,127}:\s+)?(.*)$', re.IGNORECASE)
_BRACKET = re.compile(r'^\[(?:' + _ISO + r'\s+)?(ERROR|FATAL|PANIC|WARN|WARNING|INFO|DEBUG|TRACE)'
                     r'(?:\s+[A-Za-z_][A-Za-z0-9_.:-]{0,127})?\]\s*(.*)$', re.IGNORECASE)
_WORKER = re.compile(r'^(?:(?:Error|InvalidWorkerCreation):\s*)?(?:main )?worker boot error\b|'
                     r'^runtime has escaped from the event loop unexpectedly:|'
                     r'^event loop error:', re.IGNORECASE)
_RUST_PANIC = re.compile(r'^thread (?:\'[^\'\r\n]{0,128}\'|"[^"\r\n]{0,128}") panicked at\b')
JS_ERRORS = frozenset(('SyntaxError', 'TypeError', 'ReferenceError', 'RangeError',
                      'URIError', 'EvalError', 'AggregateError'))
_JS_ERROR = re.compile(r'^(?:Uncaught(?: \(in promise\))?\s+)?('
                       + '|'.join(sorted(JS_ERRORS)) + r'):\s*')
OS_ERRNOS = {1: 'EPERM', 2: 'ENOENT', 12: 'ENOMEM', 13: 'EACCES', 21: 'EISDIR',
            22: 'EINVAL', 24: 'EMFILE', 28: 'ENOSPC', 30: 'EROFS', 98: 'EADDRINUSE',
            101: 'ENETUNREACH', 104: 'ECONNRESET', 110: 'ETIMEDOUT', 111: 'ECONNREFUSED'}
_GENERIC = frozenset(('UNCLASSIFIED_DATABASE_MESSAGE', 'WORKER_BOOT_FAILED', 'RUNTIME_PANIC'))


def _os_errno(message):
    clean = _QUOTED.sub(' ', message[:8192])
    match = re.search(r'\(os error (\d{1,3})\)', clean, re.IGNORECASE)
    return OS_ERRNOS.get(int(match.group(1))) if match else None


def _javascript_error(message):
    clean = _QUOTED.sub(' ', message[:8192])
    for name in sorted(JS_ERRORS):
        if re.search(r'\b' + name + r'\b', clean):
            return name
    return None


def _main_location(message):
    # Only the fixed captured gateway entrypoint is identifiable. No function,
    # customer filename, arbitrary path or source line can leave this parser.
    match = re.search(r'(?<![A-Za-z0-9_/.-])(?:file://)?/bos-main/index\.ts:(\d{1,6}):(\d{1,6})(?!\d)',
                      message[:8192])
    if match:
        line, column = map(int, match.groups())
        if 1 <= line <= 999999 and 1 <= column <= 999999:
            return {'line': line, 'column': column}
    return None


def _category(message, state):
    low = message.lower()
    errno = _os_errno(message)
    if state == '42501':
        return 'DATABASE_PRIVILEGE_DENIED'
    # Reviewed literal from deploy/report-acceptance/runtime-stage.py ENV_HELPER.
    # Recognize this one project error; never export arbitrary uppercase codes.
    if re.search(r'(?<![A-Za-z0-9_])REPORT_ENV_INVALID(?![A-Za-z0-9_])',
                 _QUOTED.sub(' ', message[:8192])):
        return 'GATEWAY_REPORT_CONFIG_INVALID'
    if state == '53100' or 'no space left on device' in low or errno == 'ENOSPC':
        return 'DISK_FULL'
    if state == '53200' or 'out of memory' in low or 'cannot allocate memory' in low or errno == 'ENOMEM':
        return 'OUT_OF_MEMORY'
    if 'read-only file system' in low or errno == 'EROFS':
        return 'READ_ONLY_FILESYSTEM'
    if state == '25006' or 'read-only transaction' in low:
        return 'READ_ONLY_TRANSACTION'
    if 'shared_preload_libraries' in low and ('must be loaded' in low or 'not in' in low):
        return 'PRELOAD_REQUIRED'
    if state == '28P01' or 'password authentication failed' in low:
        return 'DATABASE_AUTHENTICATION_FAILED'
    if (state == '42501' or 'must be superuser' in low or 'must be owner' in low
            or re.search(r'permission denied for (?:schema|table|relation|database|sequence|function)', low)):
        return 'DATABASE_PRIVILEGE_DENIED'
    if 'permission denied' in low or 'eacces' in low or errno in ('EACCES', 'EPERM'):
        return 'PERMISSION_DENIED'
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
    if any(value in low for value in ('dns error', 'failed to lookup address',
                                      'name or service not known', 'temporary failure in name resolution')):
        return 'DNS_LOOKUP_FAILED'
    if 'connection refused' in low or errno == 'ECONNREFUSED':
        return 'NETWORK_CONNECTION_REFUSED'
    if 'network is unreachable' in low or errno in ('ENETUNREACH', 'ECONNRESET'):
        return 'NETWORK_UNAVAILABLE'
    if ('certificate' in low or 'unknownissuer' in low) and any(
            value in low for value in ('invalid', 'unknown', 'failed', 'error')):
        return 'CERTIFICATE_VALIDATION_FAILED'
    if ('failed to determine entrypoint' in low or 'could not find an appropriate entrypoint' in low
            or 'main entrypoint' in low and 'not found' in low):
        return 'MAIN_ENTRYPOINT_UNAVAILABLE'
    if 'import map' in low and any(value in low for value in ('invalid', 'failed', 'error', 'parse')):
        return 'IMPORT_MAP_INVALID'
    if 'relative import path' in low and 'not prefixed' in low:
        return 'MODULE_SPECIFIER_INVALID'
    if 'module' in low and 'does not provide an export' in low:
        return 'MODULE_EXPORT_MISSING'
    if any(value in low for value in ('module not found', 'cannot find module', 'err_module_not_found')):
        return 'MODULE_NOT_FOUND'
    if 'error sending request for url' in low or 'import ' in low and ' failed' in low:
        return 'MODULE_IMPORT_FAILED'
    if _javascript_error(message) == 'SyntaxError':
        return 'JAVASCRIPT_SYNTAX_ERROR'
    if _javascript_error(message) is not None:
        return 'JAVASCRIPT_RUNTIME_ERROR'
    if 'cache' in low and any(value in low for value in ('failed', 'cannot', 'could not', 'unavailable')):
        return 'RUNTIME_CACHE_UNAVAILABLE'
    if errno == 'EISDIR' or 'is a directory' in low:
        return 'FILE_TYPE_MISMATCH'
    if state == '58P01' or 'no such file or directory' in low or errno == 'ENOENT':
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
    if state in ('53300', '53400') or 'too many' in low or 'limit exceeded' in low or errno == 'EMFILE':
        return 'RESOURCE_LIMIT'
    if errno == 'ETIMEDOUT' or 'connection timed out' in low:
        return 'NETWORK_TIMEOUT'
    if errno == 'EADDRINUSE' or 'address already in use' in low:
        return 'ADDRESS_IN_USE'
    if 'panicked at' in low:
        return 'RUNTIME_PANIC'
    if 'worker boot error' in low or 'failed to bootstrap runtime' in low or 'failed to create the graph' in low:
        return 'WORKER_BOOT_FAILED'
    if 'runtime has escaped from the event loop unexpectedly' in low or 'event loop error:' in low:
        return 'RUNTIME_EVENT_LOOP_EXITED'
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
        ('EDGE_MAIN_SERVICE', r'(?:file://)?/bos-main(?:/|\b)'),
        ('EDGE_FUNCTION_SOURCE', r'(?:file://)?/bos-src(?:/|\b)'),
        ('EDGE_BUNDLE', r'(?:file://)?/bos-bundles(?:/|\b)'),
        ('DENO_CACHE', r'/(?:root/\.cache/deno|tmp/deno(?:-cache)?)(?:/|\b)'),
        ('REMOTE_MODULE', r'\b(?:https?://|jsr:|npm:)'),
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


def _structured_message(record):
    """Prefer the final server error, excluding a migration's preceding SQL.

    Keep offsets while masking quoted SQL strings/identifiers so an error-like
    literal cannot become the authoritative PostgreSQL error record. Separate
    JSON fields are never concatenated into a synthetic error message.
    """
    parts = [record[key] for key in ('msg', 'message', 'error')
             if isinstance(record.get(key), str)]
    fields = record.get('fields')
    if isinstance(fields, dict) and isinstance(fields.get('message'), str):
        parts.append(fields['message'])
    if not parts:
        return None
    for message in parts:
        masked = _QUOTED.sub(lambda match: ' ' * len(match.group()), message)
        markers = list(re.finditer(r'\b(?:ERROR|FATAL|PANIC):\s*', masked))
        if not markers:
            continue
        start = markers[-1].end()
        suffix = re.search(r'\(SQLSTATE\s+([0-9A-Z]{5})\)\s*$', masked[start:])
        state = suffix.group(1) if suffix else None
        end = start + suffix.start() if suffix else len(message)
        # DETAIL/CONTEXT and any subsequent multiline payload are not evidence.
        return message[start:end].splitlines()[0] if message[start:end] else '', state
    # Non-PostgreSQL service errors still use the fixed-vocabulary sanitizer.
    # Only a trailing, unquoted SQLSTATE is accepted, never one inside SQL text.
    for message in parts:
        masked = _QUOTED.sub(lambda match: ' ' * len(match.group()), message)
        suffix = re.search(r'\(SQLSTATE\s+([0-9A-Z]{5})\)\s*$', masked)
        if suffix:
            prefix = message[:suffix.start()]
            return prefix.splitlines()[0] if prefix else '', suffix.group(1)
    return parts[0].splitlines()[0] if parts[0] else '', None


def _runtime_record(line):
    match = _PLAIN.fullmatch(line)
    if match:
        level, state, message = match.groups()
        return _LEVELS[level.lower()], state.upper() if state else None, message
    for pattern in (_TRACING, _BRACKET):
        match = pattern.fullmatch(line)
        if match:
            level, message = match.groups()
            return _LEVELS[level.lower()], None, message
    if (_WORKER.match(line) or _JS_ERROR.match(line)
            or re.match(r'^Uncaught(?: \(in promise\))? Error:', line)):
        return 'ERROR', None, line
    if _RUST_PANIC.match(line):
        return 'PANIC', None, line
    return None


def summarize(raw):
    if not isinstance(raw, bytes):
        raw = b''
    content = raw[:MAX_BYTES]
    errors, notices, error_groups = [], [], []
    counts = {level: 0 for level in sorted(SEVERITIES)}
    unparsed, ansi_removed, context_left, cause_chain = 0, False, 0, False
    active_group = None
    for original in content.decode('utf-8', errors='replace').splitlines():
        line = _ANSI.sub('', original)
        ansi_removed |= line != original
        if not line.strip():
            continue
        runtime, cause = False, False
        match = _RECORD.fullmatch(line)
        if match:
            level, state, message = match.groups()
        elif line.startswith('{') and len(line) <= 16384:
            # GoTrue and other services use structured JSON logs. Only the
            # explicitly known message fields enter the same strict sanitizer.
            # Even malformed JSON ends a preceding plain-text runtime chain.
            context_left, cause_chain, active_group = 0, False, None
            try:
                record = json.loads(line)
            except (ValueError, RecursionError):
                unparsed += 1
                context_left, cause_chain = 0, False
                continue
            if not isinstance(record, dict):
                unparsed += 1
                continue
            raw_level = record.get('level', record.get('severity'))
            if not isinstance(raw_level, str):
                unparsed += 1
                continue
            level = _LEVELS.get(raw_level.lower())
            if level is None:
                unparsed += 1
                continue
            selected = _structured_message(record)
            if selected is None:
                unparsed += 1
                continue
            message, state = selected
        else:
            selected = _runtime_record(line.strip()) if len(line) <= 16384 else None
            if selected is not None:
                level, state, message = selected
                runtime = True
            elif context_left > 0 and re.match(r'^\s*Caused by:\s*', line):
                message = re.sub(r'^\s*Caused by:\s*', '', line, count=1)
                cause_chain = True
                context_left -= 1
                if not message:
                    continue
                level, state = 'ERROR', None
                cause = True
            elif context_left > 0 and cause_chain and re.match(r'^\s+(?:\d{1,2}:\s*)?\S', line):
                message = re.sub(r'^\s+(?:\d{1,2}:\s*)?', '', line, count=1)
                level, state = 'ERROR', None
                context_left -= 1
                cause = True
            else:
                unparsed += 1
                context_left, cause_chain = 0, False
                continue
        if runtime:
            context_left, cause_chain = (12, False) if level in ('ERROR', 'FATAL', 'PANIC') else (0, False)
            active_group = None
        elif match or line.startswith('{'):
            context_left, cause_chain = 0, False
            active_group = None
        counts[level] += 1
        state = state if state in SQLSTATES else None
        event = {'severity': level, 'category': _category(message, state),
                 'sqlstate': state, 'known_identifiers': _known_identifiers(message),
                 'path_kinds': _path_kinds(message), 'message_terms': _terms(message),
                 'javascript_error': _javascript_error(message), 'os_errno': _os_errno(message),
                 'main_location': _main_location(message)}
        target = errors if level in ('ERROR', 'FATAL', 'PANIC') else notices
        if len(target) < MAX_EVENTS:
            target.append(event)
            if target is errors:
                if cause and active_group is not None:
                    # Only a cause within this bounded runtime chain may
                    # replace its enclosing error with a more specific one.
                    if event['category'] not in _GENERIC:
                        error_groups[active_group] = event['category']
                else:
                    error_groups.append(event['category'])
                    active_group = len(error_groups) - 1 if runtime else None
    specific = [category for category in error_groups if category not in _GENERIC]
    primary = specific[0] if specific else error_groups[0] if error_groups else (
        'UNPARSED_LOG_RECORDS' if unparsed else 'NO_SERVER_ERROR_RECORD')
    return {'evidence_bytes': len(content), 'truncated': len(raw) > MAX_BYTES,
            'severity_counts': counts, 'errors': errors, 'startup_messages': notices,
            'primary_category': primary, 'unparsed_nonempty_lines': unparsed,
            'ansi_sequences_removed': ansi_removed,
            'events_truncated': sum(counts.values()) > len(errors) + len(notices)}


def collect_logs(raw_logs):
    return {name: summarize(raw_logs.get(name, b'')) for name in LOG_NAMES}
