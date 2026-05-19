#!/usr/bin/env pwsh
# build.ps1 — Builds all release artifacts for the current platform.
#
# GitHub Actions (release.yml) calls this on each of three native runners so
# that the total nine artifacts are produced without cross-compilation:
#
#   Windows runner  →  cmdIDE-windows-amd64.zip
#                      cmdIDE-plugins-windows-amd64.zip
#                      cmdIDE-installer-windows.zip
#
#   macOS runner    →  cmdIDE-darwin-arm64.zip
#                      cmdIDE-plugins-darwin-arm64.zip
#                      cmdIDE-installer-darwin.zip
#
#   Linux runner    →  cmdIDE-linux-amd64.tar.gz
#                      cmdIDE-plugins-linux-amd64.tar.gz
#                      cmdIDE-installer-linux.tar.gz
#
# Every binary is built with:
#   -trimpath          removes all host file-system paths (privacy + reproducibility)
#   -ldflags "-s -w"   strips symbol table and DWARF debug info (smaller + harder to reverse)
#   -obfuscated        garble code obfuscation, if garble is in PATH
#   -upx               UPX binary packing,      if upx is in PATH (skipped on macOS)
#
# Install optional tools:
#   garble   go install mvdan.cc/garble@latest
#   upx      https://upx.github.io  (or: apt install upx / brew install upx)
#
# Flags:
#   -AppOnly       build only the app variants, skip installer
#   -InstallerOnly build only the installer (app binaries must already exist)
#   -NoObfuscate   skip garble even if installed
#   -NoUpx         skip UPX even if installed
#   -NoArchive     produce binaries but skip archive creation

param(
    [switch]$AppOnly,
    [switch]$InstallerOnly,
    [switch]$NoObfuscate,
    [switch]$NoUpx,
    [switch]$NoArchive
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Step($msg) { Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "     OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "     !!  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "`n  !! $msg" -ForegroundColor Red; exit 1 }

# ── Platform ──────────────────────────────────────────────────────────────────
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

# ── Optional tool detection ───────────────────────────────────────────────────
$hasGarble    = $null -ne (Get-Command garble -ErrorAction SilentlyContinue)
$hasUpx       = $null -ne (Get-Command upx    -ErrorAction SilentlyContinue)
$useObfuscate = $hasGarble -and -not $NoObfuscate
$useUpx       = $hasUpx    -and -not $NoUpx -and ($goOs -ne 'darwin')  # UPX breaks macOS codesign

Write-Host ''
Write-Host "  Platform     : $goOs / $goArch" -ForegroundColor DarkGray
Write-Host "  Obfuscation  : $(if ($useObfuscate) { 'garble (enabled)' } else { '-s -w strip only' })" -ForegroundColor DarkGray
Write-Host "  UPX packing  : $(if ($useUpx) { 'enabled' } elseif ($goOs -eq 'darwin') { 'skipped (macOS codesign)' } else { 'upx not found' })" -ForegroundColor DarkGray
Write-Host ''

# ── Build flag arrays ─────────────────────────────────────────────────────────
# Base flags applied to every wails build call
$appFlags = @('build', '-trimpath', '-ldflags', '-s -w')
if ($useObfuscate) { $appFlags += '-obfuscated' }
if ($useUpx)       { $appFlags += '-upx' }

# Installer gets the same stripping/obfuscation but no UPX (it's already small)
$instFlags = @('build', '-trimpath', '-ldflags', '-s -w')
if ($useObfuscate) { $instFlags += '-obfuscated' }

# ── Helpers ───────────────────────────────────────────────────────────────────

# Move the wails output (cmdIDE[.exe] or cmdIDE.app) to a deterministic name.
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
            if (Test-Path $dest) { Remove-Item -Force $dest }
            Move-Item $srcBin $dest
        }
    } else {
        Fail "Wails output not found in $binDir"
    }
}

# Compress an artifact into a distribution archive.
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
    Ok "Archived  → app/build/bin/$archiveName"
}

