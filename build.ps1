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
    [string]$Version = ''   # e.g. "v1.2.3" -- injected into main.AppVersion at link time
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
$installerDevName = "cmdIDE-installer-dev$installerSfx$binExt"

# macOS ships the main app as a drag-to-Applications DMG; the installer and
# all other platforms continue to use zip / tar.gz.
$appArchExt          = if ($goOs -eq 'darwin') { '.dmg' } else { $archExt }
$baseArchive         = "cmdIDE-$goOs-$goArch$appArchExt"
$pluginsArchive      = "cmdIDE-plugins-$goOs-$goArch$appArchExt"
$installerArchive    = "cmdIDE-installer$installerSfx$archExt"
$installerDevArchive = "cmdIDE-installer-dev$installerSfx$archExt"

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
    if (Test-Path $archivePath) { Remove-Item -Recurse -Force $archivePath }

    if ($archExt -eq '.tar.gz') {
        # Linux: plain tar, run from $binDir so the archive has no leading path
        $leaf = Split-Path $srcPath -Leaf
        Push-Location $binDir
        & tar -czf $archiveName $leaf
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Fail "tar failed for $archiveName" }
    } elseif ($goOs -eq 'darwin') {
        # macOS: use ditto to produce a proper Finder-friendly zip that preserves
        # .app bundle structure, symlinks (Frameworks/), permissions, and xattrs.
        # Compress-Archive uses .NET ZipFile which silently corrupts app bundles.
        $leaf   = Split-Path $srcPath -Leaf
        $srcDir = Split-Path $srcPath -Parent
        Push-Location $srcDir
        & ditto -c -k --keepParent $leaf $archivePath
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Fail "ditto failed for $archiveName" }
    } else {
        # Windows: PowerShell Compress-Archive is fine for .exe files
        Compress-Archive -Path $srcPath -DestinationPath $archivePath
    }
    Ok "Archived  -> app/build/bin/$archiveName"
}

function New-MacDmg {
    # Produces a drag-to-Applications DMG using create-dmg (brew install create-dmg).
    # The DMG mounts as a Finder window showing the .app icon and an Applications
    # alias -- the user drags the icon to install, exactly like draw.io / VS Code.
    param([string]$appPath, [string]$dmgName, [string]$volName)
    $dmgPath = Join-Path $binDir $dmgName
    if (Test-Path $dmgPath) { Remove-Item -Force $dmgPath }

    # Deep-sign the entire bundle with an ad-hoc identity.
    # Wails' built-in self-sign only covers the main binary; frameworks and
    # helpers inside the bundle are left unsigned, which causes macOS to show the
    # harsh "This software needs to be updated" Gatekeeper error instead of the
    # softer "unidentified developer" message that users can bypass via
    # System Settings ? Privacy & Security ? Open Anyway.
    & codesign --deep --force --sign '-' $appPath
    if ($LASTEXITCODE -ne 0) { Warn "codesign --deep failed (non-fatal)" }

    # Stage: a temp dir containing the .app and an optional helper script.
    $staging = Join-Path ([System.IO.Path]::GetTempPath()) "cmdide-dmg-$(New-Guid)"
    New-Item -ItemType Directory $staging | Out-Null
    & ditto $appPath (Join-Path $staging (Split-Path $appPath -Leaf))

    # Include the Gatekeeper fix script so users have a one-click remedy if
    # macOS blocks the first launch.
    $fixSrc = Join-Path $appDir 'build/macos/Fix Gatekeeper.command'
    $hasFixScript = Test-Path $fixSrc
    if ($hasFixScript) {
        $fixDst = Join-Path $staging 'Fix Gatekeeper.command'
        & ditto $fixSrc $fixDst
        & chmod '+x' $fixDst
    }

    # Optional background image.
    $bgArgs = @()
    $bgPng  = Join-Path $appDir 'build/macos/dmg-background.png'
    if (Test-Path $bgPng) { $bgArgs = @('--background', $bgPng) }

    $dmgArgs = @(
        '--volname',        $volName,
        '--window-pos',     '200', '120',
        '--window-size',    '600', '430',
        '--icon-size',      '120',
        '--icon',           'cmdIDE.app', '155', '170',
        '--hide-extension', 'cmdIDE.app',
        '--app-drop-link',  '445', '170',
        '--no-internet-enable'
    )
    if ($hasFixScript) {
        $dmgArgs += @('--icon', 'Fix Gatekeeper.command', '300', '340')
    }
    if ($bgArgs.Count -gt 0) { $dmgArgs += $bgArgs }
    $dmgArgs += $dmgPath
    $dmgArgs += $staging
    & create-dmg @dmgArgs
    $code = $LASTEXITCODE
    Remove-Item -Recurse -Force $staging
    # create-dmg exits 1 when it can't set icon positions via osascript but still
    # produces the DMG -- only fail if the output file is actually missing.
    if ($code -ne 0 -and -not (Test-Path $dmgPath)) { Fail "create-dmg failed for $dmgName" }
    Ok "DMG       -> app/build/bin/$dmgName"
}

