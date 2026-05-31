#!/usr/bin/env pwsh
# build.ps1 - Builds all C++ release artifacts for the current platform.
#
# Produces two app variants per platform:
#   cmdIDE-<os>-<arch>         - base app (no plugin manager)
#   cmdIDE-plugins-<os>-<arch> - plugins app (with plugin manager)
# Plus the stable installer (and optionally the dev-channel installer).
#
# Flags:
#   -AppOnly        build app variants only, skip installer
#   -InstallerOnly  build installer only
#   -NoArchive      produce files but skip zip/tar creation
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

# -- Platform detection --------------------------------------------------------
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    $platform = 'windows'
    $arch     = if ([System.Environment]::Is64BitOperatingSystem) { 'amd64' } else { 'x86' }
    $binExt   = '.exe'
    $archExt  = '.zip'
} elseif ($IsMacOS) {
    $platform = 'darwin'
    $arch     = if ((uname -m) -eq 'arm64') { 'arm64' } else { 'amd64' }
    $binExt   = ''
    $archExt  = '.zip'
} else {
    $platform = 'linux'
    $arch     = 'amd64'
    $binExt   = ''
    $archExt  = '.tar.gz'
}

Write-Host ''
Write-Host "  Platform     : $platform / $arch" -ForegroundColor DarkGray

$baseName    = "cmdIDE-$platform-$arch"
$pluginsName = "cmdIDE-plugins-$platform-$arch"

# -- Locate vcpkg -------------------------------------------------------------
$vcpkgRoot = $env:VCPKG_ROOT
if (-not $vcpkgRoot) {
    foreach ($c in @('C:\vcpkg', 'C:\src\vcpkg', "$env:USERPROFILE\vcpkg",
                     '/usr/local/vcpkg', "$HOME/vcpkg")) {
        if (Test-Path (Join-Path $c 'scripts/buildsystems/vcpkg.cmake')) {
            $vcpkgRoot = $c; break
        }
    }
}
if (-not $vcpkgRoot) { Fail "vcpkg not found. Set VCPKG_ROOT or install vcpkg." }
$toolchain    = Join-Path $vcpkgRoot 'scripts/buildsystems/vcpkg.cmake'
$overlayPorts = Join-Path $root 'cpp/ports'
Write-Host "  vcpkg        : $vcpkgRoot" -ForegroundColor DarkGray

$cppDir     = Join-Path $root 'cpp'
$cppBuild   = Join-Path $cppDir 'build'
$devBuild   = Join-Path $cppDir 'build-dev'
$releaseDir = Join-Path $cppBuild 'Release'
$distDir    = Join-Path $root 'app/frontend/dist'

# -- Helper: create archive from directory ------------------------------------
function New-Archive {
    param([string]$srcDir, [string]$archivePath)
    if ($NoArchive) { return }
    if (Test-Path $archivePath) { Remove-Item -Force $archivePath }
    if ($archExt -eq '.tar.gz') {
        $leaf = Split-Path $srcDir -Leaf
        Push-Location (Split-Path $srcDir -Parent)
        tar -czf $archivePath $leaf
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Fail "tar failed for $archivePath" }
    } else {
        Compress-Archive -Path (Join-Path $srcDir '*') -DestinationPath $archivePath
    }
    Ok "Archived  -> $(Split-Path $archivePath -Leaf)"
}

# -- Helper: stage one app variant from Release/ into a named subdirectory ----
function Stage-AppVariant {
    param([string]$stageName, [string]$exeName)

    $stageDir = Join-Path $releaseDir $stageName
    if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
    New-Item -ItemType Directory -Force $stageDir | Out-Null

    # Copy the host exe (rename it to the artifact name)
    $hostExe = Join-Path $releaseDir "cmdide-host$binExt"
    if (Test-Path $hostExe) {
        Copy-Item $hostExe (Join-Path $stageDir "$exeName$binExt")
    } else {
        Fail "cmdide-host$binExt not found in Release/ -cmake build may have failed"
    }

    # Copy runtime DLLs (*.dll only, skip static libs and other exes)
    Get-ChildItem $releaseDir -Filter '*.dll' | Copy-Item -Destination $stageDir

    # Copy the www/ directory (the frontend assets for this variant)
    $wwwSrc = Join-Path $releaseDir 'www'
    if (Test-Path $wwwSrc) {
        Copy-Item -Recurse $wwwSrc (Join-Path $stageDir 'www')
    } else {
        Warn "www/ not found in Release/ - host will show blank page"
    }

    Ok "Staged    -> Release/$stageName/"
}

# =============================================================================
# STEP 1 -Build base frontend (no plugins)
# =============================================================================
if (-not $InstallerOnly) {
    Step "Frontend build - base (no plugin manager)"
    Push-Location (Join-Path $root 'app/frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    Remove-Item Env:VITE_PLUGINS -ErrorAction SilentlyContinue
    npm run build
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Fail "Frontend (base) npm build failed" }
    Ok "Built     -> app/frontend/dist/ (base)"
}

# =============================================================================
# STEP 2 -CMake configure + build C++ host
# The CMake post-build step copies the current dist/ to Release/www/.
# Since the base frontend was built in Step 1, Release/www/ will contain the
# base (no-plugins) frontend.
# =============================================================================
Step "CMake configure"
$cmakeArgs = @(
    "-B", $cppBuild, "-S", $cppDir,
    "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
    "-DVCPKG_OVERLAY_PORTS=$overlayPorts"
)
if ($Version) { $cmakeArgs += "-DCMDIDE_VERSION=$Version" }
& cmake @cmakeArgs
if ($LASTEXITCODE -ne 0) { Fail "CMake configure failed" }
Ok "Configured -> $cppBuild"

