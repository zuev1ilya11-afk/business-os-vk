#!/usr/bin/env python3
"""Build the deterministic, dependency-free operator zipapp."""
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent


def build(destination=None):
    destination = destination or ROOT / 'bos-backup.pyz'
    contents = {'__main__.py': b'import backup\nraise SystemExit(backup.main())\n'}
    for name in ('backup.py', 'discovery.py'):
        contents[name] = (ROOT / name).read_bytes()
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 14, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


if __name__ == '__main__':
    print(build())