function Build-CppBackend {
    # Builds cpp/build/Release/cmdide-backend.exe via CMake + vcpkg.
    # Skips with a warning if vcpkg is not found (set VCPKG_ROOT to override).
    $cppDir   = Join-Path $root 'cpp'
    $cppBuild = Join-Path $cppDir 'build'

    $vcpkgRoot = $env:VCPKG_ROOT
    if (-not $vcpkgRoot) {
        foreach ($c in @('C:\vcpkg', 'C:\src\vcpkg', "$env:USERPROFILE\vcpkg")) {
            if (Test-Path (Join-Path $c 'scripts\buildsystems\vcpkg.cmake')) {
                $vcpkgRoot = $c; break
            }
        }
    }
    if (-not $vcpkgRoot) {
        Warn "vcpkg not found (set VCPKG_ROOT) -- skipping C++ backend build"
        return
    }

    $toolchain = Join-Path $vcpkgRoot 'scripts\buildsystems\vcpkg.cmake'

    if (-not (Test-Path (Join-Path $cppBuild 'CMakeCache.txt'))) {
        & cmake -B $cppBuild -S $cppDir "-DCMAKE_TOOLCHAIN_FILE=$toolchain"
        if ($LASTEXITCODE -ne 0) { Fail "C++ cmake configure failed" }
    }

    & cmake --build $cppBuild --config Release
    if ($LASTEXITCODE -ne 0) { Fail "C++ cmake build failed" }

    $cppExe = Join-Path $cppBuild 'Release\cmdide-backend.exe'
    if (Test-Path $cppExe) {
        Ok "Binary    -> cpp/build/Release/cmdide-backend.exe"
    } else {
        Warn "cmdide-backend.exe not found after build (check cmake output)"
    }
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
    if ($goOs -eq 'darwin') {
        # On macOS, staged bundles keep their .app extension; also clear DMG files.
        Clear-OldBinary "$baseName.app"
        Clear-OldBinary "$pluginsName.app"
        Clear-OldBinary 'cmdIDE.app'     # leftover Wails output from a prior run
        Clear-OldBinary $baseArchive     # stale .dmg
        Clear-OldBinary $pluginsArchive  # stale .dmg
    } else {
        Clear-OldBinary $baseName
        Clear-OldBinary $pluginsName
        Clear-OldBinary "cmdIDE$binExt"
    }
    Ok "Ready     -> app/build/bin/ is clean"
}

# -- Splash banner (Windows only) ----------------------------------------------
# Re-render the dark SVG lockup to a PNG so the native splash screen can embed it.
if ($goOs -eq 'windows' -and -not $InstallerOnly) {
    Step "Splash banner PNG"
    $edgePath  = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    $svgSrc    = Join-Path $appDir 'frontend\public\lockup-dark.svg'
    $bannerDst = Join-Path $appDir 'build\windows\splash_banner.png'
    $tmpSvg    = Join-Path $env:TEMP 'lockup_splash_build.svg'

    # Recolour the background rect to match our splash (#0b0d0e -> #0d0d0d).
    $svgText = (Get-Content $svgSrc -Raw) -replace 'rect width="720" height="240" fill="#0b0d0e"', 'rect width="720" height="240" fill="#0d0d0d"'
    Set-Content $tmpSvg $svgText -Encoding UTF8

    if (Test-Path $edgePath) {
        # Build a plain file URI without nested quotes (avoids PS 5.1 parser quirks).
        $tmpSvgUri = 'file:///' + $tmpSvg.Replace('\', '/')
        & $edgePath --headless=new --disable-gpu "--screenshot=$bannerDst" --window-size=720,240 $tmpSvgUri | Out-Null
        if (Test-Path $bannerDst) {
            Ok "Banner    -> app/build/windows/splash_banner.png"
        } else {
            Warn "Edge render failed - using committed splash_banner.png"
        }
    } else {
        Warn "Edge not found - using committed splash_banner.png"
    }
    Remove-Item $tmpSvg -ErrorAction SilentlyContinue
}

# -- Purge stale cross-platform npm lockfile (non-Windows) --------------------
# package-lock.json is committed from Windows and only contains the Windows
# Rollup native binary (@rollup/rollup-win32-x64-msvc).  On macOS/Linux, npm
# honours the lockfile but silently skips optional deps that aren't listed --
# Vite 7 then fails because it can't find the platform-specific native build.
# Deleting the lockfile here lets Wails' "npm install" re-resolve it fresh and
# pull in the correct @rollup/rollup-<platform> package automatically.
if ($goOs -ne 'windows' -and -not $InstallerOnly) {
    $lockFile = Join-Path $appDir 'frontend/package-lock.json'
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force
        Ok "Removed   -> frontend/package-lock.json (re-resolving for $goOs/$goArch)"
    }
}

