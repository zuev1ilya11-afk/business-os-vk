#!/usr/bin/env python3
"""Build a deterministic self-contained release; no runtime downloads of code."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
APP = '480c31453ba71efa25c8feca6b47af08ed548f62'
BASE = '80a97b374357706a5e1a1ca4f16d9bfdaaf773aa'
API = 'supabase/functions/mini-app-api/index.ts'
FRONT = ['finance-page.js', 'pwa-register.js', 'approved-operations-ui.css']
NEW = ['finance-export-data.js', 'finance-export-ui.js',
       'supabase/functions/_shared/finance-export.ts', 'supabase/functions/_shared/finance-export-models.mjs']


def git_file(revision, name):
    return subprocess.check_output(['git', 'show', revision + ':' + name], cwd=ROOT)


def build():
    payload = {'before/' + n: git_file(BASE, n) for n in [*FRONT, API]}
    payload.update({'after/' + n: git_file(APP, n) for n in set([*FRONT, API, *NEW])})
    payload['probe.py'] = (HERE / 'probe.py').read_bytes()
    payload['fixture.json'] = subprocess.check_output(['node', '-e',
        "process.stdout.write(JSON.stringify(require('./tests/helpers/finance-export-fixture.cjs').fixture()))"], cwd=ROOT)
    meta = {'application': APP, 'files': {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()}}
    files = {n: (HERE / n).read_bytes() for n in ['common.py', 'check.py', 'web.py', 'eszip.py', 'frozen.py', 'backend.py', 'release.py']}
    files['__main__.py'] = b'import runpy\nrunpy.run_module("release",run_name="__main__")\n'
    files['package.json'] = json.dumps(meta, sort_keys=True, separators=(',', ':')).encode()
    files.update({'payload/' + name: data for name, data in payload.items()})
    path = HERE / 'bos-finance.pyz'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, (2026, 10, 31, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, files[name])
    print(json.dumps({'file': path.name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}))


if __name__ == '__main__': build()
