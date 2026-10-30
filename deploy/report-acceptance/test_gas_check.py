import importlib.util
import json
from pathlib import Path
import socket
import ssl
import unittest
from urllib.error import URLError

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('gas_check_test',ROOT/'gas-check.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class GasDiagnosticsTests(unittest.TestCase):
    def test_helper_digest_matches_published_installer(self):
        import hashlib
        self.assertEqual(hashlib.sha256((ROOT/'activate.py').read_bytes()).hexdigest(),m.ACTIVATE_SHA)

    def test_network_errors_keep_type_and_errno_without_private_message(self):
        for error,kind in ((URLError(socket.gaierror(-3,'private-host-secret')),'gaierror'),
                           (URLError(ConnectionResetError(104,'private-url-secret')),'ConnectionResetError'),
                           (TimeoutError('private-data-secret'),'TimeoutError'),
                           (ssl.SSLError('private-token-secret'),'SSLError')):
            info=m.error_info(error)
            self.assertEqual(info['type'],kind)
            self.assertNotIn('private',json.dumps(info))


if __name__=='__main__':
    unittest.main()