# -- 1/3  Base app -------------------------------------------------------------
if (-not $InstallerOnly) {
    Step "1/3  Base app ($goOs/$goArch)"
    Invoke-Wails $appDir $appFlags @{ VITE_PLUGINS = '' } 'Base app'

    if ($goOs -eq 'darwin') {
        # Wails produces cmdIDE.app.  Build the DMG while it's still named
        # cmdIDE.app (the DMG contains cmdIDE.app/ which is what macOS expects).
        # Then rename to stage it so the plugins build can emit a fresh cmdIDE.app.
        $srcApp = Join-Path $binDir 'cmdIDE.app'
        if (-not (Test-Path $srcApp)) { Fail 'Wails did not produce cmdIDE.app' }
        New-MacDmg   $srcApp $baseArchive 'cmdIDE'
        $stageApp = Join-Path $binDir "$baseName.app"
        if (Test-Path $stageApp) { Remove-Item -Recurse -Force $stageApp }
        Rename-Item  $srcApp $stageApp
        Ok "Binary    -> app/build/bin/$baseName.app"
    } else {
        Stage-Output $baseName
        New-Archive  (Join-Path $binDir $baseName) $baseArchive
        Ok "Binary    -> app/build/bin/$baseName"
    }

# -- 2/3  Plugins app ----------------------------------------------------------
    Step "2/3  Plugins app ($goOs/$goArch)"
    Invoke-Wails $appDir $pluginFlags @{ VITE_PLUGINS = 'true' } 'Plugins app'

    if ($goOs -eq 'darwin') {
        $srcApp = Join-Path $binDir 'cmdIDE.app'
        if (-not (Test-Path $srcApp)) { Fail 'Wails did not produce cmdIDE.app (plugins)' }
        New-MacDmg   $srcApp $pluginsArchive 'cmdIDE (Plugins)'
        $stageApp = Join-Path $binDir "$pluginsName.app"
        if (Test-Path $stageApp) { Remove-Item -Recurse -Force $stageApp }
        Rename-Item  $srcApp $stageApp
        Ok "Binary    -> app/build/bin/$pluginsName.app"
    } else {
        Stage-Output $pluginsName
        New-Archive  (Join-Path $binDir $pluginsName) $pluginsArchive
        Ok "Binary    -> app/build/bin/$pluginsName"
    }
}

# -- C++ backend (Windows only) ------------------------------------------------
if ($goOs -eq 'windows' -and -not $InstallerOnly) {
    Step "C++ backend (cmdide-backend.exe)"
    Build-CppBackend
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
    # Archive directly from the Wails build dir -- ditto preserves the .app
    # bundle structure so the zip contains a working cmdIDE-installer.app.
    # We do NOT copy to binDir first; only the zip needs to land there.
    New-Archive $instApp $installerArchive
} elseif (Test-Path $instBin) {
    if (Test-Path $instDest) {
        if (-not (Remove-WithRetry $instDest)) {
            Fail "Cannot remove old $installerName - file is locked."
        }
    }
    Copy-Item -Force $instBin $instDest
    New-Archive (Join-Path $binDir $installerName) $installerArchive
} else {
    Fail "Installer binary not found in $instBinDir"
}

Ok "Binary    -> app/build/bin/$installerArchive"

# -- Dev installer (Windows only -- stable + pre-release channel) ---------------
if ($goOs -eq 'windows') {
    Step "    Dev installer ($installerDir)"

    # Combine any platform tags with the 'devch' build tag.
    # Note: 'dev' is reserved by Wails internally -- use 'devch' (dev channel).
    $instDevTagStr = if ($appTagStr) { "$appTagStr,devch" } else { 'devch' }
    $instDevFlags  = @('build', '-trimpath', '-ldflags', '-s -w',
                       '-tags', $instDevTagStr,
                       '-o', "cmdIDE-installer-dev$binExt")

    Push-Location $instDir
    & wails @instDevFlags 2>&1 | ForEach-Object { Write-Host $_ }
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Write-Host ''; Fail "Dev installer build failed (exit code $code)." }

    $instDevBin  = Join-Path $instBinDir "cmdIDE-installer-dev$binExt"
    $instDevDest = Join-Path $binDir $installerDevName

    if (Test-Path $instDevBin) {
        if (Test-Path $instDevDest) {
            if (-not (Remove-WithRetry $instDevDest)) {
                Fail "Cannot remove old $installerDevName - file is locked."
            }
        }
        Copy-Item -Force $instDevBin $instDevDest
        New-Archive (Join-Path $binDir $installerDevName) $installerDevArchive
        Ok "Binary    -> app/build/bin/$installerDevArchive"
    } else {
        Fail "Dev installer binary not found in $instBinDir"
    }
}

Write-Host ''
Write-Host '  Build complete.' -ForegroundColor Green
Write-Host ''
