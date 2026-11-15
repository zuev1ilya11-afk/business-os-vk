# Execute the real diagnostic zipapp in pinned portable Python, without Docker.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows required' }
$root = Join-Path ([IO.Path]::GetTempPath()) ('bos diagnostic ' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
foreach ($name in @('check-app.ps1', 'bos-app-check.pyz')) {
    [IO.File]::Copy((Join-Path $PSScriptRoot $name), (Join-Path $root $name))
}
[IO.File]::Copy($env:BOS_APP_PYTHON_ZIP, (Join-Path $root 'python-3.12.10-embed-amd64.zip'))
$fixtureCode = @'
import sys
sys.path.insert(0, sys.argv[1])
from test_app_diagnostic import make_bundle
make_bundle(sys.argv[2])
'@
& python -c $fixtureCode $PSScriptRoot $root
if ($LASTEXITCODE -ne 0) { throw 'Synthetic diagnostic bundle creation failed' }

# Any accidental Docker subprocess has a real executable to reach and is detected.
$trapDirectory = Join-Path $root 'process-trap'
$null = New-Item -ItemType Directory -Path $trapDirectory
$trapMarker = Join-Path $root 'docker-was-called.txt'
$trapSource = @'
using System;
using System.IO;
public class DiagnosticDockerTrap {
    public static int Main() {
        File.WriteAllText(Environment.GetEnvironmentVariable("BOS_DIAGNOSTIC_DOCKER_TRAP"), "called");
        return 47;
    }
}
'@
Add-Type -TypeDefinition $trapSource -OutputAssembly (Join-Path $trapDirectory 'docker.exe') -OutputType ConsoleApplication
$launcher = Join-Path $root 'check-app.ps1'
$package = Join-Path $root 'bos-app-check.pyz'
$restoreReport = Join-Path $root 'restore-report.json'
$inputs = @{}
foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $root 'BOS-Backup') -File) + @(Get-Item -LiteralPath $restoreReport)) {
    $inputs[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
}

function Invoke-Diagnostic {
    $process = New-Object Diagnostics.Process
    try {
        $process.StartInfo.FileName = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $process.StartInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $launcher + '"'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        $process.StartInfo.EnvironmentVariables['PATH'] = $trapDirectory + ';' + $env:PATH
        $process.StartInfo.EnvironmentVariables['BOS_DIAGNOSTIC_DOCKER_TRAP'] = $trapMarker
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(90000)) { $process.Kill(); throw 'Diagnostic timed out' }
        return @{ Code = $process.ExitCode; Out = $stdout.Result; Err = $stderr.Result }
    } finally { $process.Dispose() }
}
function Assert-Unchanged {
    foreach ($path in $inputs.Keys) {
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $inputs[$path]) {
            throw 'Diagnostic changed an input file'
        }
    }
    if ((Get-ChildItem -LiteralPath (Join-Path $root 'BOS-Backup') -Force).Count -ne 7) {
        throw 'Diagnostic changed backup directory contents'
    }
    if (Test-Path -LiteralPath $trapMarker) { throw 'Diagnostic called Docker' }
}
function Assert-Diagnostic($result, [string]$name) {
    if ($result.Code -ne 0 -or $result.Err.Trim()) {
        throw ($name + ': ' + $result.Code + ' ' + $result.Out + ' ' + $result.Err)
    }
    $summary = $result.Out.Trim() | ConvertFrom-Json
    if ($summary.status -ne 'DIAGNOSTIC_COMPLETE' -or $summary.unsupported_routes -ne 2) {
        throw ('Unexpected diagnostic summary: ' + $result.Out)
    }
    if ([IO.Path]::GetDirectoryName($summary.report) -ne $root) { throw 'Diagnostic report outside package' }
    $text = [IO.File]::ReadAllText($summary.report)
    $report = $text | ConvertFrom-Json
    if ($report.routes.Count -ne 4 -or $report.docker_called -ne $false -or $report.backup_modified -ne $false) {
        throw 'Diagnostic scope or route aggregation incorrect'
    }
    if ($text -match 'PRIVATE_PRODUCTION_SECRET_NEVER_REUSED|https://production.invalid') {
        throw 'Diagnostic leaked a private value'
    }
    Assert-Unchanged
    Write-Output ($name + ': PASS')
}
function Assert-Blocked($result, [string]$code) {
    if ($result.Code -ne 1 -or $result.Out -notmatch $code -or $result.Out -match 'DIAGNOSTIC_COMPLETE') {
        throw ($code + ' was not blocked: ' + $result.Out + ' ' + $result.Err)
    }
    if (Test-Path -LiteralPath $trapMarker) { throw 'Diagnostic called Docker' }
    Write-Output ($code + ': PASS')
}

Assert-Diagnostic (Invoke-Diagnostic) 'Real diagnostic, private output and unchanged inputs'
Assert-Diagnostic (Invoke-Diagnostic) 'Verified portable runtime reuse'
if (@(Get-ChildItem -LiteralPath $root -Filter 'BOS-App-Diagnostic-*.json').Count -ne 2) {
    throw 'Diagnostic reports were overwritten'
}
$stream = [IO.File]::Open($package, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try { $stream.WriteByte(65) } finally { $stream.Dispose() }
Assert-Blocked (Invoke-Diagnostic) 'DIAGNOSTIC_PACKAGE_HASH_MISMATCH'
$stream = [IO.File]::Open($package, [IO.FileMode]::Open, [IO.FileAccess]::Write)
try { $stream.SetLength($stream.Length - 1) } finally { $stream.Dispose() }
Assert-Unchanged
Remove-Item -LiteralPath $restoreReport
Assert-Blocked (Invoke-Diagnostic) 'APP_RESTORE_REPORT_MISSING'
Write-Output 'Diagnostic launcher: 4 real process cases passed.'
