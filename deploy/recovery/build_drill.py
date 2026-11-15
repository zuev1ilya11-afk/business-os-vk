#!/usr/bin/env python3
"""Build the independent Windows/Linux restore-drill operator zipapp."""
import hashlib
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent


def build(destination=None):
    destination = destination or ROOT / 'bos-restore.pyz'
    contents = {'__main__.py': b'import drill\nraise SystemExit(drill.main())\n'}
    for name in ('drill.py', 'drill_db.py', 'drill_files.py', 'drill_roles.py', 'backup.py',
                 'drill_profile.py', 'drill_errors.py', 'discovery.py', 'image_archive.py'):
        contents[name] = (ROOT / name).read_bytes()
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 15, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    launcher = ROOT / 'restore.ps1'
    source = launcher.read_text(encoding='utf-8-sig')
    source, count = re.subn(r"(?m)^\$PackageSha256 = '[^']*'", "$PackageSha256 = '" + digest + "'", source)
    if count != 1:
        raise RuntimeError('Expected exactly one launcher package digest')
    launcher.write_text(source, encoding='utf-8', newline='\n')
    return digest


if __name__ == '__main__':
    print(build())
