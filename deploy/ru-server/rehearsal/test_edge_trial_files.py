import copy
import hashlib
import importlib
import json
import os
from pathlib import Path
import tempfile
import unittest

from backup_functions import snapshot
from stage_runtime_secrets import save_secrets
from verify_runtime_secrets import NAMES, load_secrets, save_receipt


class EdgeFilesTests(unittest.TestCase):
    def setUp(self):
        self.m = importlib.import_module('edge_trial_files')

    def test_source_paths_preserve_shared_imports_and_refuse_escape(self):
        prefix='file:///tmp/user_fn_project_id_1/source/'
        self.assertEqual(self.m.source_relative(prefix+'supabase/functions/a/index.ts',prefix),
                         'supabase/functions/a/index.ts')
        self.assertEqual(self.m.source_relative('order-payroll.js',prefix),'order-payroll.js')
        self.assertEqual(self.m.source_relative('source/supabase/functions/a/index.ts',prefix),
                         'supabase/functions/a/index.ts')
        self.assertEqual(self.m.source_relative(prefix+'source/helper.ts',prefix),'source/helper.ts')
        for bad in ('../evil','a/../../evil','/other/source/index.ts','file:///other/index.ts',
                    'a\\evil','a/./evil','a//evil','https://example/x','a\x00x'):
            with self.subTest(bad=bad),self.assertRaises(ValueError):
                self.m.source_relative(bad,prefix)

    def test_assemble_keeps_function_versions_separate_and_no_overwrites(self):
        functions=[{'slug':s,'entrypoint':'supabase/functions/a/index.ts','import_map':None,
                    'verify_jwt':False,'files':{'supabase/functions/a/index.ts':b'import "../../../shared.js";',
                                               'shared.js':s.encode()}}
                   for s in ('a','b')]
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'sources'
            routes=self.m.assemble(functions,root)
            self.assertEqual((root/'a/shared.js').read_bytes(),b'a')
            self.assertEqual((root/'b/shared.js').read_bytes(),b'b')
            self.assertEqual(routes['a']['entrypoint'],'supabase/functions/a/index.ts')
            with self.assertRaises(FileExistsError):self.m.assemble(functions,root)

    def test_snapshot_hash_inventory_and_symlink_guards(self):
        row={'id':'id','slug':'a','version':1,'status':'ACTIVE','verify_jwt':False,
             'entrypoint_path':'file:///tmp/user_fn_project_id_1/source/index.ts','import_map':False}
        body=(b'--bos\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\n'
              b'\r\nDeno.serve(()=>new Response("ok"));\r\n--bos--\r\n')
        class Client:
            def inventory(self,count):return [row]
            def get(self,*args):return 'multipart/form-data; boundary=bos',body
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            snapshot(Client(),root,1)
            baseline={'functions':[row],'audited':{}}
            self.assertEqual(len(self.m.read_snapshot(root,baseline)),1)
            part=root/'functions/a/parts/0000'
            original=part.read_bytes()
            part.write_bytes(b'changed')
            with self.assertRaises(ValueError):self.m.read_snapshot(root,baseline)
            part.write_bytes(original)
            changed=copy.deepcopy(baseline);changed['functions'][0]['version']=2
            with self.assertRaises(ValueError):self.m.read_snapshot(root,changed)
            target=root/'real';part.rename(target);part.symlink_to(target)
            with self.assertRaises(ValueError):self.m.read_snapshot(root,baseline)

    def test_secret_receipt_must_match_current_bytes_and_all_five_names(self):
        with tempfile.TemporaryDirectory() as d:
            root=save_secrets(Path(d),{k:'synthetic-'+k for k in NAMES})
            with self.assertRaises(ValueError):self.m.read_verified_secrets(root)
            _,sha=load_secrets(root)
            result={'all_match':True,'matched':list(NAMES),'missing':[],'mismatched':[],'unexpected':[]}
            receipt=save_receipt(root,sha,result)
            self.assertEqual(set(self.m.read_verified_secrets(root)),set(NAMES))
            obj=json.loads(receipt.read_text());obj['secrets_file_sha256']='0'*64
            receipt.write_text(json.dumps(obj))
            with self.assertRaises(ValueError):self.m.read_verified_secrets(root)

    def test_deno2_export_entrypoint_import_map_and_relative_shared_module(self):
        row={'id':'id','slug':'a','version':1,'status':'ACTIVE','verify_jwt':False,
             'entrypoint_path':'file:///tmp/user_fn_project_id_1/source/supabase/functions/a/index.ts',
             'import_map':True,
             'import_map_path':'file:///tmp/user_fn_project_id_1/source/supabase/functions/a/deno.json'}
        files={'source/supabase/functions/a/index.ts':b'import "../../../shared.js";',
               'source/supabase/functions/a/deno.json':b'{"imports":{"zod":"npm:zod@3.25.76"}}',
               'source/shared.js':b'export const shared = true;'}
        def body():
            return b''.join(b'--bos\r\nContent-Disposition: form-data; name="file"; filename="'+
                name.encode()+b'"\r\n\r\n'+data+b'\r\n' for name,data in files.items())+b'--bos--\r\n'
        class Client:
            def inventory(self,count):return [row]
            def get(self,*args):return 'multipart/form-data; boundary=bos',body()
        baseline={'functions':[row],'audited':{'a':hashlib.sha256(files['source/supabase/functions/a/index.ts']).hexdigest()}}
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);snapshot(Client(),root,1)
            functions=self.m.read_snapshot(root,baseline)
            self.assertEqual(functions[0]['entrypoint'],'supabase/functions/a/index.ts')
            self.assertEqual(functions[0]['import_map'],'supabase/functions/a/deno.json')
            self.assertEqual(functions[0]['files']['shared.js'],b'export const shared = true;')
        del files['source/supabase/functions/a/deno.json']
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);snapshot(Client(),root,1)
            with self.assertRaisesRegex(ValueError,'Missing entrypoint or import map'):
                self.m.read_snapshot(root,baseline)
        files['supabase/functions/a/index.ts']=b'conflicting source'
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);snapshot(Client(),root,1)
            with self.assertRaisesRegex(ValueError,'Source path collision'):
                self.m.read_snapshot(root,baseline)


if __name__=='__main__':unittest.main()
