#!/usr/bin/env pwsh
# build.ps1 - Builds all C++ release artifacts.
#
# Output artifacts:
#   cmdIDE-windows-amd64.exe     - main app (plugin manager included as standard)
#   cmdIDE-installer-windows.exe - stable installer
#   cmdIDE-installer-dev-windows.exe - dev-channel installer
#
# Flags:
#   -AppOnly        build app only, skip installer
#   -InstallerOnly  build installer only
#   -Version        version string (e.g. "v1.2.3")

param(
    [switch]$AppOnly,
    [switch]$InstallerOnly,
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Step($msg) { Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "     OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "     !!  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "`n  !! $msg" -ForegroundColor Red; exit 1 }

# -- Platform detection --------------------------------------------------------
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    $platform = 'windows'; $binExt = '.exe'
} elseif ($IsMacOS) {
    $platform = 'darwin';  $binExt = ''
} else {
    $platform = 'linux';   $binExt = ''
}
Write-Host "`n  Platform : $platform" -ForegroundColor DarkGray

# -- Artifact names ------------------------------------------------------------
$appName     = "cmdIDE-$platform-amd64$binExt"
$instName    = "cmdIDE-installer-$platform$binExt"
$instDevName = "cmdIDE-installer-dev-$platform$binExt"

# -- Locate vcpkg --------------------------------------------------------------
$vcpkgRoot = $env:VCPKG_ROOT
if (-not $vcpkgRoot) {
    foreach ($c in @('C:\vcpkg', "$env:USERPROFILE\vcpkg", '/usr/local/vcpkg', "$HOME/vcpkg")) {
        if (Test-Path (Join-Path $c 'scripts/buildsystems/vcpkg.cmake')) { $vcpkgRoot = $c; break }
    }
}
if (-not $vcpkgRoot) { Fail "vcpkg not found. Set VCPKG_ROOT." }
$toolchain    = Join-Path $vcpkgRoot 'scripts/buildsystems/vcpkg.cmake'
$overlayPorts = Join-Path $root 'cpp/ports'

# On Windows use the static triplet so all dependencies are statically linked
# (zero DLL dependencies — truly self-contained exe like the old Wails build).
$tripletArgs = @()
if ($platform -eq 'windows') {
    $tripletArgs = @('-DVCPKG_TARGET_TRIPLET=x64-windows-static', '-DVCPKG_HOST_TRIPLET=x64-windows-static')
}

$cppDir     = Join-Path $root 'cpp'
$cppBuild   = Join-Path $cppDir 'build'
$devBuild   = Join-Path $cppDir 'build-dev'
$releaseDir = Join-Path $cppBuild 'Release'

# -- Helper: cmake configure ---------------------------------------------------
function Cmake-Configure {
    param([string]$buildDir, [hashtable]$extra = @{})
    $args = @("-B", $buildDir, "-S", $cppDir,
              "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
              "-DVCPKG_OVERLAY_PORTS=$overlayPorts")
    $args += $tripletArgs
    if ($Version) { $args += "-DCMDIDE_VERSION=$Version" }
    foreach ($k in $extra.Keys) { $args += "-D$k=$($extra[$k])" }
    & cmake @args
    if ($LASTEXITCODE -ne 0) { Fail "CMake configure failed for $buildDir" }
}

# =============================================================================
# STEP 1 - Installer frontend
# =============================================================================
if (-not $AppOnly) {
    Step "Frontend build - installer"
    Push-Location (Join-Path $root 'setup/windows/frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Fail "Installer frontend npm build failed" }
    Ok "Built -> setup/windows/frontend/dist/"
}

# =============================================================================
# STEP 2 - App frontend (plugin manager always included as standard)
# =============================================================================
if (-not $InstallerOnly) {
    Step "Frontend build - app (plugins standard)"
    Push-Location (Join-Path $root 'app/frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    $env:VITE_PLUGINS = 'true'
    npm run build
    $code = $LASTEXITCODE
    Remove-Item Env:VITE_PLUGINS -EA SilentlyContinue
    Pop-Location
    if ($code -ne 0) { Fail "App frontend npm build failed" }
    Ok "Built -> app/frontend/dist/ (plugins standard)"
}

# =============================================================================
# STEP 3 - CMake configure
# =============================================================================
Step "CMake configure"
Cmake-Configure -buildDir $cppBuild
Ok "Configured -> cpp/build"

# =============================================================================
# STEP 4 - Build app
# =============================================================================
if (-not $InstallerOnly) {
    Step "Build cmdide-host"
    & cmake --build $cppBuild --config Release --target cmdide-host
    if ($LASTEXITCODE -ne 0) { Fail "cmdide-host build failed" }
    $hostSrc = Join-Path $releaseDir "cmdide-host$binExt"
    $appDst  = Join-Path $releaseDir $appName
    if (Test-Path $hostSrc) { Copy-Item -Force $hostSrc $appDst }
    Ok "Built -> $appName"
}

# =============================================================================
# STEP 5 - Build stable installer
# =============================================================================
if (-not $AppOnly) {
    Step "Build stable setup"
    & cmake --build $cppBuild --config Release --target cmdide-setup
    if ($LASTEXITCODE -ne 0) { Fail "Stable setup build failed" }
    $instSrc = Join-Path $releaseDir "cmdide-setup$binExt"
    $instDst = Join-Path $releaseDir $instName
    if (Test-Path $instSrc) { Copy-Item -Force $instSrc $instDst }
    Ok "Built -> $instName"
}

# =============================================================================
# STEP 6 - Build dev installer
# =============================================================================
if (-not $AppOnly) {
    Step "Build dev setup"
    $sharedInstalled = Join-Path $cppBuild 'vcpkg_installed'
    $devExtra = @{ CMDIDE_SETUP_DEV = 'ON' }
    if (Test-Path $sharedInstalled) {
        $devExtra['VCPKG_INSTALLED_DIR'] = $sharedInstalled
    }
    Cmake-Configure -buildDir $devBuild -extra $devExtra
    & cmake --build $devBuild --config Release --target cmdide-setup
    if ($LASTEXITCODE -ne 0) { Fail "Dev setup build failed" }
    $devSrc = Join-Path $devBuild "Release\cmdide-setup$binExt"
    $devDst = Join-Path $releaseDir $instDevName
    if (Test-Path $devSrc) { Copy-Item -Force $devSrc $devDst }
    Ok "Built -> $instDevName"
}

# =============================================================================
# STEP 7 - Verify
# =============================================================================
Step "Verifying artifacts"
$ok = $true

function Check-Artifact($name) {
    $p = Join-Path $releaseDir $name
    if (Test-Path $p) { Ok "Found -> $name" }
    else { Warn "MISSING: $name"; $script:ok = $false }
}

if (-not $InstallerOnly) { Check-Artifact $appName }
if (-not $AppOnly)       { Check-Artifact $instName; Check-Artifact $instDevName }

if (-not $ok) { Fail "One or more artifacts are missing" }

Write-Host ''
Write-Host '  Build complete.' -ForegroundColor Green
Write-Host ''
Write-Host "  Artifacts in cpp/build/Release/:" -ForegroundColor DarkGray
if (-not $InstallerOnly) { Write-Host "    $appName" -ForegroundColor DarkGray }
if (-not $AppOnly) {
    Write-Host "    $instName" -ForegroundColor DarkGray
    Write-Host "    $instDevName" -ForegroundColor DarkGray
}
Write-Host ''
