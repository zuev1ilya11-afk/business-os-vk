"""Role control verifies real sessions and never edits the captured staff data."""
import base64
import copy
import hashlib
import hmac
import json
import unittest

from app_roles import GRANT_TTL, MAX_GRANTS, RoleSwitcher


SECRET = 'synthetic-local-vk-secret-for-role-tests-only'


def session(subject, expiry, secret=SECRET):
    message = subject + '.' + str(expiry)
    signature = base64.urlsafe_b64encode(hmac.new(
        secret.encode(), message.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    return message + '.' + signature


class RoleSwitcherTests(unittest.TestCase):
    def setUp(self):
        self.now = 2_000_000_000
        self.rows = [
            {'id': 'owner-id', 'external_id': 'owner_subject', 'full_name': 'Владелец', 'role': 'owner'},
            {'id': 'manager-id', 'external_id': 'manager_subject', 'full_name': 'Руководитель', 'role': 'manager'},
            {'id': 'dispatcher-id', 'external_id': 'dispatcher_subject', 'full_name': 'Диспетчер', 'role': 'dispatcher'},
            {'id': 'master-id', 'external_id': 'master_subject', 'full_name': 'Мастер', 'role': 'master'},
        ]
        self.reads = 0
        self.owner_token = session('owner_subject', self.now + 365 * 86400)
        self.broker = RoleSwitcher(SECRET, self.read_staff, clock=lambda: self.now)
        self.addCleanup(self.broker.close)

    def read_staff(self):
        self.reads += 1
        return self.rows

    def authorize(self):
        status, result = self.broker.handle('authorize', {}, self.owner_token)
        self.assertEqual(status, 200, result)
        return result

    def test_real_target_session_switchback_and_no_staff_changes(self):
        before = copy.deepcopy(self.rows)
        control = self.authorize()
        self.assertEqual(set(control), {'ok', 'grant', 'expires_at', 'owner', 'current', 'accounts'})
        self.assertEqual(control['expires_at'], self.now + GRANT_TTL)
        self.assertEqual(control['owner'], {'id': 'owner-id', 'name': 'Владелец', 'role': 'owner'})
        status, switched = self.broker.handle('switch', {'staff_id': 'master-id'},
                                             self.owner_token, control['grant'])
        self.assertEqual(status, 200)
        self.assertEqual(switched['current']['role'], 'master')
        self.assertEqual(switched['session_token'], session('master_subject', control['expires_at']))
        self.assertNotIn('grant', switched)
        status, listed = self.broker.handle('list', {}, switched['session_token'], control['grant'])
        self.assertEqual(status, 200)
        self.assertEqual(listed['current']['id'], 'master-id')
        status, returned = self.broker.handle('switch', {'staff_id': control['owner']['id']},
                                            switched['session_token'], control['grant'])
        self.assertEqual(status, 200)
        self.assertEqual(returned['current'], control['owner'])
        self.assertEqual(returned['session_token'], session('owner_subject', control['expires_at']))
        self.assertEqual(self.rows, before)
        self.assertEqual(self.reads, 4)
        public = json.dumps([control, switched, listed, returned])
        self.assertNotIn(SECRET, public)
        self.assertNotIn('external_id', public)
        self.assertNotIn('password', public)
        self.assertTrue(all(set(row) == {'id', 'name', 'role'} for row in control['accounts']))

    def test_authorization_rejects_missing_forged_nonowner_and_expired_proof(self):
        cases = ['', session('owner_subject', self.now + 30, 'another-signing-secret'),
                 session('manager_subject', self.now + 30), session('missing_subject', self.now + 30),
                 session('owner_subject', self.now), self.owner_token + '.extra']
        for token in cases:
            with self.subTest(token_kind=cases.index(token)):
                status, result = self.broker.handle('authorize', {}, token)
                self.assertIn(status, (401, 403))
                self.assertEqual(set(result), {'ok', 'code'})
                self.assertFalse(result['ok'])
        self.assertEqual(self.broker._grants, {})

    def test_control_requires_grant_and_previously_authorized_current_identity(self):
        control = self.authorize()
        for grant in ('', 'X' * 43):
            status, _ = self.broker.handle('switch', {'staff_id': 'master-id'}, self.owner_token, grant)
            self.assertEqual(status, 403)
        outsider = session('master_subject', self.now + 60)
        status, result = self.broker.handle('list', {}, outsider, control['grant'])
        self.assertEqual((status, result['code']), (403, 'LOCAL_ROLE_SESSION_NOT_AUTHORIZED'))

    def test_refreshed_target_token_keeps_subject_membership_but_cannot_extend_control(self):
        control = self.authorize()
        self.broker.handle('switch', {'staff_id': 'master-id'}, self.owner_token, control['grant'])
        refreshed = session('master_subject', self.now + 365 * 86400)
        self.now += 60
        status, listed = self.broker.handle('list', {}, refreshed, control['grant'])
        self.assertEqual(status, 200)
        self.assertEqual(listed['expires_at'], control['expires_at'])
        self.now = control['expires_at']
        status, result = self.broker.handle('list', {}, refreshed, control['grant'])
        self.assertEqual((status, result['code']), (403, 'LOCAL_ROLE_CONTROL_EXPIRED'))

    def test_original_owner_expiry_caps_grant_and_issued_sessions(self):
        self.owner_token = session('owner_subject', self.now + 90)
        control = self.authorize()
        self.assertEqual(control['expires_at'], self.now + 90)
        status, switched = self.broker.handle('switch', {'staff_id': 'manager-id'},
                                             self.owner_token, control['grant'])
        self.assertEqual(status, 200)
        self.assertEqual(int(switched['session_token'].split('.')[1]), self.now + 90)

    def test_owner_deactivation_or_role_change_invalidates_control(self):
        for change in ('inactive', 'role'):
            with self.subTest(change=change):
                control = self.authorize()
                saved = copy.deepcopy(self.rows)
                if change == 'inactive':
                    self.rows.pop(0)  # The callback includes active rows only.
                else:
                    self.rows[0]['role'] = 'manager'
                status, result = self.broker.handle('list', {}, self.owner_token, control['grant'])
                self.assertEqual((status, result['code']), (403, 'LOCAL_ROLE_OWNER_REQUIRED'))
                self.rows = saved
                self.assertEqual(self.broker.handle('list', {}, self.owner_token, control['grant'])[0], 403)

    def test_inactive_target_or_current_and_recycled_identity_are_denied(self):
        control = self.authorize()
        _, switched = self.broker.handle('switch', {'staff_id': 'master-id'},
                                         self.owner_token, control['grant'])
        master = self.rows.pop()
        self.assertEqual(self.broker.handle('switch', {'staff_id': 'master-id'},
                                           self.owner_token, control['grant'])[0], 403)
        self.assertEqual(self.broker.handle('list', {}, switched['session_token'], control['grant'])[0], 403)
        self.rows.append({**master, 'id': 'replacement-id'})
        status, result = self.broker.handle('list', {}, switched['session_token'], control['grant'])
        self.assertEqual((status, result['code']), (403, 'LOCAL_ROLE_ACCOUNT_UNAVAILABLE'))

    def test_target_role_comes_from_current_database_row(self):
        control = self.authorize()
        self.rows[-1]['role'] = 'dispatcher'
        status, switched = self.broker.handle('switch', {'staff_id': 'master-id'},
                                             self.owner_token, control['grant'])
        self.assertEqual(status, 200)
        self.assertEqual(switched['current']['role'], 'dispatcher')
        self.assertEqual(self.broker.handle('switch', {'staff_id': 'master-id', 'role': 'owner'},
                                           self.owner_token, control['grant'])[0], 400)

    def test_ambiguous_and_malformed_rosters_fail_without_leaking_data(self):
        original = copy.deepcopy(self.rows)
        variants = [original + [dict(original[0])],
                    original + [{**original[-1], 'id': 'different-id'}],
                    [{**original[0], 'password_hash': 'PRIVATE_DATABASE_VALUE'}],
                    [{**original[0], 'role': 'unexpected'}],
                    [{**original[0], 'external_id': "bad.subject'"}]]
        for rows in variants:
            with self.subTest(case=variants.index(rows)):
                self.rows = rows
                status, result = self.broker.handle('authorize', {}, self.owner_token)
                self.assertEqual((status, result['code']), (503, 'LOCAL_ROLE_DATA_INVALID'))
                self.assertNotIn('PRIVATE', json.dumps(result))

    def test_callback_error_is_fixed_and_does_not_echo_private_exception(self):
        def fail():
            raise RuntimeError('PRIVATE_DATABASE_PASSWORD=' + SECRET)
        broker = RoleSwitcher(SECRET, fail, clock=lambda: self.now)
        self.addCleanup(broker.close)
        status, result = broker.handle('authorize', {}, self.owner_token)
        self.assertEqual((status, result), (503, {'ok': False, 'code': 'LOCAL_ROLE_DATA_UNAVAILABLE'}))

    def test_revoke_requires_current_proof_and_closes_grant_without_database_read(self):
        control = self.authorize()
        self.assertEqual(self.broker.handle('revoke', {}, 'forged', control['grant'])[0], 401)
        self.rows = []
        reads = self.reads
        status, result = self.broker.handle('revoke', {}, self.owner_token, control['grant'])
        self.assertEqual((status, result), (200, {'ok': True}))
        self.assertEqual(self.reads, reads)
        self.assertEqual(self.broker.handle('list', {}, self.owner_token, control['grant'])[0], 403)

    def test_grants_are_bounded_expired_grants_are_reclaimed_and_close_revokes_all(self):
        for _ in range(MAX_GRANTS):
            self.authorize()
        self.assertEqual(self.broker.handle('authorize', {}, self.owner_token)[0], 429)
        self.now += GRANT_TTL
        control = self.authorize()
        self.assertEqual(len(self.broker._grants), 1)
        self.broker.close()
        self.assertEqual(self.broker.handle('list', {}, self.owner_token, control['grant'])[0], 410)
        self.assertEqual(self.broker._grants, {})


if __name__ == '__main__':
    unittest.main()
