"""Build a reproducible add-on using the already-bundled offline Python."""
import hashlib
from pathlib import Path
import re
import zipfile

import build_app_login_diagnostic as login_build

ROOT = Path(__file__).resolve().parent
FILES = ('bos-flow-check.pyz', 'check-flow.ps1', 'check-flow.cmd', 'FLOW-CHECK-README.txt')


def write_zip(path, items, compression=zipfile.ZIP_STORED):
    with zipfile.ZipFile(path, 'w', compression=compression) as archive:
        for name, data in sorted(items.items()):
            item = zipfile.ZipInfo(name, date_time=(2026, 11, 16, 0, 0, 0))
            item.create_system = 3
            item.external_attr = 0o100644 << 16
            item.compress_type = compression
            archive.writestr(item, data)


def build():
    package = ROOT / 'bos-flow-check.pyz'
    items = {name: (ROOT / name).read_bytes() for name in login_build.MODULES}
    items['app_flow_check.py'] = (ROOT / 'app_flow_check.py').read_bytes()
    items['__main__.py'] = b'import app_flow_check\nraise SystemExit(app_flow_check.main())\n'
    write_zip(package, items)
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    prefix = (ROOT / 'app.ps1').read_text().split("try {\n    if ($env:OS -ne 'Windows_NT')")[0]
    prefix, count = re.subn(r"(?m)^\$PackageSha256 = '[^']*'", "$PackageSha256 = '" + digest + "'", prefix)
    assert count == 1
    tail = r'''try {
    if ($env:OS -ne 'Windows_NT') { Stop-Bos 'WINDOWS_LAUNCHER_REQUIRED' }
    Assert-NoReparse $PSScriptRoot
    $packagePath = Join-Path $PSScriptRoot 'bos-flow-check.pyz'
    Assert-NoReparse $packagePath
    if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $PackageSha256) {
        Stop-Bos 'FLOW_PACKAGE_HASH_MISMATCH'
    }
    $python = Get-PortablePython
    & $python.Executable '-I' '-X' 'utf8' $packagePath '--package-dir' $PSScriptRoot
    exit $LASTEXITCODE
} catch {
    $code = $_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z0-9_]{3,80}$') { $code = 'FLOW_LAUNCH_FAILED' }
    Write-Output ('{"status":"STOPPED","reason":"' + $code + '"}')
    exit 1
}
'''
    (ROOT / 'check-flow.ps1').write_text(prefix + tail, encoding='utf-8', newline='\n')
    write_zip(ROOT / 'BOS-Flow-Check-20261116.zip',
              {name: (ROOT / name).read_bytes() for name in FILES}, zipfile.ZIP_DEFLATED)
    return digest


if __name__ == '__main__':
    print(build())