# Run wails in a given directory; calls Fail on non-zero exit.
function Invoke-Wails {
    param([string]$dir, [string[]]$flags, [hashtable]$envVars = @{}, [string]$label = 'Build')
    Push-Location $dir
    foreach ($k in $envVars.Keys) { Set-Item "env:$k" $envVars[$k] }
    & wails @flags 2>&1 | ForEach-Object { Write-Host $_ }
    $code = $LASTEXITCODE
    foreach ($k in $envVars.Keys) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
    Pop-Location
    if ($code -ne 0) {
        Write-Host ''
        Fail "$label failed (exit code $code)."
    }
}

# ── Artifact names ────────────────────────────────────────────────────────────
$baseName         = "cmdIDE-$goOs-$goArch$binExt"
$pluginsName      = "cmdIDE-plugins-$goOs-$goArch$binExt"
$installerName    = "cmdIDE-installer$installerSfx$binExt"

$baseArchive      = "cmdIDE-$goOs-$goArch$archExt"
$pluginsArchive   = "cmdIDE-plugins-$goOs-$goArch$archExt"
$installerArchive = "cmdIDE-installer$installerSfx$archExt"

$appDir  = Join-Path $root 'app'
$instDir = Join-Path (Join-Path $root 'installer') $installerDir

# ─────────────────────────────────────────────────────────────────────────────
# 1 · Base app  (no plugins)
# ─────────────────────────────────────────────────────────────────────────────
if (-not $InstallerOnly) {
    Step "1/3  Base app ($goOs/$goArch)"

    Invoke-Wails $appDir $appFlags @{ VITE_PLUGINS = '' } 'Base app'

    Stage-Output $baseName
    New-Archive  (Join-Path $binDir $baseName) $baseArchive
    Ok "Binary    → app/build/bin/$baseName"

# ─────────────────────────────────────────────────────────────────────────────
# 2 · Plugins app
# ─────────────────────────────────────────────────────────────────────────────
    Step "2/3  Plugins app ($goOs/$goArch)"

    $pluginFlags = $appFlags + @('-tags', 'plugins')
    Invoke-Wails $appDir $pluginFlags @{ VITE_PLUGINS = 'true' } 'Plugins app'

    Stage-Output $pluginsName
    New-Archive  (Join-Path $binDir $pluginsName) $pluginsArchive
    Ok "Binary    → app/build/bin/$pluginsName"
}

if ($AppOnly) {
    Write-Host ''
    Write-Host '  Done (app only).' -ForegroundColor Green
    Write-Host ''
    exit 0
}

# ─────────────────────────────────────────────────────────────────────────────
# 3 · Installer
# ─────────────────────────────────────────────────────────────────────────────
Step "3/3  Installer ($installerDir)"

if (-not (Test-Path $instDir)) {
    Fail "Installer directory not found: $instDir"
}

Push-Location $instDir
if (-not (Test-Path 'go.sum')) {
    Write-Host '     (first run — fetching installer dependencies…)' -ForegroundColor DarkGray
    go mod tidy
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'go mod tidy failed for installer.' }
}
& wails @instFlags 2>&1 | ForEach-Object { Write-Host $_ }
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) {
    Write-Host ''
    Fail "Installer build failed (exit code $code)."
}

# Locate the wails output — outputfilename in installer/*/wails.json is "cmdIDE-installer"
$instBinDir = Join-Path (Join-Path $instDir 'build') 'bin'
$instBin    = Join-Path $instBinDir "cmdIDE-installer$binExt"
$instApp    = Join-Path $instBinDir 'cmdIDE-installer.app'
$instDest   = Join-Path $binDir $installerName

if ($goOs -eq 'darwin' -and (Test-Path $instApp)) {
    if (Test-Path $instDest) { Remove-Item -Recurse -Force $instDest }
    Copy-Item -Recurse $instApp $instDest
} elseif (Test-Path $instBin) {
    Copy-Item -Force $instBin $instDest
} else {
    Fail "Installer binary not found in $instBinDir"
}

New-Archive (Join-Path $binDir $installerName) $installerArchive
Ok "Binary    → app/build/bin/$installerName"

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ─────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host '  Build complete.' -ForegroundColor Green
Write-Host ''

if (-not $InstallerOnly) {
    Write-Host "    $baseArchive"    -ForegroundColor White
    Write-Host "    $pluginsArchive" -ForegroundColor White
}
Write-Host "    $installerArchive" -ForegroundColor White
Write-Host ''
