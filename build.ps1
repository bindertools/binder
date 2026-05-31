#!/usr/bin/env pwsh
# build.ps1 - Builds all C++ release artifacts for the current platform.
#
# Flags:
#   -AppOnly        build only cmdide-host, skip installer
#   -InstallerOnly  build only the installer
#   -NoArchive      produce binaries but skip archive creation
#   -DevInstaller   also build the dev-channel installer
#   -Version        inject version string (e.g. "v1.2.3")

param(
    [switch]$AppOnly,
    [switch]$InstallerOnly,
    [switch]$NoArchive,
    [switch]$DevInstaller,
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Step($msg) { Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "     OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "     !!  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "`n  !! $msg" -ForegroundColor Red; exit 1 }

# -- Platform detection (no Go dependency) -------------------------------------
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    $platform     = 'windows'
    $arch         = if ([System.Environment]::Is64BitOperatingSystem) { 'amd64' } else { 'x86' }
    $binExt       = '.exe'
    $archExt      = '.zip'
} elseif ($IsMacOS) {
    $platform     = 'darwin'
    $arch         = if ((uname -m) -eq 'arm64') { 'arm64' } else { 'amd64' }
    $binExt       = ''
    $archExt      = '.zip'
} else {
    $platform     = 'linux'
    $arch         = 'amd64'
    $binExt       = ''
    $archExt      = '.tar.gz'
}

Write-Host ''
Write-Host "  Platform     : $platform / $arch" -ForegroundColor DarkGray

# -- Locate vcpkg --------------------------------------------------------------
$vcpkgRoot = $env:VCPKG_ROOT
if (-not $vcpkgRoot) {
    foreach ($c in @('C:\vcpkg', 'C:\src\vcpkg', "$env:USERPROFILE\vcpkg",
                     '/usr/local/vcpkg', "$HOME/vcpkg")) {
        $f = Join-Path $c 'scripts/buildsystems/vcpkg.cmake'
        if (Test-Path $f) { $vcpkgRoot = $c; break }
    }
}
if (-not $vcpkgRoot) { Fail "vcpkg not found. Set VCPKG_ROOT or install vcpkg." }
$toolchain    = Join-Path $vcpkgRoot 'scripts/buildsystems/vcpkg.cmake'
$overlayPorts = Join-Path $root 'cpp/ports'
Write-Host "  vcpkg        : $vcpkgRoot" -ForegroundColor DarkGray

$cppDir   = Join-Path $root 'cpp'
$cppBuild = Join-Path $cppDir 'build'
$devBuild = Join-Path $cppDir 'build-dev'

# -- Helper: Compress-Archive wrapper ------------------------------------------
function New-Archive {
    param([string]$srcPath, [string]$archivePath)
    if ($NoArchive) { return }
    if (Test-Path $archivePath) { Remove-Item -Force $archivePath }
    if ($archExt -eq '.tar.gz') {
        $leaf = Split-Path $srcPath -Leaf
        Push-Location (Split-Path $srcPath -Parent)
        tar -czf $archivePath $leaf
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Fail "tar failed for $archivePath" }
    } else {
        Compress-Archive -Path $srcPath -DestinationPath $archivePath
    }
    Ok "Archived  -> $archivePath"
}

