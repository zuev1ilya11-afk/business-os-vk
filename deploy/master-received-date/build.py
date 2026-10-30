"""Build a deterministic self-contained installer from the reviewed source diff."""
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BASE = '4572c9cad9f2e54ae1533a40fafd5a7100797aab'
REVISION = '73cbd60ac09792403011ef92246796d1eedc27d1'
CORE_HASH = '50f0ed32a8a4cd9d66a7a7ee081a6dacd5e651715de714c1c09479069a2ab760'
SOURCES = ('approved-master-ui.css', 'master-daily-home-v127.js',
           'master-order-focus-v126.js', 'master-order-hands-layout-v72.js',
           'master-orders-v125.js')


def source(revision, name):
    return subprocess.check_output(['git', 'show', revision + ':' + name], cwd=REPO).decode()


def payload():
    edits = {}
    for name in SOURCES:
        before, after = source(BASE, name).splitlines(True), source(REVISION, name).splitlines(True)
        groups = difflib.SequenceMatcher(None, before, after, autojunk=False).get_grouped_opcodes(1)
        edits[name] = [{'before': ''.join(before[g[0][1]:g[-1][2]]),
                        'after': ''.join(after[g[0][3]:g[-1][4]])} for g in groups]
        assert edits[name] and all(e['before'] for e in edits[name])
        check = ''.join(before)
        for edit in edits[name]:
            assert check.count(edit['before']) == 1
            check = check.replace(edit['before'], edit['after'], 1)
        assert check == ''.join(after)
    return {'revision': REVISION, 'base': BASE, 'edits': edits}


def build():
    core = (REPO / 'scripts/ru-master-home-release.py').read_bytes()
    assert hashlib.sha256(core).hexdigest() == CORE_HASH
    files = {'__main__.py': (HERE / 'release.py').read_bytes(), 'core.py': core,
             'patches.json': json.dumps(payload(), ensure_ascii=False, separators=(',', ':')).encode()}
    dest = HERE / 'bos-received.pyz'
    with zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    print('PACKAGE_SHA256=' + hashlib.sha256(dest.read_bytes()).hexdigest())


if __name__ == '__main__':
    build()
