#!/usr/bin/env pwsh
# build.ps1 - Builds all release artifacts for the current platform.
#
# Flags:
#   -AppOnly        build only base + plugins, skip installer
#   -InstallerOnly  build only the installer
#   -NoUpx          skip UPX even if installed
#   -NoArchive      produce binaries but skip archive creation

param(
    [switch]$AppOnly,
    [switch]$InstallerOnly,
    [switch]$NoUpx,
    [switch]$NoArchive,
    [string]$Version = ''   # e.g. "v1.2.3" — injected into main.AppVersion at link time
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Step($msg) { Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "     OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "     !!  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "`n  !! $msg" -ForegroundColor Red; exit 1 }

# -- Platform ------------------------------------------------------------------
$goOs   = (go env GOOS  ).Trim()
$goArch = (go env GOARCH).Trim()

if ($goOs -eq 'windows') {
    $binExt       = '.exe'
    $archExt      = '.zip'
    $installerDir = 'windows'
    $installerSfx = '-windows'
} elseif ($goOs -eq 'darwin') {
    $binExt       = ''
    $archExt      = '.zip'
    $installerDir = 'macos'
    $installerSfx = '-darwin'
} else {
    $binExt       = ''
    $archExt      = '.tar.gz'
    $installerDir = 'linux'
    $installerSfx = '-linux'
}

$binDir = Join-Path (Join-Path (Join-Path $root 'app') 'build') 'bin'
New-Item -Force -ItemType Directory $binDir | Out-Null

# -- Optional tool detection ---------------------------------------------------
$hasUpx = $null -ne (Get-Command upx -ErrorAction SilentlyContinue)
$useUpx = $hasUpx -and -not $NoUpx -and ($goOs -ne 'darwin')

Write-Host ''
Write-Host "  Platform     : $goOs / $goArch" -ForegroundColor DarkGray
Write-Host "  UPX packing  : $(if ($useUpx) { 'enabled' } elseif ($goOs -eq 'darwin') { 'skipped (macOS codesign)' } else { 'upx not found' })" -ForegroundColor DarkGray
Write-Host ''

# -- Build flag arrays ---------------------------------------------------------
$baseTags  = if ($goOs -eq 'linux') { @('webkit2_41') } else { @() }
$appTagStr = $baseTags -join ','

# Inject the release version string at link time so /version shows the real tag.
$versionFlag = if ($Version) { "-s -w -X 'main.AppVersion=$Version'" } else { '-s -w' }

$coreFlags = @('build', '-trimpath', '-ldflags', $versionFlag)
if ($useUpx) { $coreFlags += '-upx' }

$appFlags    = if ($appTagStr) { $coreFlags + @('-tags', $appTagStr) } else { $coreFlags }
$pluginFlags = $appFlags

$instFlags = @('build', '-trimpath', '-ldflags', '-s -w')
if ($appTagStr) { $instFlags += @('-tags', $appTagStr) }

# -- Artifact names ------------------------------------------------------------
$baseName         = "cmdIDE-$goOs-$goArch$binExt"
$pluginsName      = "cmdIDE-plugins-$goOs-$goArch$binExt"
$installerName    = "cmdIDE-installer$installerSfx$binExt"

$baseArchive      = "cmdIDE-$goOs-$goArch$archExt"
$pluginsArchive   = "cmdIDE-plugins-$goOs-$goArch$archExt"
$installerArchive = "cmdIDE-installer$installerSfx$archExt"

$appDir  = Join-Path $root 'app'
$instDir = Join-Path (Join-Path $root 'installer') $installerDir

# -- Helpers -------------------------------------------------------------------

# Wait up to $timeoutSec seconds for a file to be deletable, then remove it.
# Returns $true if gone, $false if still present after timeout.
function Remove-WithRetry {
    param([string]$path, [int]$timeoutSec = 45)
    if (-not (Test-Path $path)) { return $true }
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $path)) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# Wait up to $timeoutSec seconds for a rename to succeed (source may be briefly
# locked by Defender or OneDrive right after Wails writes it).
function Rename-WithRetry {
    param([string]$src, [string]$dest, [int]$timeoutSec = 45)
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            Rename-Item $src $dest -ErrorAction Stop
            return $true
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

# Pre-clean: remove a named binary so the build can write fresh output.
# Fails hard if the file cannot be removed within the timeout.
function Clear-OldBinary {
    param([string]$name)
    $path = Join-Path $binDir $name
    if (-not (Test-Path $path)) { return }
    Write-Host "     --  clearing old $name ..." -ForegroundColor DarkGray
    if (-not (Remove-WithRetry $path)) {
        Fail "Cannot delete $name - file is locked. Close any program using it and retry."
    }
}

function Stage-Output {
    param([string]$destName)
    $srcBin = Join-Path $binDir "cmdIDE$binExt"
    $srcApp = Join-Path $binDir 'cmdIDE.app'
    $dest   = Join-Path $binDir $destName

    if ($goOs -eq 'darwin' -and (Test-Path $srcApp)) {
        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
        Rename-Item $srcApp $dest
    } elseif (Test-Path $srcBin) {
        if ($srcBin -ne $dest) {
            # Dest was pre-deleted before the build; if it somehow reappeared, remove it.
            if (Test-Path $dest) {
                if (-not (Remove-WithRetry $dest)) {
                    Fail "Cannot remove $destName before rename - still locked."
                }
            }
            # Rename with retry (Defender / OneDrive may hold srcBin briefly).
            if (-not (Rename-WithRetry $srcBin $dest)) {
                Fail "Cannot rename cmdIDE$binExt -> $destName after 45s. File is locked."
            }
        }
    } else {
        Fail "Wails output not found in $binDir"
    }
}

function New-Archive {
    param([string]$srcPath, [string]$archiveName)
    if ($NoArchive) { return }
    $archivePath = Join-Path $binDir $archiveName
    if ($archExt -eq '.tar.gz') {
        $leaf = Split-Path $srcPath -Leaf
        Push-Location $binDir
        & tar -czf $archiveName $leaf
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Fail "tar failed for $archiveName" }
    } else {
        if (Test-Path $archivePath) { Remove-Item -Force $archivePath }
        Compress-Archive -Path $srcPath -DestinationPath $archivePath
    }
    Ok "Archived  -> app/build/bin/$archiveName"
}

