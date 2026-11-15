# Real Windows PowerShell 5.1 process tests; no Docker or production data.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'These launcher tests require Windows.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('bos-launcher-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testRoot
$bundle = Join-Path $testRoot 'bundle with spaces'
$null = New-Item -ItemType Directory -Path $bundle
[IO.File]::WriteAllText((Join-Path $bundle 'manifest.json'), '{}')
$package = Join-Path $testRoot 'bos-restore.pyz'
$zip = [IO.Compression.ZipFile]::Open($package, [IO.Compression.ZipArchiveMode]::Create)
try {
    $contents = @{
        '__main__.py' = @'
import sys, hashlib, tarfile, selectors
from pathlib import Path
from fixture_module import MARKER
assert sys.flags.isolated == 1
assert sys.argv[1] == '--bundle'
assert Path(sys.argv[2]).name == 'bundle with spaces'
assert (Path(sys.argv[2]) / 'manifest.json').is_file()
print(MARKER)
raise SystemExit(7)
'@
        'fixture_module.py' = "MARKER = 'LAUNCHER_FIXTURE_OK'"
    }
    foreach ($name in $contents.Keys) {
        $entry = $zip.CreateEntry($name)
        $stream = $entry.Open()
        $bytes = [Text.Encoding]::UTF8.GetBytes($contents[$name])
        try { $stream.Write($bytes, 0, $bytes.Length) }
        finally { $stream.Dispose() }
    }
} finally { $zip.Dispose() }
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'restore.ps1'))
$source = [regex]::Replace($source, "(?m)^\`$PackageSha256 = '[^']+'", ('$PackageSha256 = ' + "'" + $hash + "'"))
$launcher = Join-Path $testRoot 'restore.ps1'
[IO.File]::WriteAllText($launcher, $source, (New-Object Text.UTF8Encoding($false)))

function Invoke-LauncherFixture([string]$Extra = '') {
    $process = New-Object Diagnostics.Process
    try {
        $process.StartInfo.FileName = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $scriptArg = $launcher.Replace("'", "''")
        $bundleArg = $bundle.Replace("'", "''")
        $process.StartInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& ''' + $scriptArg + ''' -BundlePath ''' + $bundleArg + ''' ' + $Extra + '"'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'Fixture process timed out.' }
        return @{ Code = $process.ExitCode; Out = $stdout.Result; Err = $stderr.Result }
    } finally { $process.Dispose() }
}

function Assert-FixtureSuccess($Result, [string]$Case) {
    if ($Result.Code -ne 7 -or $Result.Out.Trim() -ne 'LAUNCHER_FIXTURE_OK' -or $Result.Err.Trim()) {
        throw ($Case + ' failed: ' + $Result.Code + ' ' + $Result.Out + ' ' + $Result.Err)
    }
    Write-Output ($Case + ': PASS')
}

Assert-FixtureSuccess (Invoke-LauncherFixture) 'Installed Python and spaced bundle path'
Assert-FixtureSuccess (Invoke-LauncherFixture '-UsePortablePython') 'Pinned portable Python and zipapp module import'

# Exercise the delivered offline ZIP path with the HTTPS fallback unusable.
# This cache was just created and verified by the preceding synthetic test.
$profileRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$cachedArchive = Join-Path $profileRoot 'BOS-Tools\python-3.12.10-embed-amd64.zip'
$bundledArchive = Join-Path $testRoot 'python-3.12.10-embed-amd64.zip'
[IO.File]::Move($cachedArchive, $bundledArchive)
$offlineSource = $source.Replace(
    'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',
    'invalid-uri-fallback-must-not-run')
[IO.File]::WriteAllText($launcher, $offlineSource, (New-Object Text.UTF8Encoding($false)))
try { Assert-FixtureSuccess (Invoke-LauncherFixture '-UsePortablePython') 'Bundled Python without HTTPS fallback' }
finally { [IO.File]::WriteAllText($launcher, $source, (New-Object Text.UTF8Encoding($false))) }

# A modified code package must stop before either Python path is selected.
$file = [IO.File]::Open($package, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try { $file.WriteByte(65) } finally { $file.Dispose() }
$result = Invoke-LauncherFixture
if ($result.Code -ne 1 -or $result.Out -notmatch 'RESTORE_PACKAGE_HASH_MISMATCH' -or
    $result.Out -match 'LAUNCHER_FIXTURE_OK') { throw 'Tampered package was not rejected.' }
Write-Output 'Tampered package rejected: PASS'

# Restore only our appended byte, then prove missing bundle rejection.
$file = [IO.File]::Open($package, [IO.FileMode]::Open, [IO.FileAccess]::Write)
try { $file.SetLength($file.Length - 1) } finally { $file.Dispose() }
Remove-Item -LiteralPath (Join-Path $bundle 'manifest.json')
$result = Invoke-LauncherFixture
if ($result.Code -ne 1 -or $result.Out -notmatch 'BUNDLE_MANIFEST_MISSING' -or
    $result.Out -match 'LAUNCHER_FIXTURE_OK') { throw 'Missing manifest was not rejected.' }
Write-Output 'Missing manifest rejected: PASS'

Write-Output 'Launcher tests: 5 passed (real Windows PowerShell processes).'
