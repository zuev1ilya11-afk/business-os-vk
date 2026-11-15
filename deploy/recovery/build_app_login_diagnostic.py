"""Offline add-on for diagnosing the already-running local login path."""
import hashlib
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent
MODULES = ('app_login_diagnostic.py', 'app_cli.py', 'app_db_log_sanitize.py',
    'app_transport.py', 'drill.py', 'drill_db.py', 'drill_files.py', 'drill_roles.py',
    'drill_profile.py', 'drill_errors.py', 'backup.py', 'discovery.py', 'image_archive.py')


def build():
    package = ROOT / 'bos-login-check.pyz'
    items = {'__main__.py': b'import app_login_diagnostic\nraise SystemExit(app_login_diagnostic.main())\n'}
    items.update({name: (ROOT / name).read_bytes() for name in MODULES})
    with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(items.items()):
            item = zipfile.ZipInfo(name, date_time=(2026, 11, 15, 0, 0, 0))
            item.create_system = 3
            item.external_attr = 0o100644 << 16
            archive.writestr(item, data)
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    prefix = (ROOT / 'app.ps1').read_text().split("try {\n    if ($env:OS -ne 'Windows_NT')")[0]
    prefix, count = re.subn(r"(?m)^\$PackageSha256 = '[^']*'", "$PackageSha256 = '" + digest + "'", prefix)
    assert count == 1
    tail = r'''try {
    if ($env:OS -ne 'Windows_NT') { Stop-Bos 'WINDOWS_LAUNCHER_REQUIRED' }
    Assert-NoReparse $PSScriptRoot
    $packagePath = Join-Path $PSScriptRoot 'bos-login-check.pyz'
    Assert-NoReparse $packagePath
    if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $PackageSha256) {
        Stop-Bos 'LOGIN_DIAGNOSTIC_PACKAGE_HASH_MISMATCH'
    }
    $python = Get-PortablePython
    & $python.Executable '-I' $packagePath '--package-dir' $PSScriptRoot
    exit $LASTEXITCODE
} catch {
    $code = $_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z0-9_]{3,80}$') { $code = 'LOGIN_DIAGNOSTIC_LAUNCH_FAILED' }
    Write-Output ('{"diagnostic":"STOPPED","reason":"' + $code + '"}')
    exit 1
}
'''
    (ROOT / 'check-login.ps1').write_text(prefix + tail, encoding='utf-8', newline='\n')
    return digest


if __name__ == '__main__':
    print(build())