# -- Step 1: Build frontend (npm) ----------------------------------------------
if (-not $InstallerOnly) {
    Step "Frontend build (app/frontend)"
    Push-Location (Join-Path $root 'app/frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Frontend npm build failed" }
    Pop-Location
    Ok "Built     -> app/frontend/dist/"
}

if (-not $AppOnly) {
    Step "Frontend build (installer/windows/frontend)"
    Push-Location (Join-Path $root 'installer/windows/frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Installer frontend npm build failed" }
    Pop-Location
    Ok "Built     -> installer/windows/frontend/dist/"
}

# -- Step 2: CMake configure ---------------------------------------------------
Step "CMake configure"
$cmakeArgs = @(
    "-B", $cppBuild,
    "-S", $cppDir,
    "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
    "-DVCPKG_OVERLAY_PORTS=$overlayPorts"
)
if ($Version) { $cmakeArgs += "-DCMDIDE_VERSION=$Version" }

& cmake @cmakeArgs
if ($LASTEXITCODE -ne 0) { Fail "CMake configure failed" }
Ok "Configured -> $cppBuild"

# -- Step 3: Build targets -----------------------------------------------------
if (-not $InstallerOnly) {
    Step "Build cmdide-host"
    & cmake --build $cppBuild --config Release --target cmdide-host
    if ($LASTEXITCODE -ne 0) { Fail "cmdide-host build failed" }
    Ok "Built     -> cpp/build/Release/cmdide-host$binExt"
}

if (-not $AppOnly) {
    Step "Build cmdide-installer (stable)"
    & cmake --build $cppBuild --config Release --target cmdide-installer
    if ($LASTEXITCODE -ne 0) { Fail "cmdide-installer build failed" }
    Ok "Built     -> cpp/build/Release/cmdide-installer$binExt"
}

# -- Dev installer (separate configure with CMDIDE_INSTALLER_DEV=ON) ----------
if ($DevInstaller -and -not $AppOnly) {
    Step "Build cmdide-installer (dev channel)"
    $devArgs = @(
        "-B", $devBuild,
        "-S", $cppDir,
        "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
        "-DVCPKG_OVERLAY_PORTS=$overlayPorts",
        "-DCMDIDE_INSTALLER_DEV=ON"
    )
    & cmake @devArgs
    if ($LASTEXITCODE -ne 0) { Fail "CMake configure (dev) failed" }
    & cmake --build $devBuild --config Release --target cmdide-installer
    if ($LASTEXITCODE -ne 0) { Fail "Dev installer build failed" }

    # Rename dev installer to avoid collision
    $devExe     = Join-Path $devBuild "Release/cmdide-installer$binExt"
    $devDestDir = Join-Path $cppBuild "Release"
    $devDest    = Join-Path $devDestDir "cmdide-installer-dev$binExt"
    if (Test-Path $devExe) {
        Copy-Item -Force $devExe $devDest
        Ok "Built     -> cpp/build/Release/cmdide-installer-dev$binExt"
    } else {
        Warn "Dev installer exe not found after build"
    }
}

# -- Step 4: Windows packaging ------------------------------------------------
if ($platform -eq 'windows' -and -not $NoArchive) {
    Step "Windows packaging (zip archive)"
    $binDir  = Join-Path $cppBuild 'Release'
    $zipDest = Join-Path $binDir "cmdIDE-windows-$arch.zip"

    $filesToZip = @()
    $hostExe = Join-Path $binDir "cmdide-host$binExt"
    $instExe = Join-Path $binDir "cmdide-installer$binExt"
    $devExe  = Join-Path $binDir "cmdide-installer-dev$binExt"

    if (Test-Path $hostExe) { $filesToZip += $hostExe }
    if (Test-Path $instExe) { $filesToZip += $instExe }
    if (Test-Path $devExe)  { $filesToZip += $devExe }

    if ($filesToZip.Count -gt 0) {
        if (Test-Path $zipDest) { Remove-Item -Force $zipDest }
        Compress-Archive -Path $filesToZip -DestinationPath $zipDest
        Ok "Archived  -> cmdIDE-windows-$arch.zip"
    }
}

# -- Step 5: Verification ------------------------------------------------------
Step "Verifying artifacts"
$ok = $true
if (-not $InstallerOnly) {
    $hostExe = Join-Path $cppBuild "Release/cmdide-host$binExt"
    if (Test-Path $hostExe) { Ok "Found     -> $hostExe" }
    else { Warn "MISSING: $hostExe"; $ok = $false }
}
if (-not $AppOnly) {
    $instExe = Join-Path $cppBuild "Release/cmdide-installer$binExt"
    if (Test-Path $instExe) { Ok "Found     -> $instExe" }
    else { Warn "MISSING: $instExe"; $ok = $false }
}
if (-not $ok) { Fail "One or more expected artifacts are missing" }

Write-Host ''
Write-Host '  Build complete.' -ForegroundColor Green
Write-Host ''
