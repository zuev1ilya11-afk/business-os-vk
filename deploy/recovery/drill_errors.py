"""Classify private PostgreSQL stderr without returning any source text.

This is a diagnostic aid, not a retry or permission policy.  Unknown failures
stay failures.  Only a bounded prefix and explicit server error lines are read;
SQL, DETAIL, HINT and CONTEXT lines are never used as classification evidence.
"""
import re


MAX_EVIDENCE_BYTES = 16 * 1024
PHASES = frozenset(('INITIALIZE', 'STARTUP', 'PREFLIGHT', 'GLOBALS', 'DATABASE',
                    'VALIDATION', 'UNKNOWN'))
CATEGORIES = frozenset(('PRELOAD_REQUIRED', 'CRON_DATABASE_MISMATCH',
                        'EXTENSION_UNAVAILABLE', 'SHARED_LIBRARY_MISSING',
                        'DB_COLLATION_UNAVAILABLE', 'ROLE_MISSING',
                        'OWNER_PRIVILEGE_DENIED', 'OBJECT_ALREADY_EXISTS',
                        'DISK_FULL', 'OUT_OF_MEMORY', 'SQL_RESTORE_FAILED'))
# Never echo a user-defined SQLSTATE.  All returned values are constants from
# PostgreSQL's error-code list and have an established diagnostic meaning here.
SQLSTATES = frozenset(('0A000', '22023', '42501', '42704', '42710', '42723',
                      '42P04', '42P06', '42P07', '53100', '53200', '55000',
                      '58030', '58P01'))
_KEYS = frozenset(('phase', 'category', 'sqlstate', 'evidence_bytes', 'truncated'))
_SERVER_ERROR = re.compile(
    r'^(?:pg_restore:\s*error:\s*could not execute query:\s*|'
    r'psql:[^\r\n]{1,512}:\d+:\s*)?'
    r'(?:ERROR|FATAL|PANIC):\s*(?:([0-9A-Z]{5}):\s*)?(.*)$')
_RESTORE_ERROR = re.compile(r'^pg_restore:\s*error:\s*(.*)$')
_DUPLICATE_CODES = frozenset(('42710', '42723', '42P04', '42P06', '42P07'))


def _category(message, sqlstate):
    """Return a constant only; never return part of the matched message."""
    message = message.lower()
    if sqlstate == '53100' or 'no space left on device' in message:
        return 'DISK_FULL'
    if sqlstate == '53200' or re.search(r'\b(out of memory|cannot allocate memory)\b', message):
        return 'OUT_OF_MEMORY'
    if ('shared_preload_libraries' in message
            and re.search(r'\b(must be loaded|can only be loaded|needs to be loaded|has to be loaded)\b', message)):
        return 'PRELOAD_REQUIRED'
    if re.fullmatch(r'(?:pg_net|pg_cron|pg_stat_statements) is not in shared_preload_libraries', message):
        return 'PRELOAD_REQUIRED'
    if re.fullmatch(r'unrecognized configuration parameter ["\']cron\.database_name["\']', message):
        return 'PRELOAD_REQUIRED'
    if re.match(r'can only create extension in database\b', message):
        return 'CRON_DATABASE_MISMATCH'
    if (re.match(r'extension ["\'].+["\'] is not available\b', message)
            or 'could not open extension control file' in message):
        return 'EXTENSION_UNAVAILABLE'
    if (re.match(r'could not (access file|load library|load shared library) ', message)
            and ('no such file or directory' in message or 'not found' in message)):
        return 'SHARED_LIBRARY_MISSING'
    if (re.match(r'invalid (?:lc_collate |lc_ctype |icu )?locale (?:name|provider)\b', message)
            or re.match(r'collation .+ (?:does not exist|is not available)\b', message)
            or re.match(r'database (?:collation|locale) is incompatible\b', message)):
        return 'DB_COLLATION_UNAVAILABLE'
    if re.match(r'role ["\'].+["\'] does not exist\b', message):
        return 'ROLE_MISSING'
    if (sqlstate == '42501'
            or re.match(r'(?:must be (?:owner|member|superuser)|permission denied|not permitted to)\b', message)):
        return 'OWNER_PRIVILEGE_DENIED'
    if (sqlstate in _DUPLICATE_CODES
            or re.match(r'(?:database|role|schema|extension|relation|type|function|operator|constraint|policy|trigger) .+ already exists\b', message)):
        return 'OBJECT_ALREADY_EXISTS'
    return 'SQL_RESTORE_FAILED'


