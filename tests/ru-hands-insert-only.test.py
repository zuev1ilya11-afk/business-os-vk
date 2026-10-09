import contextlib
import importlib.util
import io
import json
import pathlib
import unittest
import urllib.error
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('intake_patch', ROOT / 'scripts/ru-hands-insert-only.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RecoveryTests(unittest.TestCase):
    def test_exact_scope_and_drift(self):
        fixture = (ROOT / 'tests/fixtures/hands-v11-intake.ts').read_text()
        source = "const privateSetting='synthetic';\n" + fixture + "const unrelated='preserve';\n"
        changed = m.patch_source(source)
        self.assertTrue(changed.startswith(m.MARKER + "const privateSetting='synthetic';\n"))
        self.assertTrue(changed.endswith("const unrelated='preserve';\n"))
        for other in (fixture.replace('master_name:sp', 'master_name:changed'), fixture + fixture, changed):
            with self.assertRaises(m.Stop):
                m.patch_source(other)

    def test_dates_require_known_timezone_and_preserve_instant(self):
        with self.assertRaisesRegex(m.Stop, 'HANDS_TIMEZONE_REQUIRED'):
            m.creation_date('2026-10-09 09:39:42', None)
        self.assertEqual(m.creation_date('2026-10-09 09:39:42', 'Europe/Moscow'), '2026-10-09T06:39:42.000Z')
        self.assertEqual(m.creation_date('2026-10-09T09:39:42+03:00', None), '2026-10-09T06:39:42.000Z')
        for value in (None, 'unknown', '2026-02-30 09:39:42'):
            with self.assertRaises(m.Stop):
                m.creation_date(value, 'Europe/Moscow')

    def test_rejects_dst_ambiguity_and_gap(self):
        for value in ('2026-10-25 02:30:00', '2026-03-29 02:30:00'):
            with self.assertRaisesRegex(m.Stop, 'AMBIGUOUS'):
                m.creation_date(value, 'Europe/Berlin')

    def test_docker_none_network_representation(self):
        fixture = {'State':{'Running':True}, 'HostConfig':{'NetworkMode':'none'},
                   'NetworkSettings':{'Networks':{'none':{}}}}
        self.assertTrue(m.isolated_network(fixture))
        fixture['NetworkSettings']['Networks']['bridge'] = {}
        self.assertFalse(m.isolated_network(fixture))
        fixture['NetworkSettings']['Networks'] = {}
        fixture['HostConfig']['NetworkMode'] = 'host'
        self.assertFalse(m.isolated_network(fixture))

    def test_retry_reuses_delivery_id_and_body_without_outputting_secrets(self):
        requests = []
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"ok":true,"duplicate":true}'
        def send(request, timeout):
            requests.append(request)
            if len(requests) == 1:
                raise TimeoutError('private-value-must-not-print')
            return response
        intake = SimpleNamespace(canonical=lambda v:'hands:' + str(v),
                                 opener=lambda:SimpleNamespace(open=send))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = m.send_recovery(intake, 'synthetic-secret', {'id':123,'client_name':'synthetic customer'},
                                     '2026-10-09T06:39:42.000Z', sleep=lambda _:None)
        self.assertTrue(result['duplicate'])
        self.assertEqual(requests[0].data, requests[1].data)
        self.assertEqual(requests[0].headers['X-hands-delivery'], requests[1].headers['X-hands-delivery'])
        self.assertEqual(out.getvalue(), '')

    def test_auth_failure_is_not_retried_and_does_not_expose_url(self):
        def fail(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 404, 'private-value', None, None)
        send = Mock(side_effect=fail)
        intake = SimpleNamespace(canonical=lambda v:'hands:' + str(v),
                                 opener=lambda:SimpleNamespace(open=send))
        with self.assertRaisesRegex(m.Stop, '^RECOVERY_HTTP_404$'):
            m.send_recovery(intake, 'synthetic-secret', {'id':123}, '2026-10-09T06:39:42.000Z')
        self.assertEqual(send.call_count, 1)

    def test_missing_database_unique_index_stops_before_any_http_probe(self):
        diag = SimpleNamespace(sql=lambda *a:False)
        intake = SimpleNamespace(load_diag=lambda:diag, context=lambda _:('edge','rest','db','postgres'))
        act = SimpleNamespace(public_check=Mock())
        with self.assertRaisesRegex(m.Stop, 'EXTERNAL_ID_UNIQUENESS'):
            m.current({'intake':intake,'stage':object(),'act':act})
        act.public_check.assert_not_called()

    def test_recovery_verifies_real_replay_and_reports_post_timeout_presence(self):
        spec2 = importlib.util.spec_from_file_location('intake', ROOT / 'scripts/ru-hands-intake-check.py')
        intake = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(intake)
        diag = SimpleNamespace(env=lambda _: {'HANDS_API_KEY':'synthetic-key'})
        rows = [{'id':9,'creation_time':'2026-10-08 10:00:00'},
                {'id':123,'creation_time':'2026-10-09 09:39:42'}]
        snapshots = [{'hands_ids':['hands:9'],'last_receipt_at':None},
                     {'hands_ids':['hands:9'],'last_receipt_at':None},
                     {'hands_ids':['hands:9','hands:123'],'last_receipt_at':'2026-10-09T10:00:00Z'}]
        read = lambda p: b'{"state":"activated"}' if p.name=='activation.json' else b'{}'
        act = SimpleNamespace(read=read, write_json=Mock())
        duplicate = {'created':False,'skipped':False,'duplicate':True}
        # Simulate a lost first acknowledgement recovered by send_recovery's retry.
        with patch.object(m,'verify_saved',return_value=(diag,{},None,None,None,'synthetic-token')), \
             patch.object(intake,'target_snapshot',side_effect=snapshots), \
             patch.object(intake,'fetch_json',return_value={'orders':rows,'page':1,'pages':1,'per_page':100,'total':2}), \
             patch.object(m,'send_recovery',return_value=duplicate) as send, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            m.recover_orders({'act':act,'intake':intake},pathlib.Path('/synthetic'),'Europe/Moscow')
        self.assertEqual(send.call_count,2)
        self.assertEqual(send.call_args_list[0],send.call_args_list[1])
        report = json.loads(output.getvalue().splitlines()[0].split('=',1)[1])
        self.assertEqual(report['acknowledged_created'],0)
        self.assertEqual(report['confirmed_present'],1)
        self.assertEqual(report['duplicate_deliveries_verified'],1)
        self.assertEqual(report['remaining_missing'],0)
        self.assertTrue(any(call.args[0].name=='health.json' for call in act.write_json.call_args_list))


if __name__ == '__main__':
    unittest.main()
