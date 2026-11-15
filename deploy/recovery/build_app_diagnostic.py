"""Deterministic small diagnostic add-on for the already delivered app folder."""
import hashlib
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent
MODULES = ('app_diagnostic.py', 'app_cli.py', 'app_plan.py', 'drill_files.py',
           'backup.py', 'discovery.py', 'image_archive.py')


def build():
    package = ROOT / 'bos-app-check.pyz'
    items = {'__main__.py': b'import app_diagnostic\nraise SystemExit(app_diagnostic.main())\n'}
    items.update({name: (ROOT / name).read_bytes() for name in MODULES})
    with zipfile.ZipFile(package, 'w') as archive:
        for name, data in sorted(items.items()):
            item = zipfile.ZipInfo(name, date_time=(2026, 11, 15, 0, 0, 0))
            item.external_attr = 0o100644 << 16
            archive.writestr(item, data)
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    # Reuse the exact pinned-runtime verifier, never dot-source the app launcher.
    source = (ROOT / 'app.ps1').read_text()
    marker = "try {\n    if ($env:OS -ne 'Windows_NT')"
    assert source.count(marker) == 1
    prefix = source.split(marker)[0]
    prefix = re.sub(r"(?m)^\$PackageSha256 = '[^']*'", "$PackageSha256 = '" + digest + "'", prefix)
    tail = r'''try {
    if ($env:OS -ne 'Windows_NT') { Stop-Bos 'WINDOWS_LAUNCHER_REQUIRED' }
    Assert-NoReparse $PSScriptRoot
    $packagePath = Join-Path $PSScriptRoot 'bos-app-check.pyz'
    Assert-NoReparse $packagePath
    if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $PackageSha256) {
        Stop-Bos 'DIAGNOSTIC_PACKAGE_HASH_MISMATCH'
    }
    if (-not $ReportPath) { $ReportPath = Join-Path $PSScriptRoot 'restore-report.json' }
    if (-not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) { Stop-Bos 'APP_RESTORE_REPORT_MISSING' }
    $resolvedReport = (Resolve-Path -LiteralPath $ReportPath).ProviderPath
    Assert-NoReparse $resolvedReport
    $python = Get-PortablePython
    $pythonArguments = @('-I', $packagePath, '--package-dir', $PSScriptRoot, '--report', $resolvedReport)
    if ($BundlePath) {
        $resolvedBundle = (Resolve-Path -LiteralPath $BundlePath).ProviderPath
        Assert-NoReparse $resolvedBundle
        $pythonArguments += @('--bundle', $resolvedBundle)
    }
    & $python.Executable @pythonArguments
    exit $LASTEXITCODE
} catch {
    $code = $_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z0-9_]{3,80}$') { $code = 'DIAGNOSTIC_LAUNCH_FAILED' }
    Write-Output ('{"diagnostic":"STOPPED","reason":"' + $code + '"}')
    exit 1
}
'''
    (ROOT / 'check-app.ps1').write_text(prefix + tail, encoding='utf-8', newline='\n')
    return digest


if __name__ == '__main__':
    print(build())
