# Real PowerShell 5.1 processes; pinned Python ZIP supplied by CI.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows required' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path ([IO.Path]::GetTempPath()) ('bos app ' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$archiveName = 'python-3.12.10-embed-amd64.zip'
[IO.File]::Copy($env:BOS_APP_PYTHON_ZIP, (Join-Path $root $archiveName))
$report = Join-Path $root 'restore-report.json'
[IO.File]::WriteAllText($report, '{"fixture":true}')
$package = Join-Path $root 'bos-app.pyz'
$zip = [IO.Compression.ZipFile]::Open($package, [IO.Compression.ZipArchiveMode]::Create)
try {
    $entry = $zip.CreateEntry('__main__.py')
    $stream = $entry.Open()
    $code = @'
import sys
from pathlib import Path
assert sys.flags.isolated
assert sys.argv[1] == '--report'
assert Path(sys.argv[2]).name == 'restore-report.json'
assert sys.argv[3] == '--work-dir'
assert Path(sys.argv[4]) == Path(sys.argv[0]).parent
assert Path(sys.executable).parent.parent == Path(sys.argv[0]).parent
assert 'bos app ' in sys.argv[0]
print('APP_OFFLINE_LAUNCHER_OK')
raise SystemExit(7)
'@
    $data = [Text.Encoding]::UTF8.GetBytes($code)
    try { $stream.Write($data, 0, $data.Length) } finally { $stream.Dispose() }
} finally { $zip.Dispose() }
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'app.ps1'))
$source = [regex]::Replace($source, "(?m)^\`$PackageSha256 = '[^']+'", ('$PackageSha256 = ' + "'" + $hash + "'"))
$launcher = Join-Path $root 'app.ps1'
[IO.File]::WriteAllText($launcher, $source, (New-Object Text.UTF8Encoding($false)))

function Invoke-Fixture {
    $process = New-Object Diagnostics.Process
    try {
        $process.StartInfo.FileName = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $process.StartInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $launcher + '"'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(90000)) { $process.Kill(); throw 'Fixture timed out' }
        return @{ Code = $process.ExitCode; Out = $stdout.Result; Err = $stderr.Result }
    } finally { $process.Dispose() }
}
function Assert-Ok($result, [string]$name) {
    if ($result.Code -ne 7 -or $result.Out.Trim() -ne 'APP_OFFLINE_LAUNCHER_OK' -or $result.Err.Trim()) {
        throw ($name + ': ' + $result.Code + ' ' + $result.Out + ' ' + $result.Err)
    }
    Write-Output ($name + ': PASS')
}
function Assert-Blocked($result, [string]$code) {
    if ($result.Code -ne 1 -or $result.Out -notmatch $code -or $result.Out -match 'APP_OFFLINE_LAUNCHER_OK') {
        throw ($code + ' was not blocked: ' + $result.Out + ' ' + $result.Err)
    }
    Write-Output ($code + ': PASS')
}
Assert-Ok (Invoke-Fixture) 'Offline Python stays beside spaced package'
Assert-Ok (Invoke-Fixture) 'Verified runtime reuse'
$stream = [IO.File]::Open($package, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try { $stream.WriteByte(65) } finally { $stream.Dispose() }
Assert-Blocked (Invoke-Fixture) 'APP_PACKAGE_HASH_MISMATCH'
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
Remove-Item -LiteralPath (Join-Path $root $archiveName)
Assert-Blocked (Invoke-Fixture) 'BUNDLED_PYTHON_MISSING'
Write-Output 'App launcher: 6 process cases passed.'