def classify(raw, phase):
    """Return public-safe evidence; classification never changes restore policy.

    Input is private stderr from the failed command, captured before cleanup.
    At most the first MAX_EVIDENCE_BYTES are inspected.  A generic pg_restore
    wrapper is skipped if a more specific server error follows it.
    """
    if isinstance(raw, bytes):
        truncated = len(raw) > MAX_EVIDENCE_BYTES
        evidence = raw[:MAX_EVIDENCE_BYTES]
    elif isinstance(raw, str):
        # Slice before encoding to avoid allocating an unbounded second copy.
        prefix = raw[:MAX_EVIDENCE_BYTES].encode('utf-8', errors='replace')
        truncated = len(raw) > MAX_EVIDENCE_BYTES or len(prefix) > MAX_EVIDENCE_BYTES
        evidence = prefix[:MAX_EVIDENCE_BYTES]
    else:
        evidence, truncated = b'', False
    result = {'phase': phase if type(phase) is str and phase in PHASES else 'UNKNOWN',
              'category': 'SQL_RESTORE_FAILED', 'sqlstate': None,
              'evidence_bytes': len(evidence), 'truncated': truncated}
    for line in evidence.decode('utf-8', errors='replace').splitlines():
        if line.startswith('Command was:'):
            # A multiline SQL literal can itself contain error-looking lines.
            # pg_restore --exit-on-error prints the failed command last.
            break
        match = _SERVER_ERROR.fullmatch(line)
        server_error = match is not None
        if match:
            state, message = match.groups()
            state = state if state in SQLSTATES else None
        else:
            match = _RESTORE_ERROR.fullmatch(line)
            if not match:
                continue
            state, message = None, match.group(1)
            # Connection errors can include a server ERROR/FATAL on the same
            # line after the quoted socket address.  Do not scan arbitrary
            # SQL text for an error-looking substring.
            if message.startswith('connection to server '):
                nested = re.search(r' failed: ((?:ERROR|FATAL|PANIC):.*)$', message)
                if nested:
                    server = _SERVER_ERROR.fullmatch(nested.group(1))
                    state, message = server.groups()
                    state = state if state in SQLSTATES else None
                    server_error = True
        category = _category(message, state)
        if state is not None and result['sqlstate'] is None:
            result['sqlstate'] = state
        if category != 'SQL_RESTORE_FAILED':
            result['category'], result['sqlstate'] = category, state
            break
        if server_error:
            # The first actual error is authoritative even when unknown.  Do
            # not relabel it using arbitrary multiline DETAIL/CONTEXT text.
            break
    return result


def safe_detail(value):
    """Copy only an exact classifier record; reject foreign exception details."""
    if type(value) is not dict or set(value) != _KEYS:
        return None
    if type(value['phase']) is not str or value['phase'] not in PHASES:
        return None
    if type(value['category']) is not str or value['category'] not in CATEGORIES:
        return None
    state = value['sqlstate']
    if state is not None and (type(state) is not str or state not in SQLSTATES):
        return None
    if (type(value['evidence_bytes']) is not int
            or not 0 <= value['evidence_bytes'] <= MAX_EVIDENCE_BYTES
            or type(value['truncated']) is not bool):
        return None
    return {key: value[key] for key in ('phase', 'category', 'sqlstate', 'evidence_bytes', 'truncated')}
