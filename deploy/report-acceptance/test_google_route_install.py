"""Targeted route maintenance: real filesystem writes, no production access."""
import contextlib
import hashlib
import importlib.util
import io
import json
import socket
import ssl
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import URLError
from urllib.request import HTTPSHandler, ProxyHandler, build_opener
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('google_route_install_test', ROOT/'google-route-install.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class HostsTests(unittest.TestCase):
    def test_preserves_unrelated_records_and_is_idempotent(self):
        before = b'127.0.0.1 localhost\n::1 localhost ip6-localhost\n10.0.0.2 internal # keep\n'
        after = m.hosts_content(before, '142.251.143.142')
        self.assertTrue(after.startswith(before))
        self.assertEqual(after.count(m.TARGET.encode()), 1)
        self.assertEqual(after.count(m.SOURCE.encode()), 1)
        self.assertEqual(m.hosts_content(after, '142.251.143.142'), after)

    def test_refuses_unmanaged_override_including_alias_or_case(self):
        for line in ('1.2.3.4 '+m.TARGET, '1.2.3.4 alias '+m.TARGET.upper()+'.', '1.2.3.4 '+m.SOURCE):
            with self.subTest(line=line), self.assertRaisesRegex(RuntimeError, 'UNMANAGED_GOOGLE_HOST'):
                m.hosts_content((line+'\n').encode(), '142.251.143.142')

    def test_managed_line_cannot_hide_other_hosts(self):
        before = ('1.2.3.4 '+m.TARGET+' unrelated # '+m.MARKER+'\n').encode()
        with self.assertRaisesRegex(RuntimeError, 'MANAGED_HOST_LINE_CHANGED'):
            m.hosts_content(before, '142.251.143.142')

    def test_replaces_only_owned_mapping(self):
        before = ('127.0.0.1 localhost\n1.2.3.4 '+m.TARGET+' # '+m.MARKER+'\n').encode()
        after = m.hosts_content(before, '142.251.143.142')
        self.assertNotIn(b'1.2.3.4', after)
        self.assertEqual(after.count(m.MARKER.encode()), 2)

    def test_write_preserves_inode_mode_and_open_reader(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'hosts'
            before = b'127.0.0.1 localhost\n'
            path.write_bytes(before)
            path.chmod(0o640)
            inode = path.stat().st_ino
            after = m.hosts_content(before, '142.251.143.142')
            with path.open('rb') as reader:
                m.replace_hosts(path, before, after)
                self.assertEqual(reader.read(), after)
                m.replace_hosts(path, after, before)
                reader.seek(0)
                self.assertEqual(reader.read(), before)
            self.assertEqual(path.stat().st_ino, inode)
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_concurrent_change_or_symlink_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'hosts'
            path.write_bytes(b'concurrent edit\n')
            with self.assertRaisesRegex(RuntimeError, 'HOSTS_CHANGED'):
                m.replace_hosts(path, b'old', b'new')
            self.assertEqual(path.read_bytes(), b'concurrent edit\n')
            link = Path(directory)/'link'
            link.symlink_to(path)
            with self.assertRaisesRegex(RuntimeError, 'HOSTS_PATH_UNSAFE'):
                m.replace_hosts(link, path.read_bytes(), b'new')

    def test_second_host_failure_restores_first_host(self):
        with tempfile.TemporaryDirectory() as directory:
            first,second = Path(directory)/'first',Path(directory)/'second'
            before = b'127.0.0.1 localhost\n'
            first.write_bytes(before)
            second.write_bytes(before)
            plan = m.hosts_plan([first,second], '142.251.143.142')
            second.write_bytes(b'concurrent edit\n')
            with self.assertRaisesRegex(RuntimeError, 'HOSTS_CHANGED'):
                m.apply_hosts(plan)
            self.assertEqual(first.read_bytes(),before)
            self.assertEqual(second.read_bytes(),b'concurrent edit\n')

    def test_partial_write_failure_restores_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'hosts'
            before = b'127.0.0.1 localhost\n'
            path.write_bytes(before)
            write = m.os.write
            calls = 0
            def failing_write(fd, data):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return write(fd, data[:4])
                if calls == 2:
                    raise OSError('simulated full disk')
                return write(fd, data)
            with patch.object(m.os, 'write', side_effect=failing_write):
                with self.assertRaises(OSError):
                    m.replace_hosts(path, before, m.hosts_content(before, '142.251.143.142'))
            self.assertEqual(path.read_bytes(), before)


class IdentityTests(unittest.TestCase):
    def test_recreated_container_allowed_only_with_expected_image_and_mounts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            edge_id = 'a'*64
            hosts = root/'containers'/edge_id/'hosts'
            hosts.parent.mkdir(parents=True)
            hosts.write_text('127.0.0.1 localhost\n')
            config = {'edge_name':'bos-edge', 'image':'sha256:fixture', 'live':'/opt/business-os/live'}
            edge = {'Id':edge_id, 'Name':'/bos-edge','Image':'sha256:fixture','State':{'Running':True},
                    'HostsPath':str(hosts), 'Mounts':[
                        {'Type':'bind','Destination':target,'Source':'/opt/business-os/live/edge/'+folder}
                        for folder,target in m.MOUNTS]}
            self.assertEqual(m.edge_hosts(config, edge, root), hosts)
            edge['Image'] = 'sha256:other'
            with self.assertRaisesRegex(RuntimeError, 'EDGE_CHANGED'):
                m.edge_hosts(config, edge, root)
            edge['Image'] = config['image']
            edge['Mounts'][0]['Source'] = '/unrelated'
            with self.assertRaisesRegex(RuntimeError, 'EDGE_MOUNT_CHANGED'):
                m.edge_hosts(config, edge, root)

    def test_failed_jobs_never_count_as_delivery(self):
        before = {'completed':0,'pending':1,'processing':0,'failed':0,'with_link':0}
        failed = dict(before, pending=0, failed=1)
        self.assertFalse(m.delivery_result(before, failed)['REAL_ARCHIVE_DELIVERY_VERIFIED'])
        completed = dict(before, pending=0, completed=1, with_link=1)
        self.assertTrue(m.delivery_result(before, completed)['REAL_ARCHIVE_DELIVERY_VERIFIED'])

    def test_pinned_route_helper_matches_source(self):
        import hashlib
        self.assertEqual(m.ROUTE_SHA, hashlib.sha256((ROOT/'gas-route-check.py').read_bytes()).hexdigest())


class SelectionTests(unittest.TestCase):
    def test_both_google_hops_use_ipv4_and_other_hosts_are_unchanged(self):
        calls=[]
        def resolve(host,*args,**kwargs):
            calls.append(host)
            return []
        with patch.object(socket,'getaddrinfo',side_effect=resolve) as resolver:
            with self.assertRaisesRegex(RuntimeError,'fixture'):
                with m.routed_google('142.251.143.142'):
                    socket.getaddrinfo(m.SOURCE,443)
                    socket.getaddrinfo(m.TARGET,443)
                    socket.getaddrinfo('unrelated.example',443)
                    raise RuntimeError('fixture')
            self.assertIs(socket.getaddrinfo,resolver)
        self.assertEqual(calls,['142.251.143.142','142.251.143.142','unrelated.example'])

    def test_both_routed_hostnames_keep_certificate_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)
            cert,key=path/'cert.pem',path/'key.pem'
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                '-subj','/CN='+m.SOURCE,'-addext','subjectAltName=DNS:'+m.SOURCE+',DNS:'+m.TARGET,
                '-keyout',str(key),'-out',str(cert)],check=True,capture_output=True)
            class Handler(BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'confirmed')
                def log_message(self,*args):
                    pass
            server=HTTPServer(('127.0.0.1',0),Handler)
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert,key)
            server.socket=context.wrap_socket(server.socket,server_side=True)
            thread=threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            try:
                opener=build_opener(ProxyHandler({}),HTTPSHandler(context=ssl.create_default_context(cafile=str(cert))))
                with m.routed_google('127.0.0.1'):
                    for host in m.GOOGLE_HOSTS:
                        with opener.open('https://'+host+':'+str(server.server_port),timeout=3) as response:
                            self.assertEqual(response.read(),b'confirmed')
                    with self.assertRaises(URLError):
                        opener.open('https://127.0.0.1:'+str(server.server_port),timeout=3)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_current_dns_is_tried_before_old_verified_address(self):
        app=object()
        addresses=['142.251.1.10','142.251.1.11','142.251.143.142']
        with patch.object(m,'candidate_addresses',return_value=addresses), \
             patch.object(m,'probe_address',side_effect=[False,True]) as probe, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.select_address(app,'fixture-key'),'142.251.1.11')
        self.assertEqual([c.args[2] for c in probe.call_args_list],addresses[:2])

    def test_no_route_does_not_fall_back_without_signed_confirmation(self):
        with patch.object(m,'candidate_addresses',return_value=['142.251.1.10']), \
             patch.object(m,'probe_address',return_value=False), \
             contextlib.redirect_stdout(io.StringIO()), \
             self.assertRaisesRegex(RuntimeError,'SIGNED_GOOGLE_ROUTE_UNAVAILABLE'):
            m.select_address(object(),'fixture-key')

    def test_transport_errors_reveal_no_request_url_or_credentials(self):
        from urllib.error import URLError
        error=URLError(OSError(101,'https://secret-url/?token=fixture-secret'))
        result=m.error_info(error)
        self.assertEqual(result,{'type':'OSError','errno':101})
        self.assertNotIn('secret',json.dumps(result))

    def test_probe_restores_app_transport_after_failure(self):
        opener=Mock()
        request=Mock()
        app=SimpleNamespace(build_opener=opener,request=request,
                            verify_gas=Mock(side_effect=RuntimeError('GAS_CONNECTION_FAILED')))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(m.probe_address(app,'fixture-key','142.251.143.142'))
        self.assertIs(app.build_opener,opener)
        self.assertIs(app.request,request)


