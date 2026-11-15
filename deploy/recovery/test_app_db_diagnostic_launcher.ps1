# Real PowerShell 5.1 launcher processes with a synthetic diagnostic child.
# The real collector is exercised separately against disposable Docker.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows required' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path ([IO.Path]::GetTempPath()) ('bos db diagnostic ' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$archiveName = 'python-3.12.10-embed-amd64.zip'
[IO.File]::Copy($env:BOS_APP_PYTHON_ZIP, (Join-Path $root $archiveName))
$report = Join-Path $root 'restore-report.json'
[IO.File]::WriteAllText($report, '{"fixture":true}')
$package = Join-Path $root 'bos-db-check.pyz'
$zip = [IO.Compression.ZipFile]::Open($package, [IO.Compression.ZipArchiveMode]::Create)
try {
    $entry = $zip.CreateEntry('__main__.py')
    $stream = $entry.Open()
    $code = @'
import sys
from pathlib import Path
assert sys.flags.isolated
assert sys.argv[1] == '--package-dir'
assert Path(sys.argv[2]) == Path(sys.argv[0]).parent
assert sys.argv[3] == '--report'
assert Path(sys.argv[4]).name == 'restore-report.json'
assert Path(sys.executable).parent.parent == Path(sys.argv[0]).parent
assert 'bos db diagnostic ' in sys.argv[0]
print('DB_DIAGNOSTIC_OFFLINE_LAUNCHER_OK')
raise SystemExit(7)
'@
    $data = [Text.Encoding]::UTF8.GetBytes($code)
    try { $stream.Write($data, 0, $data.Length) } finally { $stream.Dispose() }
} finally { $zip.Dispose() }
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'check-db.ps1'))
$source = [regex]::Replace($source, "(?m)^\`$PackageSha256 = '[^']+'", ('$PackageSha256 = ' + "'" + $hash + "'"))
$launcher = Join-Path $root 'check-db.ps1'
[IO.File]::WriteAllText($launcher, $source, (New-Object Text.UTF8Encoding($false)))

# A real executable detects accidental launcher-level Docker execution.
$trapDirectory = Join-Path $root 'process-trap'
$null = New-Item -ItemType Directory -Path $trapDirectory
$trapMarker = Join-Path $root 'docker-was-called.txt'
$trapSource = @'
using System;
using System.IO;
public class DbDiagnosticDockerTrap {
    public static int Main() {
        File.WriteAllText(Environment.GetEnvironmentVariable("BOS_DB_DIAGNOSTIC_DOCKER_TRAP"), "called");
        return 47;
    }
}
'@
Add-Type -TypeDefinition $trapSource -OutputAssembly (Join-Path $trapDirectory 'docker.exe') -OutputType ConsoleApplication

function Invoke-Fixture {
    $process = New-Object Diagnostics.Process
    try {
        $process.StartInfo.FileName = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $process.StartInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $launcher + '"'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        $process.StartInfo.EnvironmentVariables['PATH'] = $trapDirectory + ';' + $env:PATH
        $process.StartInfo.EnvironmentVariables['BOS_DB_DIAGNOSTIC_DOCKER_TRAP'] = $trapMarker
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(90000)) { $process.Kill(); throw 'Fixture timed out' }
        return @{ Code = $process.ExitCode; Out = $stdout.Result; Err = $stderr.Result }
    } finally { $process.Dispose() }
}
function Assert-Ok($result, [string]$name) {
    if ($result.Code -ne 7 -or $result.Out.Trim() -ne 'DB_DIAGNOSTIC_OFFLINE_LAUNCHER_OK' -or $result.Err.Trim()) {
        throw ($name + ': ' + $result.Code + ' ' + $result.Out + ' ' + $result.Err)
    }
    if (Test-Path -LiteralPath $trapMarker) { throw 'Launcher called Docker outside the diagnostic child' }
    Write-Output ($name + ': PASS')
}
function Assert-Blocked($result, [string]$code) {
    if ($result.Code -ne 1 -or $result.Out -notmatch $code -or $result.Out -match 'DB_DIAGNOSTIC_OFFLINE_LAUNCHER_OK') {
        throw ($code + ' was not blocked: ' + $result.Out + ' ' + $result.Err)
    }
    if (Test-Path -LiteralPath $trapMarker) { throw 'Blocked launcher still called Docker' }
    Write-Output ($code + ': PASS')
}
Assert-Ok (Invoke-Fixture) 'Offline Python stays beside spaced package'
Assert-Ok (Invoke-Fixture) 'Verified runtime reuse'
$stream = [IO.File]::Open($package, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try { $stream.WriteByte(65) } finally { $stream.Dispose() }
Assert-Blocked (Invoke-Fixture) 'DB_DIAGNOSTIC_PACKAGE_HASH_MISMATCH'
$stream = [IO.File]::Open($package, [IO.FileMode]::Open, [IO.FileAccess]::Write)
try { $stream.SetLength($stream.Length - 1) } finally { $stream.Dispose() }
Remove-Item -LiteralPath $report
Assert-Blocked (Invoke-Fixture) 'APP_RESTORE_REPORT_MISSING'
[IO.File]::WriteAllText($report, '{}')
$runtime = Join-Path $root 'python-3.12.10-amd64'
$extra = Join-Path $runtime 'foreign.py'
[IO.File]::WriteAllText($extra, '# fixture')
Assert-Blocked (Invoke-Fixture) 'PYTHON_RUNTIME_CONTENTS_INVALID'
Remove-Item -LiteralPath $extra
$archivePath = Join-Path $root $archiveName
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try { $stream.WriteByte(65) } finally { $stream.Dispose() }
Assert-Blocked (Invoke-Fixture) 'BUNDLED_PYTHON_HASH_MISMATCH'
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Open, [IO.FileAccess]::Write)
try { $stream.SetLength($stream.Length - 1) } finally { $stream.Dispose() }
Remove-Item -LiteralPath (Join-Path $root $archiveName)
Assert-Blocked (Invoke-Fixture) 'BUNDLED_PYTHON_MISSING'

# Import and execute the actual collector under portable Windows Python. With
# no failed-app report it must stop before ever calling the real Docker trap.
[IO.File]::Copy($env:BOS_APP_PYTHON_ZIP, $archivePath)
[IO.File]::Copy((Join-Path $PSScriptRoot 'check-db.ps1'), $launcher, $true)
[IO.File]::Copy((Join-Path $PSScriptRoot 'bos-db-check.pyz'), $package, $true)
$fixtureCode = @'
import json
from pathlib import Path
import sys
sys.path.insert(0, sys.argv[1])
from test_app_diagnostic import make_bundle
make_bundle(sys.argv[2])
report = Path(sys.argv[2]) / 'restore-report.json'
data = json.loads(report.read_text())
data.update(run_id='bos-drill-0123456789ab', volume='bos-drill-0123456789ab-data')
report.write_text(json.dumps(data))
'@
& python -c $fixtureCode $PSScriptRoot $root
if ($LASTEXITCODE -ne 0) { throw 'Synthetic collector bundle creation failed' }
$inputs = @{}
foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $root 'BOS-Backup') -File) + @(Get-Item -LiteralPath $report)) {
    $inputs[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
}
Assert-Blocked (Invoke-Fixture) 'DB_DIAGNOSTIC_FAILED_REPORT_NOT_FOUND'
foreach ($path in $inputs.Keys) {
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $inputs[$path]) {
        throw 'Collector modified an input before finding a failed report'
    }
}
Write-Output 'DB diagnostic launcher: 8 real process cases passed.'
