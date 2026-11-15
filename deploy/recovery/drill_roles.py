"""Conservative bootstrap inference from canonical PostgreSQL 17 globals.

A role-membership grantor needs ADMIN OPTION unless it is the bootstrap role.
A complete dump with exactly one distinct membership grantor therefore exposes
that root. Ambiguous dumps are refused; the backup connection user is never used
as a substitute. This is inference from SQL, not a captured source OID query.
"""
import re

MAX_GLOBALS = 64 * 1024 * 1024
IDENT = r'(?:[a-z_][a-z0-9_$]*|"(?:[^"]|"")+")'
GRANT = re.compile(r'^GRANT\s+(' + IDENT + r')\s+TO\s+(' + IDENT +
                   r')(?:\s+WITH\s+((?:(?:ADMIN|INHERIT|SET)\s+(?:TRUE|FALSE)|ADMIN\s+OPTION)'
                   r'(?:,\s*(?:ADMIN|INHERIT|SET)\s+(?:TRUE|FALSE))*))?'
                   r'\s+GRANTED\s+BY\s+(' + IDENT + r');$')
CREATE = re.compile(r'^CREATE\s+ROLE\s+(' + IDENT + r');$')
# pg_dumpall also emits parameter grants. They do not describe role membership
# and must not be used to infer the bootstrap grantor. Recognize only their
# canonical dump form; restore still executes the original bytes unchanged.
# Parameter REVOKE remains unsupported: PostgreSQL 17 ignores it if no parameter
# ACL entry exists yet, so replay onto a fresh cluster can change the final ACL.
PARAM_PRIVILEGES = (r'(?:ALL(?:\s+PRIVILEGES)?|SET(?:,\s*ALTER\s+SYSTEM)?'
                    r'|ALTER\s+SYSTEM(?:,\s*SET)?)')
PARAM_GRANTEE = r'(?:' + IDENT + r'|PUBLIC)'
PARAM_GRANT = re.compile(r'^GRANT\s+' + PARAM_PRIVILEGES +
                         r'\s+ON\s+PARAMETER\s+' + IDENT +
                         r'\s+TO\s+' + PARAM_GRANTEE +
                         r'(?:\s+WITH\s+GRANT\s+OPTION)?;$')


class Stop(Exception):
    reason_code = 'DRILL_BOOTSTRAP_METADATA_REQUIRED'
    def __init__(self):
        super().__init__(self.reason_code)


def require(condition):
    if not condition:
        raise Stop()


def statements(raw):
    """SQL lexer with byte spans; quoted values cannot impersonate statements."""
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_GLOBALS)
    result, buffer, start = [], bytearray(), None
    i, size, quote, escape = 0, len(raw), None, False
    while i < size:
        ch = raw[i]
        if quote is not None:
            buffer.append(ch)
            if escape and ch == 92:
                require(i + 1 < size)
                buffer.append(raw[i + 1]); i += 2; continue
            if ch == quote:
                if i + 1 < size and raw[i + 1] == quote:
                    buffer.append(ch); i += 2; continue
                quote = None
            i += 1; continue
        if raw[i:i + 2] == b'--':
            end = raw.find(b'\n', i)
            i = size if end < 0 else end + 1
            if buffer: buffer.append(32)
            continue
        if raw[i:i + 2] == b'/*':
            depth, i = 1, i + 2
            while i < size and depth:
                if raw[i:i + 2] == b'/*': depth += 1; i += 2
                elif raw[i:i + 2] == b'*/': depth -= 1; i += 2
                else: i += 1
            require(depth == 0)
            if buffer: buffer.append(32)
            continue
        if ch == 92:
            require(start is None)
            end = raw.find(b'\n', i)
            end = size if end < 0 else end
            require(re.fullmatch(rb'\\(?:un)?restrict [A-Za-z0-9_]+\r?', raw[i:end]) is not None)
            i = end + 1; continue
        if ch in (9, 10, 13, 32) and start is None:
            i += 1; continue
        if start is None:
            start = i
        if ch in (34, 39):
            quote = ch
            escape = (ch == 39 and bool(buffer) and buffer[-1] in (69, 101)
                      and (len(buffer) == 1 or not chr(buffer[-2]).isalnum()))
        buffer.append(ch)
        i += 1
        if ch == 59 and quote is None:
            try:
                sql = buffer.decode('utf-8')
            except UnicodeError:
                raise Stop() from None
            result.append((sql, start, i))
            require(len(result) <= 100000)
            buffer, start = bytearray(), None
    require(quote is None and not buffer.strip())
    return result


def identifier(value):
    return value[1:-1].replace('""', '"') if value.startswith('"') else value


def source_bootstrap(raw):
    grantors, creates = set(), {}
    for sql, start, end in statements(raw):
        first = sql.split(None, 1)[0]
        if first == 'GRANT':
            if PARAM_GRANT.fullmatch(sql):
                continue
            match = GRANT.fullmatch(sql)
            require(match is not None)
            grantors.add(identifier(match.group(4)))
        elif first == 'REVOKE':
            # Do not accept ACL rewrites without a proven restore strategy.
            raise Stop()
        elif first == 'CREATE':
            match = CREATE.fullmatch(sql)
            if match:
                name = identifier(match.group(1))
                require(name not in creates)
                creates[name] = (start, end)
    require(len(grantors) == 1)
    role = next(iter(grantors))
    require(re.fullmatch(r'[a-z_][a-z0-9_]{0,62}', role) is not None and role in creates)
    start, end = creates[role]
    require(raw[start:end] in (f'CREATE ROLE {role};'.encode(), f'CREATE ROLE "{role}";'.encode()))
    return {'role': role, 'create_span': (start, end),
            'evidence': 'INFERRED_FROM_UNIQUE_DUMP_GRANTOR'}
