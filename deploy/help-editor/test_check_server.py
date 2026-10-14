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
   if 'help-metadata' in args:return '{"help_table_exists":false}'
   if args[-1].endswith('build-version.js'):return 'self.BOS_BUILD={"id":"01234567890123456789"}'
   if 'sha256sum' in args:return 'a'*64+'  filename'
   return 'dummy source with PRIVATE TOKEN not for printing'
  output=m.report(rows,command)
  self.assertFalse(output['production_changed']);self.assertFalse(output['memo_matches_repository_base'])
  self.assertEqual(output['web_build'],'01234567890123456789')
  self.assertNotIn('do-not-print',json.dumps(output));self.assertNotIn('PRIVATE TOKEN',json.dumps(output))
  self.assertTrue(all(a[:2]==['docker','exec'] and a[3] in ['cat','sha256sum','sh'] for a in calls))
  query=next(a for a in calls if 'help-metadata' in a);self.assertEqual(query[-1],m.SQL);self.assertIn('POSTGRES_USER',query[-4]);self.assertNotIn('do-not-print',str(query))
  self.assertTrue(m.SQL.startswith('BEGIN READ ONLY;'));self.assertTrue(m.SQL.rstrip().endswith('ROLLBACK;'))
 def test_uses_database_selected_by_live_postgrest_not_bootstrap_default(self):
  rows=[{'Id':'db','Name':'/bos-db','Config':{'Image':'postgres:17','Env':['POSTGRES_DB=postgres','POSTGRES_USER=postgres','POSTGRES_PASSWORD=private-password']},'NetworkSettings':{'Networks':{'internal':{'Aliases':['bos-db'],'IPAddress':'172.20.0.2'}}}}, {'Id':'rest','Name':'/bos-rest','Config':{'Image':'postgrest/postgrest:v13','Env':['PGRST_DB_URI=postgres://authenticator:private-password@bos-db:5432/business_os']}}]
  calls=[]
  def command(args):
   calls.append(args)
   if args[-2]!='business_os':raise RuntimeError('Wrong database')
   return '{"version":"17", "help_table_exists":false}'
  result=m.database_report(rows,command)
  self.assertEqual(result['version'],'17');self.assertEqual(result['target_source'],'live PostgREST')
  self.assertNotIn('private-password',str(result)+str(calls))
 def test_foreign_postgrest_host_is_not_queried(self):
  rows=[{'Id':'db','Name':'/bos-db','Config':{'Image':'postgres:17'}}, {'Id':'rest','Name':'/rest','Config':{'Image':'postgrest/postgrest:v13','Env':['PGRST_DB_URI=postgres://user:secret@other-server/business_os']}}]
  result=m.database_report(rows,lambda a:self.fail('Must not query an unverified database'))
  self.assertEqual(result['status'],'POSTGREST_DATABASE_HOST_NOT_MAPPED')
 def test_missing_edge_stops_without_commands(self):
  output=m.report([],lambda args:self.fail('Unexpected command'))
  self.assertIn('stop',output)
 def test_command_failure_does_not_leak_stderr(self):
  from unittest.mock import patch
  import subprocess
  with patch.object(m.subprocess,'run',side_effect=subprocess.CalledProcessError(1,['docker'],stderr='SECRET')):
   with self.assertRaisesRegex(RuntimeError,'Read-only command failed: docker exec') as e:m.run(['docker','exec','sensitive'])
  self.assertNotIn('SECRET',str(e.exception))
  with patch.object(m.subprocess,'run',side_effect=subprocess.CalledProcessError(1,['docker'],stderr=b'ERROR: 42P01\nSECRET')):
   with self.assertRaises(m.ReadFailure) as e:m.run(['docker','exec','db'])
  self.assertEqual(e.exception.code,'SQLSTATE_42P01');self.assertNotIn('SECRET',str(e.exception))

if __name__=='__main__':unittest.main()