function Invoke-Wails {
    param([string]$dir, [string[]]$flags, [hashtable]$envVars = @{}, [string]$label = 'Build')
    Push-Location $dir
    foreach ($k in $envVars.Keys) { Set-Item "env:$k" $envVars[$k] }
    & wails @flags 2>&1 | ForEach-Object { Write-Host $_ }
    $code = $LASTEXITCODE
    foreach ($k in $envVars.Keys) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
    Pop-Location
    if ($code -ne 0) { Write-Host ''; Fail "$label failed (exit code $code)." }
}

# -- Pre-clean old app binaries ------------------------------------------------
# Delete existing named binaries BEFORE building so no stale files survive.
# This also ensures any OneDrive/Defender locks have cleared before we start.
if (-not $InstallerOnly) {
    Step "Pre-clean  old app binaries"
    Clear-OldBinary $baseName
    Clear-OldBinary $pluginsName
    # Also remove any leftover unnamed Wails output from a previous partial run.
    Clear-OldBinary "cmdIDE$binExt"
    Ok "Ready     -> app/build/bin/ is clean"
}

# -- 1/3  Base app -------------------------------------------------------------
if (-not $InstallerOnly) {
    Step "1/3  Base app ($goOs/$goArch)"
    Invoke-Wails $appDir $appFlags @{ VITE_PLUGINS = '' } 'Base app'
    Stage-Output $baseName
    New-Archive  (Join-Path $binDir $baseName) $baseArchive
    Ok "Binary    -> app/build/bin/$baseName"

# -- 2/3  Plugins app ----------------------------------------------------------
    Step "2/3  Plugins app ($goOs/$goArch)"
    Invoke-Wails $appDir $pluginFlags @{ VITE_PLUGINS = 'true' } 'Plugins app'
    Stage-Output $pluginsName
    New-Archive  (Join-Path $binDir $pluginsName) $pluginsArchive
    Ok "Binary    -> app/build/bin/$pluginsName"
}

if ($AppOnly) {
    Write-Host ''
    Write-Host '  Done.' -ForegroundColor Green
    Write-Host ''
    exit 0
}

# -- 3/3  Installer ------------------------------------------------------------
Step "3/3  Installer ($installerDir)"

if (-not (Test-Path $instDir)) { Fail "Installer directory not found: $instDir" }

Push-Location $instDir
if (-not (Test-Path 'go.sum')) {
    go mod tidy
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'go mod tidy failed for installer.' }
}
& wails @instFlags 2>&1 | ForEach-Object { Write-Host $_ }
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Write-Host ''; Fail "Installer build failed (exit code $code)." }

$instBinDir = Join-Path (Join-Path $instDir 'build') 'bin'
$instBin    = Join-Path $instBinDir "cmdIDE-installer$binExt"
$instApp    = Join-Path $instBinDir 'cmdIDE-installer.app'
$instDest   = Join-Path $binDir $installerName

if ($goOs -eq 'darwin' -and (Test-Path $instApp)) {
    if (Test-Path $instDest) { Remove-Item -Recurse -Force $instDest }
    Copy-Item -Recurse $instApp $instDest
} elseif (Test-Path $instBin) {
    if (Test-Path $instDest) {
        if (-not (Remove-WithRetry $instDest)) {
            Fail "Cannot remove old $installerName - file is locked."
        }
    }
    Copy-Item -Force $instBin $instDest
} else {
    Fail "Installer binary not found in $instBinDir"
}

New-Archive (Join-Path $binDir $installerName) $installerArchive
Ok "Binary    -> app/build/bin/$installerName"

Write-Host ''
Write-Host '  Build complete.' -ForegroundColor Green
Write-Host ''
