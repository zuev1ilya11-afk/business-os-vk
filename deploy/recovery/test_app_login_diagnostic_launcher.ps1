# Exercise the shipped offline login collector with real Windows processes.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows required' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path ([IO.Path]::GetTempPath()) ('bos login check ' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$archivePath = Join-Path $root 'python-3.12.10-embed-amd64.zip'
[IO.File]::Copy($env:BOS_APP_PYTHON_ZIP, $archivePath)
$package = Join-Path $root 'bos-login-check.pyz'
$launcher = Join-Path $root 'check-login.ps1'
[IO.File]::Copy((Join-Path $PSScriptRoot 'bos-login-check.pyz'), $package)
[IO.File]::Copy((Join-Path $PSScriptRoot 'check-login.ps1'), $launcher)
function Invoke-Check {
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
function Assert-Reason([string]$reason) {
    $result = Invoke-Check
    if ($result.Code -ne 1 -or $result.Out -notmatch $reason -or $result.Err.Trim()) {
        throw ($reason + ': ' + $result.Code + ' ' + $result.Out + ' ' + $result.Err)
    }
    Write-Output ($reason + ': PASS')
}
Assert-Reason 'LOGIN_APP_REPORT_NOT_FOUND'
Assert-Reason 'LOGIN_APP_REPORT_NOT_FOUND'
$reports = @(Get-ChildItem -LiteralPath $root -Filter 'BOS-Login-Diagnostic-*.json')
if ($reports.Count -ne 2) { throw 'Collector failed to save both reports beside package' }
$appReport = Join-Path $root 'BOS-App-20261115T120000Z-12345678.json'
[IO.File]::WriteAllText($appReport, '{"status":"STOPPED"}')
Assert-Reason 'LOGIN_APP_NOT_RUNNING'
$stream = [IO.File]::Open($package, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try { $stream.WriteByte(65) } finally { $stream.Dispose() }
Assert-Reason 'LOGIN_DIAGNOSTIC_PACKAGE_HASH_MISMATCH'
$stream = [IO.File]::Open($package, [IO.FileMode]::Open, [IO.FileAccess]::Write)
try { $stream.SetLength($stream.Length - 1) } finally { $stream.Dispose() }
$runtime = Join-Path $root 'python-3.12.10-amd64'
$extra = Join-Path $runtime 'foreign.py'
[IO.File]::WriteAllText($extra, '# fixture')
Assert-Reason 'PYTHON_RUNTIME_CONTENTS_INVALID'
Remove-Item -LiteralPath $extra
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try { $stream.WriteByte(65) } finally { $stream.Dispose() }
Assert-Reason 'BUNDLED_PYTHON_HASH_MISMATCH'
Remove-Item -LiteralPath $archivePath
Assert-Reason 'BUNDLED_PYTHON_MISSING'
Write-Output 'Login diagnostic: 7 real Windows process cases passed.'
