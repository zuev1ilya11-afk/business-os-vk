# Offline Windows launcher. All new files stay beside this package (extract to E:).
[CmdletBinding()]
param(
    [string]$BundlePath = '',
    [string]$ReportPath = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PackageSha256 = 'bee96ec4258f375628c6c67ab09bceed12cb1942fa8b35f2c55a05c60c766935'
$PythonSha256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
$PythonBytes = 11133606
function Stop-Bos([string]$Code) { throw [InvalidOperationException]::new($Code) }
function Assert-NoReparse([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    while ($null -ne $item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Stop-Bos 'LOCAL_PATH_REPARSE_POINT'
        }
        if ($item -is [IO.FileInfo]) { $item = $item.Directory }
        else { $item = $item.Parent }
    }
}

function Test-Python([string]$Executable, [string[]]$Prefix) {
    $process = New-Object Diagnostics.Process
    try {
        $process.StartInfo.FileName = $Executable
        # These arguments are constants; no path or user text is interpolated.
        $probe = 'import sys;print("BOS_PYTHON_OK" if (3,12)<=sys.version_info[:2]<(4,0) and sys.maxsize>2**32 else "NO")'
        $escaped = $probe.Replace('"', '\"')
        $process.StartInfo.Arguments = ($Prefix -join ' ') + ' -I -c "' + $escaped + '"'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        $process.StartInfo.EnvironmentVariables.Remove('PYLAUNCHER_ALLOW_INSTALL')
        $process.StartInfo.EnvironmentVariables['PYTHON_MANAGER_AUTOMATIC_INSTALL'] = 'false'
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(8000)) {
            $process.Kill()
            $null = $process.WaitForExit(2000)
            return $false
        }
        return ($process.ExitCode -eq 0 -and $stdout.Result.Trim() -eq 'BOS_PYTHON_OK')
    } catch { return $false }
    finally { $process.Dispose() }
}

function Get-PortablePython {
    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
    if ($architecture -ne 'AMD64') { Stop-Bos 'PORTABLE_PYTHON_REQUIRES_AMD64' }
    $archivePath = Join-Path $PSScriptRoot 'python-3.12.10-embed-amd64.zip'
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        Stop-Bos 'BUNDLED_PYTHON_MISSING'
    }
    Assert-NoReparse $archivePath
    if ((Get-Item -LiteralPath $archivePath).Length -ne $PythonBytes -or
        (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $PythonSha256) {
        Stop-Bos 'BUNDLED_PYTHON_HASH_MISMATCH'
    }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $runtimePath = Join-Path $PSScriptRoot 'python-3.12.10-amd64'
        if (-not (Test-Path -LiteralPath $runtimePath)) {
            $stagingPath = Join-Path $PSScriptRoot ('runtime-' + [Guid]::NewGuid().ToString('N') + '.partial')
            $null = New-Item -ItemType Directory -Path $stagingPath
            foreach ($entry in $archive.Entries) {
                # This pinned CPython ZIP contains exactly 35 flat regular files.
                if ($entry.FullName -ne $entry.Name -or $entry.Name -match '[:\\/]' -or
                    $entry.Name -in @('', '.', '..')) { Stop-Bos 'PYTHON_ARCHIVE_PATH_INVALID' }
                $destination = Join-Path $stagingPath $entry.Name
                $archiveInput = $entry.Open()
                $archiveOutput = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
                try { $archiveInput.CopyTo($archiveOutput) }
                finally { $archiveOutput.Dispose(); $archiveInput.Dispose() }
            }
            [IO.Directory]::Move($stagingPath, $runtimePath)
        }
        Assert-NoReparse $runtimePath
        $files = @(Get-ChildItem -LiteralPath $runtimePath -Force)
        if ($files.Count -ne $archive.Entries.Count) { Stop-Bos 'PYTHON_RUNTIME_CONTENTS_INVALID' }
        foreach ($entry in $archive.Entries) {
            $path = Join-Path $runtimePath $entry.Name
            Assert-NoReparse $path
            $item = Get-Item -LiteralPath $path
            if ($item.PSIsContainer -or $item.Length -ne $entry.Length) { Stop-Bos 'PYTHON_RUNTIME_CONTENTS_INVALID' }
            $stream = $entry.Open()
            $algorithm = [Security.Cryptography.SHA256]::Create()
            try { $expected = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '') }
            finally { $algorithm.Dispose(); $stream.Dispose() }
            if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $expected) {
                Stop-Bos 'PYTHON_RUNTIME_HASH_MISMATCH'
            }
        }
    } finally { $archive.Dispose() }
    $executable = Join-Path $runtimePath 'python.exe'
    if (-not (Test-Python $executable @())) { Stop-Bos 'PORTABLE_PYTHON_FAILED' }
    return @{ Executable = $executable; Prefix = @() }
}

try {
    if ($env:OS -ne 'Windows_NT') { Stop-Bos 'WINDOWS_LAUNCHER_REQUIRED' }
    Assert-NoReparse $PSScriptRoot
    $drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($PSScriptRoot))
    if ($drive.AvailableFreeSpace -lt 512MB) { Stop-Bos 'APP_HOST_DISK_SPACE_LOW' }
    $packagePath = Join-Path $PSScriptRoot 'bos-app.pyz'
    Assert-NoReparse $packagePath
    if ($PackageSha256 -notmatch '^[0-9a-f]{64}$' -or
        (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $PackageSha256) {
        Stop-Bos 'APP_PACKAGE_HASH_MISMATCH'
    }
    if (-not $ReportPath) { $ReportPath = Join-Path $PSScriptRoot 'restore-report.json' }
    if (-not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) { Stop-Bos 'APP_RESTORE_REPORT_MISSING' }
    $resolvedReport = (Resolve-Path -LiteralPath $ReportPath).ProviderPath
    Assert-NoReparse $resolvedReport
    $python = Get-PortablePython
    $pythonArguments = @('-I', $packagePath, '--report', $resolvedReport, '--work-dir', $PSScriptRoot)
    if ($BundlePath) {
        $resolvedBundle = (Resolve-Path -LiteralPath $BundlePath).ProviderPath
        Assert-NoReparse $resolvedBundle
        $pythonArguments += @('--bundle', $resolvedBundle)
    }
    & $python.Executable @pythonArguments
    exit $LASTEXITCODE
} catch {
    $code = $_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z0-9_]{3,80}$') { $code = 'APP_LAUNCH_FAILED' }
    Write-Output ('{"application":"STOPPED","reason":"' + $code + '","disaster_recovery_ready":false}')
    exit 1
}
