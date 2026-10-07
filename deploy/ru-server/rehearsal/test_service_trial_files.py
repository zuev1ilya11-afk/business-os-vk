import hashlib
import importlib
import json
import os
from pathlib import Path
import tempfile
import unittest


class ServiceFilesTests(unittest.TestCase):
    def setUp(self):
        self.f = importlib.import_module('service_trial_files')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.folder = self.root / 'snapshot'
        self.folder.mkdir()
        (self.folder / 'objects').mkdir()
        self.body = b'business-os-file\x00\xff'
        self.row = {'id':'10000000-0000-4000-8000-000000000001',
                    'version':'20000000-0000-4000-8000-000000000002',
                    'bucket_id':'business-os-vk-files','name':'orders/example/file.jpg',
                    'metadata': {'size':len(self.body),'eTag':hashlib.md5(self.body).hexdigest(),
                                 'mimetype':'image/jpeg','cacheControl':'max-age=3600'}}
        manifest = {'project':'obsropbslfwtanyspjbi','source_dump_sha256':'a'*64,'objects':[self.row]}
        (self.folder / 'manifest.json').write_text(json.dumps(manifest))
        (self.folder / 'objects' / self.row['id']).write_bytes(self.body)
        self.write_sums()

    def write_sums(self):
        paths = ['manifest.json', 'objects/' + self.row['id']]
        (self.folder / 'SHA256SUMS').write_text(''.join(
            hashlib.sha256((self.folder/p).read_bytes()).hexdigest()+'  '+p+'\n' for p in paths))

    def test_exact_bytes_versioned_layout_and_metadata(self):
        snapshot = self.f.read_storage_snapshot(self.folder, 'a'*64)
        destination = self.root / 'storage'
        self.f.materialize_storage(snapshot, destination)
        result = destination / 'stub/stub/business-os-vk-files/orders/example/file.jpg' / self.row['version']
        self.assertEqual(result.read_bytes(), self.body)
        self.assertEqual(os.getxattr(result, 'user.supabase.content-type'), b'image/jpeg')
        self.assertEqual(os.getxattr(result, 'user.supabase.cache-control'), b'max-age=3600')
        self.assertEqual(snapshot['objects'][0]['sha256'], hashlib.sha256(self.body).hexdigest())

    def test_tampered_bytes_and_wrong_dump_refused(self):
        with self.assertRaises(ValueError):
            self.f.read_storage_snapshot(self.folder, 'b'*64)
        (self.folder/'objects'/self.row['id']).write_bytes(b'bad')
        with self.assertRaises(ValueError):
            self.f.read_storage_snapshot(self.folder, 'a'*64)

    def test_symlink_and_manifest_traversal_refused(self):
        obj = self.folder/'objects'/self.row['id']
        obj.unlink()
        target = self.root/'outside'
        target.write_bytes(self.body)
        obj.symlink_to(target)
        with self.assertRaises(ValueError):
            self.f.read_storage_snapshot(self.folder, 'a'*64)
        obj.unlink()
        obj.write_bytes(self.body)
        data=json.loads((self.folder/'manifest.json').read_text())
        data['objects'][0]['name']='../outside'
        (self.folder/'manifest.json').write_text(json.dumps(data))
        self.write_sums()
        with self.assertRaises(ValueError):
            self.f.read_storage_snapshot(self.folder, 'a'*64)

    def test_source_mounts_require_stopped_isolated_trial(self):
        name='bos-restore-trial-abc123'
        info={'Name':'/'+name,'Id':'a'*64,'Image':'sha256:'+'b'*64,
              'State':{'Running':False},'Config':{'Labels':{'bos.restore-trial':'true'},'Cmd':['cron.launch_active_jobs=off']},
              'HostConfig':{'NetworkMode':'none','PortBindings':{},'RestartPolicy':{'Name':'no'}},
              'Mounts':[{'Type':'bind','Source':'/opt/business-os/deploy/restore-trial-abc123/data','Destination':'/var/lib/postgresql/data','RW':True},
                        {'Type':'volume','Name':name+'-config','Destination':'/etc/postgresql-custom','RW':True}]}
        self.assertEqual(self.f.source_mounts(info,name)[0],Path('/opt/business-os/deploy/restore-trial-abc123/data'))
        info['State']['Running']=True
        with self.assertRaises(ValueError):
            self.f.source_mounts(info,name)


if __name__=='__main__':
    unittest.main()