if (-not $InstallerOnly) {
    Step "Build cmdide-host (C++ binary)"
    & cmake --build $cppBuild --config Release --target cmdide-host
    if ($LASTEXITCODE -ne 0) { Fail "cmdide-host build failed" }
    Ok "Built     -> cpp/build/Release/cmdide-host$binExt"
    # At this point Release/www/ has the base frontend (copied by post-build)
}

# =============================================================================
# STEP 3 -Stage base app variant
# =============================================================================
if (-not $InstallerOnly) {
    Stage-AppVariant -stageName $baseName -exeName $baseName
    New-Archive -srcDir (Join-Path $releaseDir $baseName) `
                -archivePath (Join-Path $releaseDir "$baseName$archExt")
}

# =============================================================================
# STEP 4 -Build plugins frontend
# =============================================================================
if (-not $InstallerOnly) {
    Step "Frontend build - plugins (with plugin manager)"
    Push-Location (Join-Path $root 'app/frontend')
    $env:VITE_PLUGINS = 'true'
    npm run build
    $code = $LASTEXITCODE
    Remove-Item Env:VITE_PLUGINS -ErrorAction SilentlyContinue
    Pop-Location
    if ($code -ne 0) { Fail "Frontend (plugins) npm build failed" }
    Ok "Built     -> app/frontend/dist/ (plugins)"

    # Manually update Release/www/ with the plugins frontend
    # (cmake won't re-run post-build unless the C++ target is rebuilt)
    $wwwDest = Join-Path $releaseDir 'www'
    if (Test-Path $wwwDest) { Remove-Item -Recurse -Force $wwwDest }
    Copy-Item -Recurse $distDir $wwwDest
    Ok "Updated   -> Release/www/ (plugins frontend)"
}

# =============================================================================
# STEP 5 -Stage plugins app variant
# =============================================================================
if (-not $InstallerOnly) {
    Stage-AppVariant -stageName $pluginsName -exeName $pluginsName
    New-Archive -srcDir (Join-Path $releaseDir $pluginsName) `
                -archivePath (Join-Path $releaseDir "$pluginsName$archExt")
}

# =============================================================================
# STEP 6 -Installer frontend
# =============================================================================
if (-not $AppOnly) {
    Step "Frontend build - installer"
    Push-Location (Join-Path $root 'installer/windows/frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Fail "Installer frontend npm build failed" }
    Ok "Built     -> installer/windows/frontend/dist/"
}

# =============================================================================
# STEP 7 -Build stable installer
# =============================================================================
if (-not $AppOnly) {
    Step "Build cmdide-installer (stable)"
    & cmake --build $cppBuild --config Release --target cmdide-installer
    if ($LASTEXITCODE -ne 0) { Fail "cmdide-installer build failed" }
    Ok "Built     -> cpp/build/Release/cmdide-installer$binExt"
}

# =============================================================================
# STEP 8 -Build dev-channel installer (optional)
# =============================================================================
if ($DevInstaller -and -not $AppOnly) {
    Step "Build cmdide-installer-dev (dev channel)"
    $devArgs = @(
        "-B", $devBuild, "-S", $cppDir,
        "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
        "-DVCPKG_OVERLAY_PORTS=$overlayPorts",
        "-DCMDIDE_INSTALLER_DEV=ON"
    )
    & cmake @devArgs
    if ($LASTEXITCODE -ne 0) { Fail "CMake configure (dev) failed" }
    & cmake --build $devBuild --config Release --target cmdide-installer
    if ($LASTEXITCODE -ne 0) { Fail "Dev installer build failed" }

    $devExeSrc  = Join-Path $devBuild "Release/cmdide-installer$binExt"
    $devExeDest = Join-Path $releaseDir "cmdide-installer-dev$binExt"
    if (Test-Path $devExeSrc) {
        Copy-Item -Force $devExeSrc $devExeDest
        Ok "Built     -> cpp/build/Release/cmdide-installer-dev$binExt"
    } else {
        Warn "Dev installer exe not found"
    }
}

# =============================================================================
# STEP 9 -Verify
# =============================================================================
Step "Verifying artifacts"
$ok = $true

if (-not $InstallerOnly) {
    foreach ($name in @($baseName, $pluginsName)) {
        $sd = Join-Path $releaseDir $name
        if (Test-Path "$sd\$name$binExt") { Ok "Found     -> Release/$name/$name$binExt" }
        else { Warn "MISSING exe in Release/$name/"; $ok = $false }

        if (-not $NoArchive) {
            $arc = Join-Path $releaseDir "$name$archExt"
            if (Test-Path $arc) { Ok "Found     -> Release/$name$archExt" }
            else { Warn "MISSING archive: $name$archExt"; $ok = $false }
        }
    }
}
if (-not $AppOnly) {
    $instExe = Join-Path $releaseDir "cmdide-installer$binExt"
    if (Test-Path $instExe) { Ok "Found     -> cpp/build/Release/cmdide-installer$binExt" }
    else { Warn "MISSING: cmdide-installer$binExt"; $ok = $false }
}

if (-not $ok) { Fail "One or more expected artifacts are missing" }

Write-Host ''
Write-Host '  Build complete.' -ForegroundColor Green
Write-Host ''
Write-Host "  Artifacts in: cpp/build/Release/" -ForegroundColor DarkGray
if (-not $InstallerOnly) {
    Write-Host "    $baseName$archExt        (no plugin manager)" -ForegroundColor DarkGray
    Write-Host "    $pluginsName$archExt (with plugin manager)" -ForegroundColor DarkGray
}
if (-not $AppOnly) {
    Write-Host "    cmdide-installer$binExt (stable installer)" -ForegroundColor DarkGray
}
Write-Host ''
