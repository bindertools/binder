#!/usr/bin/env pwsh
# build.ps1 - Builds all C++ release artifacts.
#
# Output artifacts (matching the old Go/Wails build exactly):
#   cmdIDE-windows-amd64.exe         - base app (no plugin manager)
#   cmdIDE-plugins-windows-amd64.exe - plugins app (with plugin manager)
#   cmdIDE-installer-windows.exe     - stable installer
#   cmdIDE-installer-dev-windows.exe - dev-channel installer (includes pre-releases)
#
# Flags:
#   -AppOnly        build app variants only, skip installer
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

# -- Artifact names (exact match to old Go/Wails outputs) ----------------------
$baseName    = "cmdIDE-$platform-amd64$binExt"
$pluginsName = "cmdIDE-plugins-$platform-amd64$binExt"
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

# On Windows use the static triplet so all dependencies are statically linked.
# This produces truly standalone .exe files with zero DLL dependencies,
# matching the old Wails single-binary build behavior.
$tripletArgs = @()
if ($platform -eq 'windows') {
    $tripletArgs = @('-DVCPKG_TARGET_TRIPLET=x64-windows-static', '-DVCPKG_HOST_TRIPLET=x64-windows-static')
}
Write-Host "  vcpkg    : $vcpkgRoot" -ForegroundColor DarkGray

$cppDir   = Join-Path $root 'cpp'
$cppBuild = Join-Path $cppDir 'build'
$devBuild = Join-Path $cppDir 'build-dev'
$releaseDir = Join-Path $cppBuild 'Release'

# -- Helper: run npm build for a frontend variant ------------------------------
function Build-Frontend {
    param([string]$dir, [bool]$WithPlugins = $false)
    $variant = if ($WithPlugins) { 'plugins' } else { 'base' }
    Step "Frontend build - $variant ($dir)"
    Push-Location $dir
    if (-not (Test-Path 'node_modules')) { npm install }
    if ($WithPlugins) { $env:VITE_PLUGINS = 'true' } else { Remove-Item Env:VITE_PLUGINS -EA SilentlyContinue }
    npm run build
    $code = $LASTEXITCODE
    Remove-Item Env:VITE_PLUGINS -EA SilentlyContinue
    Pop-Location
    if ($code -ne 0) { Fail "Frontend ($variant) build failed" }
    Ok "Built -> $dir/dist/ ($variant)"
}

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
# STEP 1 - Installer frontend (same for stable and dev)
# =============================================================================
if (-not $AppOnly) {
    Build-Frontend -dir (Join-Path $root 'installer/windows/frontend')
}

# =============================================================================
# STEP 2 - Initial CMake configure (installs vcpkg packages)
# =============================================================================
Step "CMake configure"
Cmake-Configure -buildDir $cppBuild
Ok "Configured -> cpp/build"

# =============================================================================
# STEP 3 - Build stable installer
# =============================================================================
if (-not $AppOnly) {
    Step "Build stable installer"
    & cmake --build $cppBuild --config Release --target cmdide-installer
    if ($LASTEXITCODE -ne 0) { Fail "Stable installer build failed" }
    $instSrc = Join-Path $releaseDir "cmdide-installer$binExt"
    $instDst = Join-Path $releaseDir $instName
    if (Test-Path $instSrc) { Copy-Item -Force $instSrc $instDst }
    Ok "Built -> $instName"
}

# =============================================================================
# STEP 4 - Build dev installer (reuses vcpkg_installed from step 2)
# =============================================================================
if (-not $AppOnly) {
    Step "Build dev installer"
    $sharedInstalled = Join-Path $cppBuild 'vcpkg_installed'
    if (Test-Path $sharedInstalled) {
        Cmake-Configure -buildDir $devBuild -extra @{
            CMDIDE_INSTALLER_DEV = 'ON'
            VCPKG_INSTALLED_DIR  = $sharedInstalled
        }
    } else {
        Cmake-Configure -buildDir $devBuild -extra @{ CMDIDE_INSTALLER_DEV = 'ON' }
    }
    & cmake --build $devBuild --config Release --target cmdide-installer
    if ($LASTEXITCODE -ne 0) { Fail "Dev installer build failed" }
    $devExe = Join-Path $devBuild "Release\cmdide-installer$binExt"
    $devDst = Join-Path $releaseDir $instDevName
    if (Test-Path $devExe) { Copy-Item -Force $devExe $devDst }
    Ok "Built -> $instDevName"
}

# =============================================================================
# STEP 5 - Base app (no plugin manager)
# =============================================================================
if (-not $InstallerOnly) {
    Build-Frontend -dir (Join-Path $root 'app/frontend') -WithPlugins $false

    Step "Build cmdide-host (base - no plugins)"
    & cmake --build $cppBuild --config Release --target cmdide-host
    if ($LASTEXITCODE -ne 0) { Fail "cmdide-host (base) build failed" }
    $hostSrc = Join-Path $releaseDir "cmdide-host$binExt"
    $hostDst = Join-Path $releaseDir $baseName
    if (Test-Path $hostSrc) { Copy-Item -Force $hostSrc $hostDst }
    Ok "Built -> $baseName"
}

# =============================================================================
# STEP 6 - Plugins app (with plugin manager)
# =============================================================================
if (-not $InstallerOnly) {
    Build-Frontend -dir (Join-Path $root 'app/frontend') -WithPlugins $true

    Step "Build cmdide-host (plugins)"
    # cmake detects the changed frontend.zip and re-links with the new RC resource
    & cmake --build $cppBuild --config Release --target cmdide-host
    if ($LASTEXITCODE -ne 0) { Fail "cmdide-host (plugins) build failed" }
    $pluginsDst = Join-Path $releaseDir $pluginsName
    if (Test-Path $hostSrc) { Copy-Item -Force $hostSrc $pluginsDst }
    Ok "Built -> $pluginsName"
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

if (-not $InstallerOnly) { Check-Artifact $baseName; Check-Artifact $pluginsName }
if (-not $AppOnly)       { Check-Artifact $instName; Check-Artifact $instDevName }

if (-not $ok) { Fail "One or more artifacts are missing" }

Write-Host ''
Write-Host '  Build complete.' -ForegroundColor Green
Write-Host ''
Write-Host "  Artifacts in cpp/build/Release/:" -ForegroundColor DarkGray
if (-not $InstallerOnly) {
    Write-Host "    $baseName" -ForegroundColor DarkGray
    Write-Host "    $pluginsName" -ForegroundColor DarkGray
}
if (-not $AppOnly) {
    Write-Host "    $instName" -ForegroundColor DarkGray
    Write-Host "    $instDevName" -ForegroundColor DarkGray
}
Write-Host ''
