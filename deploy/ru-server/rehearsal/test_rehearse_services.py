import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class ServiceOrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.s=importlib.import_module('rehearse_services')

    def test_service_network_arguments_and_env_keep_secrets_out_of_argv(self):
        args=self.s.service_args('bos-service-trial-abcdef-rest','sha256:'+'a'*64,Path('/private/rest.env'),'b'*64)
        self.assertEqual(args[args.index('--network')+1],'container:'+'b'*64)
        self.assertNotIn('--publish',args)
        self.assertNotIn('-p',args)
        self.assertEqual(args[args.index('--restart')+1],'no')
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'rest.env'
            self.s.write_env(path,{'PASSWORD':'synthetic-password'})
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertNotIn('synthetic-password',' '.join(args))
            with self.assertRaises(ValueError):
                self.s.write_env(Path(folder)/'bad.env',{'PASSWORD':'bad\nINJECT=yes'})

    def test_ambiguous_create_is_registered_for_cleanup(self):
        with tempfile.TemporaryDirectory() as folder:
            runner=self.s.Runner(Path(folder),'bos-service-trial-abc')
            with patch.object(runner,'inspect',return_value=None), patch.object(runner,'command',side_effect=TimeoutError):
                with self.assertRaises(TimeoutError):
                    runner.create('bos-service-trial-abc-db',['docker','create'])
            self.assertEqual(runner.created,['bos-service-trial-abc-db'])

    def test_cleanup_reverses_order_and_stop_failure_is_not_success(self):
        with tempfile.TemporaryDirectory() as folder:
            runner=self.s.Runner(Path(folder),'bos-service-trial-abc')
            runner.created=['bos-service-trial-abc-db','bos-service-trial-abc-rest']
            info=lambda name,**kwargs:{'Name':'/'+name,'Config':{'Labels':{'bos.service-trial':'bos-service-trial-abc'}}}
            with patch.object(runner,'inspect',side_effect=info), patch.object(self.s,'stop_trial',side_effect=[True,False]) as stop:
                self.assertFalse(runner.cleanup())
                self.assertEqual([c.args[0] for c in stop.call_args_list],list(reversed(runner.created)))


if __name__=='__main__':
    unittest.main()
