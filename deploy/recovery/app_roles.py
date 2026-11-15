"""Owner-authorized account switching for one isolated application session.

This broker reads only the launcher's active clone roster. It never changes
accounts, passwords or roles. Its signing key and grants remain in memory.
"""
import base64
from dataclasses import dataclass, field
import hashlib
import hmac
import math
import re
import secrets
import threading
import time


GRANT_TTL = 8 * 60 * 60
MAX_GRANTS = 16
MAX_STAFF = 1000
_IDENTITY = re.compile(r'[A-Za-z0-9_-]{1,128}')
_SIGNATURE = re.compile(r'[A-Za-z0-9_-]{43}')
_ROLES = {'owner': 0, 'manager': 1, 'dispatcher': 2, 'master': 3}
_FIELDS = {'id', 'external_id', 'full_name', 'role'}


class _Denied(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


@dataclass(repr=False)
class _Grant:
    owner_id: str
    owner_subject: str
    expires_at: int
    # Bind subjects to their original staff IDs, including after token refresh.
    identities: dict = field(default_factory=dict)


class RoleSwitcher:
    """Return fixed JSON results; the portal enforces HTTP origin and CSRF rules."""
    def __init__(self, secret, read_staff, clock=time.time):
        if (not isinstance(secret, str) or not 32 <= len(secret) <= 512
                or any(not 33 <= ord(char) <= 126 for char in secret)
                or not callable(read_staff) or not callable(clock)):
            raise ValueError('LOCAL_ROLE_CONFIGURATION_INVALID')
        self._secret = secret.encode('ascii')
        self._read_staff, self._clock = read_staff, clock
        self._grants = {}
        self._lock = threading.Lock()
        self._closed = False

    def _signature(self, message):
        digest = hmac.new(self._secret, message.encode('ascii'), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b'=').decode('ascii')

    def _verify(self, token, now):
        if not isinstance(token, str) or len(token) > 256:
            raise _Denied(401, 'LOCAL_ROLE_SESSION_INVALID')
        parts = token.split('.')
        if (len(parts) != 3 or not _IDENTITY.fullmatch(parts[0])
                or not re.fullmatch(r'[0-9]{1,12}', parts[1])
                or not _SIGNATURE.fullmatch(parts[2])):
            raise _Denied(401, 'LOCAL_ROLE_SESSION_INVALID')
        if not hmac.compare_digest(self._signature(parts[0] + '.' + parts[1]), parts[2]):
            raise _Denied(401, 'LOCAL_ROLE_SESSION_INVALID')
        expires = int(parts[1])
        if expires <= now:
            raise _Denied(401, 'LOCAL_ROLE_SESSION_EXPIRED')
        return parts[0], expires

    def _roster(self):
        try:
            rows = self._read_staff()
        except Exception:
            raise _Denied(503, 'LOCAL_ROLE_DATA_UNAVAILABLE') from None
        if not isinstance(rows, (list, tuple)) or len(rows) > MAX_STAFF:
            raise _Denied(503, 'LOCAL_ROLE_DATA_INVALID')
        by_id, by_subject = {}, {}
        for row in rows:
            if (type(row) is not dict or set(row) != _FIELDS
                    or not isinstance(row['id'], str) or not _IDENTITY.fullmatch(row['id'])
                    or not isinstance(row['external_id'], str) or not _IDENTITY.fullmatch(row['external_id'])
                    or not isinstance(row['full_name'], str) or len(row['full_name']) > 512
                    or any(ord(char) < 32 or ord(char) == 127 for char in row['full_name'])
                    or not isinstance(row['role'], str) or row['role'] not in _ROLES
                    or row['id'] in by_id or row['external_id'] in by_subject):
                raise _Denied(503, 'LOCAL_ROLE_DATA_INVALID')
            copied = dict(row)
            by_id[copied['id']] = copied
            by_subject[copied['external_id']] = copied
        return by_id, by_subject

    @staticmethod
    def _public(row):
        return {'id': row['id'], 'name': row['full_name'] or 'Сотрудник', 'role': row['role']}

    def _result(self, grant, owner, current, by_id):
        ordered = sorted(by_id.values(), key=lambda row: (
            _ROLES[row['role']], row['full_name'].casefold(), row['id']))
        return {'ok': True, 'expires_at': grant.expires_at,
                'owner': self._public(owner), 'current': self._public(current),
                'accounts': [self._public(row) for row in ordered]}

    @staticmethod
    def _grant_key(token):
        if not isinstance(token, str) or not _SIGNATURE.fullmatch(token):
            raise _Denied(403, 'LOCAL_ROLE_CONTROL_REQUIRED')
        return hashlib.sha256(token.encode('ascii')).digest()

    def handle(self, action, payload, session_token, grant_token=''):
        with self._lock:
            try:
                return self._handle(action, payload, session_token, grant_token)
            except _Denied as error:
                return error.status, {'ok': False, 'code': error.code}
            except Exception:
                # SQL, crypto and callback exceptions must never expose values.
                return 503, {'ok': False, 'code': 'LOCAL_ROLE_UNAVAILABLE'}

    def _handle(self, action, payload, session_token, grant_token):
        if self._closed:
            raise _Denied(410, 'LOCAL_ROLE_CLOSED')
        if (not isinstance(action, str) or action not in ('authorize', 'list', 'switch', 'revoke')
                or type(payload) is not dict
                or set(payload) != ({'staff_id'} if action == 'switch' else set())):
            raise _Denied(400, 'LOCAL_ROLE_REQUEST_INVALID')
        if action == 'switch' and (not isinstance(payload['staff_id'], str)
                                  or not _IDENTITY.fullmatch(payload['staff_id'])):
            raise _Denied(400, 'LOCAL_ROLE_REQUEST_INVALID')
        now = self._clock()
        if not isinstance(now, (int, float)) or not math.isfinite(now) or now < 0:
            raise _Denied(503, 'LOCAL_ROLE_UNAVAILABLE')
        subject, session_expiry = self._verify(session_token, now)
        key = None if action == 'authorize' else self._grant_key(grant_token)
        for existing, grant in list(self._grants.items()):
            if grant.expires_at <= now and existing != key:
                del self._grants[existing]

        if action == 'authorize':
            by_id, by_subject = self._roster()
            owner = by_subject.get(subject)
            if owner is None or owner['role'] != 'owner':
                raise _Denied(403, 'LOCAL_ROLE_OWNER_REQUIRED')
            if len(self._grants) >= MAX_GRANTS:
                raise _Denied(429, 'LOCAL_ROLE_CONTROL_LIMIT')
            token = secrets.token_urlsafe(32)
            grant = _Grant(owner['id'], subject, min(session_expiry, int(now) + GRANT_TTL),
                           {subject: owner['id']})
            self._grants[self._grant_key(token)] = grant
            result = self._result(grant, owner, owner, by_id)
            result['grant'] = token
            return 200, result

        grant = self._grants.get(key)
        if grant is None:
            raise _Denied(403, 'LOCAL_ROLE_CONTROL_REQUIRED')
        if grant.expires_at <= now:
            del self._grants[key]
            raise _Denied(403, 'LOCAL_ROLE_CONTROL_EXPIRED')
        if subject not in grant.identities:
            raise _Denied(403, 'LOCAL_ROLE_SESSION_NOT_AUTHORIZED')
        if action == 'revoke':
            # Teardown remains possible when an owner was disabled in the clone.
            del self._grants[key]
            return 200, {'ok': True}

        by_id, by_subject = self._roster()
        owner = by_id.get(grant.owner_id)
        if (owner is None or owner['external_id'] != grant.owner_subject
                or owner['role'] != 'owner'):
            del self._grants[key]
            raise _Denied(403, 'LOCAL_ROLE_OWNER_REQUIRED')
        current = by_subject.get(subject)
        if current is None or current['id'] != grant.identities[subject]:
            raise _Denied(403, 'LOCAL_ROLE_ACCOUNT_UNAVAILABLE')
        if action == 'list':
            return 200, self._result(grant, owner, current, by_id)

        target = by_id.get(payload['staff_id'])
        if target is None:
            raise _Denied(403, 'LOCAL_ROLE_ACCOUNT_UNAVAILABLE')
        message = target['external_id'] + '.' + str(grant.expires_at)
        token = message + '.' + self._signature(message)
        grant.identities[target['external_id']] = target['id']
        result = self._result(grant, owner, target, by_id)
        result['session_token'] = token
        return 200, result

    def close(self):
        with self._lock:
            self._closed = True
            self._grants.clear()
            self._secret = b''
