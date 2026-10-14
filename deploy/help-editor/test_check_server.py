import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('check_server', Path(__file__).with_name('check_server.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CheckServerTests(unittest.TestCase):
 def test_read_only_and_no_secrets_in_output(self):
  import json
  calls=[]
  rows=[{'Id':'edge','Name':'/bos-release-test-edge','Image':'sha256:edge','Config':{'Image':'edge:1','Env':['SECRET=do-not-print']},'Mounts':[{'Destination':'/bos-src','Source':'/opt/business-os/deploy/release-test/edge/sources','Type':'bind'}]}, {'Id':'web','Name':'/bos-release-test-web','Config':{'Image':'caddy:2'},'Mounts':[{'Destination':'/srv','Source':'/opt/business-os/deploy/release-test/web','Type':'bind'}]}, {'Id':'db','Name':'/db','Config':{'Image':'supabase/postgres:17'},'Mounts':[]}]
  def command(args):
   calls.append(args)
   if 'psql' in args:return '{"help_table_exists":false}'
   if args[-1].endswith('build-version.js'):return 'self.BOS_BUILD={"id":"01234567890123456789"}'
   if 'sha256sum' in args:return 'a'*64+'  filename'
   return 'dummy source with PRIVATE TOKEN not for printing'
  output=m.report(rows,command)
  self.assertFalse(output['production_changed']);self.assertFalse(output['memo_matches_repository_base'])
  self.assertEqual(output['web_build'],'01234567890123456789')
  self.assertNotIn('do-not-print',json.dumps(output));self.assertNotIn('PRIVATE TOKEN',json.dumps(output))
  self.assertTrue(all(a[:2]==['docker','exec'] and a[3] in ['cat','sha256sum','psql'] for a in calls))
  self.assertTrue(m.SQL.startswith('BEGIN READ ONLY;'));self.assertTrue(m.SQL.rstrip().endswith('ROLLBACK;'))
 def test_missing_edge_stops_without_commands(self):
  output=m.report([],lambda args:self.fail('Unexpected command'))
  self.assertIn('stop',output)
 def test_command_failure_does_not_leak_stderr(self):
  from unittest.mock import patch
  import subprocess
  with patch.object(m.subprocess,'run',side_effect=subprocess.CalledProcessError(1,['docker'],stderr='SECRET')):
   with self.assertRaisesRegex(RuntimeError,'Read-only command failed: docker exec') as e:m.run(['docker','exec','sensitive'])
  self.assertNotIn('SECRET',str(e.exception))

if __name__=='__main__':unittest.main()
