#!/usr/bin/env python3
"""Build deterministic offline local-application operator zipapp."""
import hashlib
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent
MODULES = ('app.py', 'app_cli.py', 'app_plan.py', 'app_browser.py', 'app_db_log_sanitize.py',
           'app_storage.py', 'app_signed_urls.py', 'app_transport.py', 'drill.py', 'drill_db.py',
           'drill_files.py', 'drill_roles.py', 'drill_profile.py',
           'drill_errors.py', 'backup.py', 'discovery.py', 'image_archive.py')


def build(destination=None):
    destination = Path(destination) if destination else ROOT / 'bos-app.pyz'
    contents = {'__main__.py': b'import app_cli\nraise SystemExit(app_cli.main())\n'}
    contents.update({name: (ROOT / name).read_bytes() for name in MODULES})
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 15, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    launcher = ROOT / 'app.ps1'
    source = launcher.read_text(encoding='utf-8-sig')
    source, count = re.subn(r"(?m)^\$PackageSha256 = '[^']*'", "$PackageSha256 = '" + digest + "'", source)
    if count != 1:
        raise RuntimeError('Expected exactly one launcher package digest')
    launcher.write_text(source, encoding='utf-8', newline='\n')
    return digest


if __name__ == '__main__':
    print(build())
