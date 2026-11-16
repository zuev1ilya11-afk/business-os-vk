import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import app_cli
import app_claim_check as claim
import app_flow_check as flow
import build_app_claim_check as build
from test_app_flow_check import Runner, Server, evidence, LAUNCH


def prior():
    return {'format': 2, 'diagnostic': 'LIVE_SYNTHETIC_FLOW', 'status': 'PARTIAL_EXTERNAL_ARCHIVE_DISABLED',
        'run_id': LAUNCH['run_id'], 'source_manifest_sha256': LAUNCH['source_manifest_sha256'],
        'marker': 'BOS-CHECK-0123456789abcdef', 'synthetic_order_id': '777',
        'synthetic_staff': {'master': '102'},
        'captured_build_file_sha256': hashlib.sha256(b'window.BOS_BUILD="test";').hexdigest()}


def fixture():
    server = Server()
    server.staff['102'] = {'id': '102', 'role': 'master', 'is_active': True,
        'full_name': prior()['marker']+' master'}
    original = {'id': '777', 'status': 'Выполнена', 'master_payout': 552.5, 'extra_work_amount': 100,
        'phone': 'PRIVATE_PHONE', 'report_act_url': 'PRIVATE_CAPABILITY', 'comment': 'PRIVATE_COMMENT'}
    server.orders = [{**original, 'order_number': prior()['marker'], 'client': prior()['marker'],
        'is_claim': True, 'extra_work_amount': 0, 'master_staff_id': '102', 'financial_snapshot': original}]
    report = evidence()
    checker = claim.Checker(Runner(), LAUNCH, report, host=server, progress=lambda _: None)
    return server, report, checker


class Tests(unittest.TestCase):
    def test_reads_preserved_accrual_without_business_writes_or_secret_export(self):
        server, report, checker = fixture()
        before = copy.deepcopy((server.orders, server.staff))
        checker.run('private-owner', 'private-password', prior())
        checker.close()
        self.assertEqual(report['status'], 'CHECK_COMPLETE')
        self.assertEqual(report['finding'], 'ORIGINAL_ACCRUAL_PRESERVED_IN_API')
        self.assertEqual(report['master_snapshot']['fields']['extra_work_amount'], 100)
        self.assertEqual(report['master_order']['extra_work_amount'], 0)
        self.assertEqual(before, (server.orders, server.staff))
        self.assertTrue(server.revoke)
        self.assertFalse(checker.tokens)
        self.assertNotIn('PRIVATE_', json.dumps(report))
        self.assertNotIn('private-', json.dumps(report))
        self.assertNotIn('secret-', json.dumps(report))
        for path, body in server.calls:
            if path == flow.API+'mini-app-api':
                self.assertEqual(body, {'action': 'bootstrap'})

    def test_distinguishes_missing_and_changed_snapshot(self):
        for snap, finding in [(None, 'HISTORICAL_SNAPSHOT_MISSING'),
            ({'id': '777', 'status': 'Выполнена', 'master_payout': 552.5, 'extra_work_amount': 0}, 'ORIGINAL_ACCRUAL_DIFFERS_REVIEW_REQUIRED')]:
            server, report, checker = fixture()
            server.orders[0]['financial_snapshot'] = snap
            checker.run('private-owner', 'private-password', prior())
            checker.close()
            self.assertEqual(report['finding'], finding)

    def test_refuses_any_mutating_business_action(self):
        server, report, checker = fixture()
        for function, action in [('mini-app-api', 'updateOrder'), ('report-api', 'finalizeMasterReport'),
                                 ('claims-api', 'reopenClaim'), ('order-lifecycle-api', 'reviewReport')]:
            with self.assertRaisesRegex(app_cli.Stop, 'READ_ONLY_ROUTE_REQUIRED'):
                checker.api('FORBIDDEN', function, action)
        self.assertEqual(server.calls, [])

    def test_refuses_changed_clone_build_or_order(self):
        for kind in ('build', 'marker', 'staff', 'network'):
            server, report, checker = fixture()
            p = prior()
            if kind == 'build': p['captured_build_file_sha256'] = '0'*64
            if kind == 'marker': server.orders[0]['client'] = 'REAL_CUSTOMER'
            if kind == 'staff': server.staff['102']['full_name'] = 'REAL_MASTER'
            if kind == 'network': checker.runner.records['1'*64]['HostConfig']['NetworkMode'] = 'bridge'
            with self.assertRaises(app_cli.Stop):
                checker.run('private-owner', 'private-password', p)
            self.assertNotIn('owner_order', report)

    def test_requires_matching_successful_v2_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root/'BOS-Flow-Check-20261116T111845Z-b7ee6fc4.json'
            path.write_text(json.dumps(prior()))
            self.assertEqual(claim.prior_input(root, LAUNCH), prior())
            p = prior(); p['run_id'] = 'bos-app-000000000000'; path.write_text(json.dumps(p))
            with self.assertRaisesRegex(app_cli.Stop, 'CLONE_MISMATCH'):
                claim.prior_input(root, LAUNCH)

    def test_package_reproducible_and_launcher_has_no_flow_resume(self):
        digest = build.build()
        first = (build.ROOT/build.DELIVERY).read_bytes()
        self.assertEqual(build.build(), digest)
        self.assertEqual((build.ROOT/build.DELIVERY).read_bytes(), first)
        with zipfile.ZipFile(build.ROOT/build.DELIVERY) as archive:
            self.assertEqual(set(archive.namelist()), set(build.FILES))
            self.assertIsNone(archive.testzip())
            ps = archive.read('check-claim.ps1').decode()
            self.assertIn(digest, ps)
            self.assertNotIn('--resume-latest', ps)
            self.assertIn('bos-claim-check.pyz', ps)


if __name__ == '__main__':
    unittest.main()
