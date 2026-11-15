# Windows PowerShell 5.1 / PowerShell 7 launcher. No machine-wide installation.
# The runtime ZIP was fetched from python.org and hashed on 2026-11-15.
[CmdletBinding()]
param(
    [string]$BundlePath = (Get-Location).Path,
    [switch]$UsePortablePython
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PackageSha256 = 'a38f863e6576e20957bd88022603d6f78f887b5878534b39ffbaaaf2532f0194'
$PythonUrl = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
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

function Find-Python {
    foreach ($name in @('py.exe', 'python.exe', 'python3.exe')) {
        $commands = @(Get-Command $name -CommandType Application -ErrorAction SilentlyContinue)
        foreach ($command in $commands) {
            # Windows Store execution aliases may open a UI; never invoke them.
            if ($command.Source -match '(?i)[\\/]WindowsApps[\\/]') { continue }
            $prefix = @()
            if ($name -eq 'py.exe') { $prefix = @('-3') }
            if (Test-Python $command.Source $prefix) {
                return @{ Executable = $command.Source; Prefix = $prefix }
            }
        }
    }
    return $null
}

function Get-PortablePython {
    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
    if ($architecture -ne 'AMD64') { Stop-Bos 'PORTABLE_PYTHON_REQUIRES_AMD64' }
    $profileRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    Assert-NoReparse $profileRoot
    $toolsRoot = Join-Path $profileRoot 'BOS-Tools'
    if (-not (Test-Path -LiteralPath $toolsRoot)) {
        $null = New-Item -ItemType Directory -Path $toolsRoot
    }
    Assert-NoReparse $toolsRoot
    $archivePath = Join-Path $toolsRoot 'python-3.12.10-embed-amd64.zip'
    if (-not (Test-Path -LiteralPath $archivePath)) {
        $downloadPath = Join-Path $toolsRoot ('python-' + [Guid]::NewGuid().ToString('N') + '.partial')
        $bundledArchive = Join-Path $PSScriptRoot 'python-3.12.10-embed-amd64.zip'
        if (Test-Path -LiteralPath $bundledArchive) {
            Assert-NoReparse $bundledArchive
            if ((Get-Item -LiteralPath $bundledArchive).Length -ne $PythonBytes -or
                (Get-FileHash -LiteralPath $bundledArchive -Algorithm SHA256).Hash -ne $PythonSha256) {
                Stop-Bos 'BUNDLED_PYTHON_HASH_MISMATCH'
            }
            [IO.File]::Copy($bundledArchive, $downloadPath, $false)
        } else {
            $oldProtocol = [Net.ServicePointManager]::SecurityProtocol
            try {
                [Net.ServicePointManager]::SecurityProtocol = $oldProtocol -bor [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -UseBasicParsing -Uri $PythonUrl -OutFile $downloadPath -TimeoutSec 120
            } finally { [Net.ServicePointManager]::SecurityProtocol = $oldProtocol }
        }
        Assert-NoReparse $downloadPath
        if ((Get-Item -LiteralPath $downloadPath).Length -ne $PythonBytes -or
            (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash -ne $PythonSha256) {
            Stop-Bos 'PYTHON_DOWNLOAD_HASH_MISMATCH'
        }
        # No overwrite: a concurrent first run cannot silently replace a cache.
        [IO.File]::Move($downloadPath, $archivePath)
    }
    Assert-NoReparse $archivePath
    if ((Get-Item -LiteralPath $archivePath).Length -ne $PythonBytes -or
        (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $PythonSha256) {
        Stop-Bos 'PYTHON_CACHE_HASH_MISMATCH'
    }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $runtimePath = Join-Path $toolsRoot 'python-3.12.10-amd64'
        if (-not (Test-Path -LiteralPath $runtimePath)) {
            $stagingPath = Join-Path $toolsRoot ('runtime-' + [Guid]::NewGuid().ToString('N') + '.partial')
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
    $packagePath = Join-Path $PSScriptRoot 'bos-restore.pyz'
    Assert-NoReparse $packagePath
    if ($PackageSha256 -notmatch '^[0-9a-f]{64}$' -or
        (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $PackageSha256) {
        Stop-Bos 'RESTORE_PACKAGE_HASH_MISMATCH'
    }
    $resolvedBundle = (Resolve-Path -LiteralPath $BundlePath).ProviderPath
    Assert-NoReparse $resolvedBundle
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedBundle 'manifest.json') -PathType Leaf)) {
        Stop-Bos 'BUNDLE_MANIFEST_MISSING'
    }
    $python = $null
    if (-not $UsePortablePython) { $python = Find-Python }
    if ($null -eq $python) { $python = Get-PortablePython }
    $pythonArguments = @($python.Prefix) + @('-I', $packagePath, '--bundle', $resolvedBundle)
    & $python.Executable @pythonArguments
    exit $LASTEXITCODE
} catch {
    $code = $_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z0-9_]{3,80}$') { $code = 'RESTORE_LAUNCH_FAILED' }
    Write-Output ('{"restore":"STOPPED","reason":"' + $code + '","disaster_recovery_ready":false}')
    exit 1
}
