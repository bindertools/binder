#!/usr/bin/env pwsh
# build.ps1 - Builds all C++ release artifacts.
#
# Output artifacts:
#   Binder-windows-amd64.exe - main app (plugin manager included as standard)
#   Binder-setup-windows.exe - stable setup
#   Binder-setup-dev-windows.exe - dev-channel setup
#
# Flags:
#   -AppOnly    build app only, skip setup
#   -SetupOnly  build setup only
#   -Version        version string (e.g. "v1.2.3")

param(
    [switch]$AppOnly,
    [switch]$SetupOnly,
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
$appName     = "Binder-$platform-amd64$binExt"
$setupName    = "Binder-setup-$platform$binExt"
$setupDevName = "Binder-setup-dev-$platform$binExt"

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
    if ($Version) { $args += "-DBINDER_VERSION=$Version" }
    foreach ($k in $extra.Keys) { $args += "-D$k=$($extra[$k])" }
    & cmake @args
    if ($LASTEXITCODE -ne 0) { Fail "CMake configure failed for $buildDir" }
}

# =============================================================================
# STEP 1 - Setup frontend
# =============================================================================
if (-not $AppOnly) {
    Step "Frontend build - setup"
    Push-Location (Join-Path $root 'setup/windows/frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Fail "Setup frontend npm build failed" }
    Ok "Built -> setup/windows/frontend/dist/"
}

# =============================================================================
# STEP 2 - App frontend (plugin manager always included as standard)
# =============================================================================
if (-not $SetupOnly) {
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
if (-not $SetupOnly) {
    Step "Build binder-host"
    & cmake --build $cppBuild --config Release --target binder-host
    if ($LASTEXITCODE -ne 0) { Fail "binder-host build failed" }
    $hostSrc = Join-Path $releaseDir "binder-host$binExt"
    $appDst  = Join-Path $releaseDir $appName
    if (Test-Path $hostSrc) { Copy-Item -Force $hostSrc $appDst }
    Ok "Built -> $appName"
}

# =============================================================================
# STEP 5 - Build stable setup
# =============================================================================
if (-not $AppOnly) {
    Step "Build stable setup"
    & cmake --build $cppBuild --config Release --target binder-setup
    if ($LASTEXITCODE -ne 0) { Fail "Stable setup build failed" }
    $instSrc = Join-Path $releaseDir "binder-setup$binExt"
    $setupDst = Join-Path $releaseDir $setupName
    if (Test-Path $instSrc) { Copy-Item -Force $instSrc $setupDst }
    Ok "Built -> $setupName"
}

# =============================================================================
# STEP 6 - Build dev setup
# =============================================================================
if (-not $AppOnly) {
    Step "Build dev setup"
    $sharedInstalled = Join-Path $cppBuild 'vcpkg_installed'
    $devExtra = @{ BINDER_SETUP_DEV = 'ON' }
    if (Test-Path $sharedInstalled) {
        $devExtra['VCPKG_INSTALLED_DIR'] = $sharedInstalled
    }
    Cmake-Configure -buildDir $devBuild -extra $devExtra
    & cmake --build $devBuild --config Release --target binder-setup
    if ($LASTEXITCODE -ne 0) { Fail "Dev setup build failed" }
    $devSrc = Join-Path $devBuild "Release\binder-setup$binExt"
    $setupDevDst = Join-Path $releaseDir $setupDevName
    if (Test-Path $devSrc) { Copy-Item -Force $devSrc $setupDevDst }
    Ok "Built -> $setupDevName"
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

if (-not $SetupOnly) { Check-Artifact $appName }
if (-not $AppOnly)   { Check-Artifact $setupName; Check-Artifact $setupDevName }

if (-not $ok) { Fail "One or more artifacts are missing" }

Write-Host ''
Write-Host '  Build complete.' -ForegroundColor Green
Write-Host ''
Write-Host "  Artifacts in cpp/build/Release/:" -ForegroundColor DarkGray
if (-not $SetupOnly) { Write-Host "    $appName" -ForegroundColor DarkGray }
if (-not $AppOnly) {
    Write-Host "    $setupName" -ForegroundColor DarkGray
    Write-Host "    $setupDevName" -ForegroundColor DarkGray
}
Write-Host ''