class InstallationTests(unittest.TestCase):
    def run_fixture(self, bridge_works):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        parent = root/'deploy'
        activation = parent/'report-acceptance-stage-test/locked-test/runtime-test/activate-test'
        activation.mkdir(parents=True)
        (parent/'.report-acceptance-stage.lock').touch()
        runtime = activation.parent/'runtime.json'
        runtime.write_text(json.dumps({'image':'sha256:fixture'}))
        journal = {'phase':'complete_archive_pending','edge_id':'fixture',
                   'runtime_journal':str(runtime),'runtime_journal_sha256':hashlib.sha256(runtime.read_bytes()).hexdigest(),
                   'live':str(root/'live'),'loopback':'http://127.0.0.1:8888',
                   'database_id':'fixture-db','database':'fixture'}
        (activation/'activation.json').write_text(json.dumps(journal))
        spec = importlib.util.spec_from_file_location('route_fixture_activation',ROOT/'activate.py')
        app = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(app)
        def write(path,data):
            path.parent.mkdir(parents=True,exist_ok=True)
            with path.open('xb') as handle:
                handle.write(data)
        app.s = SimpleNamespace(PARENT=parent,read=lambda p:p.read_bytes(),write=write,
            sha=lambda data:hashlib.sha256(data).hexdigest(),inspect=lambda _: {'Name':'/bos-edge'})
        app.v = SimpleNamespace(environment=lambda _: {'BOS_SYNC_KEY':'fixture-key'},run=Mock())
        app.load_helpers = lambda: (app.s,app.v,None)
        app.installed_files = Mock()
        app.archive_inactive = Mock()
        body = {'ok':bridge_works,'body':json.dumps({'error':'ACT_REQUIRED' if bridge_works else 'WRONG'})}
        app.api = Mock(return_value=(200,json.dumps(body).encode(),{}))
        app.enable_archive = Mock()
        files = [root/'installed'/name for name in ('script.py','config.json','route.service','worker.conf')]
        hosts = [root/'host-hosts',root/'edge-hosts']
        before = b'127.0.0.1 localhost\n'
        for host in hosts:
            host.write_bytes(before)
        counts = {'pending':1,'processing':0,'completed':0,'failed':0,'with_link':0}
        complete = dict(counts,pending=0,completed=1,with_link=1)
        route = SimpleNamespace(load_app=lambda:app,probe=lambda *args:True)
        with contextlib.ExitStack() as stack:
            for name,dest in zip(('SCRIPT','CONFIG','UNIT','DROPIN'),files):
                stack.enter_context(patch.object(m,name,dest))
            stack.enter_context(patch.object(m,'load_route',return_value=route))
            stack.enter_context(patch.object(m,'route_paths',return_value=hosts))
            stack.enter_context(patch.object(m,'select_address',return_value='142.251.143.142'))
            stack.enter_context(patch.object(m,'queue_status',side_effect=[(counts,[]),(complete,[])]))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            if bridge_works:
                m.install()
            else:
                with self.assertRaisesRegex(RuntimeError,'LIVE_GAS_BRIDGE_FAILED'):
                    m.install()
        return app,files,hosts,before,output.getvalue()

    def test_bad_live_bridge_restores_hosts_and_files_without_starting_worker(self):
        app,files,hosts,before,output = self.run_fixture(False)
        app.enable_archive.assert_not_called()
        self.assertTrue(all(path.read_bytes()==before for path in hosts))
        self.assertTrue(all(not path.exists() for path in files))
        self.assertNotIn('GOOGLE_ROUTE_INSTALLED=true',output)
        self.assertIn('REPORT_ACCEPTANCE_REMAINS_INSTALLED=true',output)

    def test_good_live_bridge_installs_route_and_confirms_real_queue_completion(self):
        app,files,hosts,before,output = self.run_fixture(True)
        app.enable_archive.assert_called_once()
        self.assertTrue(all(path.exists() for path in files))
        self.assertTrue(all(m.TARGET.encode() in path.read_bytes() for path in hosts))
        self.assertIn('REAL_ARCHIVE_DELIVERY_VERIFIED=true',output)
        self.assertNotIn('fixture-key',output)


if __name__ == '__main__':
    unittest.main()
