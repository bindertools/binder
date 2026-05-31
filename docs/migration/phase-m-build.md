# Phase M — Build System and CI/CD

## Overview

Updates `build.ps1` and all GitHub Actions workflows to build the C++ host and installer instead
of the Wails app. The Wails build is removed. Platform packaging is added for Windows, macOS, and
Linux. By the end of Phase M, `./build.ps1` produces a shippable artifact on every supported OS.

---

## Git Workflow

**Branch:** `feat/webview-migration` (already created)

Commit after each backbone milestone. Push after this phase: `git push`

---

## Prompt M.1 — Update build.ps1

```
Context: terminal-IDE. build.ps1 currently builds:
  1. C++ backend (cmdide-backend.exe) via CMake
  2. Main app (cmdIDE-windows.exe) via wails build
  3. Plugins app (cmdIDE-plugins-windows.exe) via wails build
  4. Stable installer via wails build
  5. Dev installer via wails build -tags devch

We need to replace the wails build steps with CMake builds of the C++ host and installer.
The C++ backend (cmdide-backend.exe) is retired — its functionality is now inlined into the
host. Build the C++ targets that produce the final deliverables.

Task: Rewrite build.ps1 to build the C++ host and installer targets.

Read before coding:
  - build.ps1 (REQUIRED — read the complete file; understand every step, flag, and artifact path)
  - cpp/CMakeLists.txt (understand the target names)
  - cpp/host/CMakeLists.txt
  - cpp/installer/CMakeLists.txt
  - The existing artifact names and paths that CI and the release workflow expect

Requirements:

1. Remove these steps from build.ps1:
   - Any step that calls wails build for the main app
   - Any step that calls wails build for the plugins app
   - Any step that calls wails build for the installer (stable or dev)
   - Any step that checks for wails or Go toolchain

2. Keep these steps:
   - Version extraction / banner rendering
   - UPX compression step (optional, if present)
   - Platform detection logic
   - Any archive/DMG creation steps (update them in M.2)

3. Update the CMake build step:
   Current: cmake --build cpp/build --config Release (builds cmdide-backend.exe only)
   New: cmake --build cpp/build --config Release  (now builds ALL targets — host, installer,
        installer-dev, because they are all add_subdirectory'd in cpp/CMakeLists.txt)

   Alternatively, build named targets explicitly:
     cmake --build cpp/build --config Release --target cmdide-host
     cmake --build cpp/build --config Release --target cmdide-installer
     cmake --build cpp/build --config Release --target cmdide-installer
       with -DCMDIDE_INSTALLER_DEV=ON (or set a separate cmake configure step)

   For the dev installer, a separate CMake configure + build with the flag is cleanest:
     cmake -B cpp/build-dev -S cpp -DCMAKE_TOOLCHAIN_FILE=... -DCMDIDE_INSTALLER_DEV=ON
     cmake --build cpp/build-dev --config Release --target cmdide-installer

4. New artifact paths (Windows):
   Old: app\build\bin\cmdIDE-windows-amd64.exe
        app\build\bin\cmdIDE-plugins-windows-amd64.exe
        app\build\bin\cmdIDE-installer-windows.exe
        app\build\bin\cmdIDE-installer-dev-windows.exe
   New: cpp\build\Release\cmdide.exe                (main app — rename from cmdide-host)
        cpp\build\Release\cmdide-installer.exe       (stable installer)
        cpp\build-dev\Release\cmdide-installer.exe   → copy as cmdide-installer-dev.exe

   Update all artifact references throughout build.ps1.

5. Frontend build
   The C++ asset codegen (Phase H.2) auto-runs as a CMake custom command, which depends on
   npm run build having been run first. Add a frontend build step before CMake:
     Set-Location app\frontend
     npm install
     npm run build
     Set-Location $PSScriptRoot
   Similarly for the installer frontend:
     Set-Location installer\windows\frontend
     npm install
     npm run build
     Set-Location $PSScriptRoot

6. Remove the cmdide-backend.exe build step (or keep it as optional for debug).
   Once the host is self-contained, the standalone backend binary is no longer needed.
   Add a comment explaining this.

7. Verify step at the end of build.ps1:
   Update the artifact verification to check for the new artifact names:
     Test-Path "cpp\build\Release\cmdide.exe"
     Test-Path "cpp\build\Release\cmdide-installer.exe"
     Test-Path "cpp\build-dev\Release\cmdide-installer.exe"
   Fail loudly if any expected artifact is missing.

Verification:
  ./build.ps1 on Windows completes without error and produces:
    cpp/build/Release/cmdide.exe
    cpp/build/Release/cmdide-installer.exe
    cpp/build-dev/Release/cmdide-installer.exe (rename to cmdide-installer-dev.exe)

Git commits — commit after each of the following milestones:
  1. Frontend build steps added; wails build calls removed:
       git commit -m "build: remove wails build steps; add npm frontend build to build.ps1"
  2. CMake host + installer targets build correctly via build.ps1:
       git commit -m "build: build C++ host and installer via CMake in build.ps1"
  3. Dev installer built with CMDIDE_INSTALLER_DEV flag:
       git commit -m "build: produce both stable and dev C++ installer binaries"
  4. Artifact verification updated:
       git commit -m "build: update artifact verification for C++ binary names"
  5. git push:
       git push
```

### Effects
- `build.ps1`: `wails build` calls removed; CMake host and installer builds added
- `build.ps1`: frontend npm build steps added before CMake
- `build.ps1`: artifact paths and verification updated

---

## Prompt M.2 — Platform Packaging

```
Context: terminal-IDE. build.ps1 now builds the C++ binaries. We need to package them
correctly for each platform: Windows (portable exe + optional archive), macOS (.app + DMG),
Linux (tar.gz + optional AppImage).

Task: Update build.ps1 to produce platform-appropriate packages.

Read before coding:
  - build.ps1 (current state after M.1)
  - .github/workflows/release.yml (current packaging steps — we replicate these in build.ps1)
  - installer/windows/main.go (current window config; not needed after migration, but useful
    for understanding what the installer looked like)

Requirements:

1. Windows packaging
   The main deliverable is cmdide.exe — a single portable executable.
   a. Embed app manifest (DPI-awareness, UAC level "asInvoker", Windows 10+ compatibility):
      Add app.manifest to cpp/host/ and link via resources.rc (if not already done in J.3).
   b. Version info: embed ProductVersion, FileVersion, ProductName, CompanyName in the .rc.
   c. Code signing: if CMDIDE_SIGN_CERT env var is set, sign with signtool (same as current
      release.yml). Otherwise skip (local builds are unsigned).
   d. Create a zip archive: Compress-Archive containing cmdide.exe + cmdide-installer.exe +
      cmdide-installer-dev.exe → cmdIDE-windows-amd64.zip
   e. No NSIS/WiX installer is required — the standalone cmdide-installer.exe serves this role.

2. macOS packaging
   a. .app bundle structure:
        cmdIDE.app/
          Contents/
            Info.plist
            MacOS/
              cmdide             ← the executable
            Resources/
              AppIcon.icns
              www/               ← extracted frontend assets (or let the binary extract them)
   b. Info.plist values:
        CFBundleName:            cmdIDE
        CFBundleDisplayName:     cmdIDE
        CFBundleIdentifier:      com.cmdide.app
        CFBundleVersion:         <version>
        CFBundleShortVersionString: <version>
        CFBundleExecutable:      cmdide
        CFBundleIconFile:        AppIcon
        NSHighResolutionCapable: true
        LSMinimumSystemVersion:  12.0
   c. Code signing: if APPLE_CERT env var is set, codesign --deep --sign "$APPLE_CERT" cmdIDE.app
      Otherwise: codesign --deep --sign - (ad-hoc signing, same as current release.yml)
   d. DMG creation: use create-dmg (already used in current release.yml).
        create-dmg --volname "cmdIDE" --window-size 600 400 \
          --icon-size 100 --app-drop-link 450 180 \
          "cmdIDE-macos-arm64.dmg" "cmdIDE.app"
   e. Also package the installer: cmdide-installer.app bundle with the same structure.

3. Linux packaging
   a. Portable tar.gz:
        tar.gz structure:
          cmdide-linux-amd64/
            cmdide             ← executable
            www/               ← frontend assets
            cmdide.desktop     ← .desktop file
            cmdide-installer   ← installer binary
        Create: tar -czf cmdIDE-linux-amd64.tar.gz cmdide-linux-amd64/
   b. .desktop file (cmdide.desktop):
        [Desktop Entry]
        Name=cmdIDE
        Exec=/opt/cmdide/cmdide
        Icon=/opt/cmdide/icon.png
        Type=Application
        Categories=Development;
        Terminal=false
   c. AppImage (optional, if appimagetool is available):
        Create an AppDir structure, run appimagetool to produce cmdIDE-linux-x86_64.AppImage.
        AppImages are self-contained and include WebKitGTK dependencies.
        Skip if appimagetool is not installed — tar.gz is the primary deliverable.

4. Artifact summary table
   Print at the end of build.ps1 (or in the verify step):
     Windows: cmdIDE-windows-amd64.zip (contains cmdide.exe + installers)
     macOS:   cmdIDE-macos-arm64.dmg, cmdIDE-macos-x86_64.dmg
     Linux:   cmdIDE-linux-amd64.tar.gz, cmdIDE-linux-x86_64.AppImage (optional)

Git commits — commit after each of the following milestones:
  1. Windows packaging — zip archive with manifest and version info:
       git commit -m "build: Windows packaging — zip archive with manifest and version info"
  2. macOS packaging — .app bundle and DMG creation:
       git commit -m "build: macOS packaging — .app bundle with Info.plist and DMG"
  3. Linux packaging — tar.gz with .desktop file:
       git commit -m "build: Linux packaging — tar.gz with .desktop file"
  4. git push:
       git push
```

### Effects
- `build.ps1`: platform packaging for Windows, macOS, Linux
- `cpp/host/resources.rc` (or .manifest): DPI awareness, version info, UAC level
- `cpp/host/Info.plist`: macOS bundle metadata
- `cmdide.desktop`: Linux .desktop file

---

## Prompt M.3 — Update CI/CD Workflows

```
Context: terminal-IDE. The GitHub Actions workflows reference Go toolchain, Wails build
commands, and old artifact names. After the C++ migration, Go and Wails are no longer needed.

Task: Update all workflow files to build and verify the C++ artifacts.

Read before coding:
  - .github/workflows/code-quality.yml   (REQUIRED — read completely)
  - .github/workflows/release.yml        (REQUIRED — read completely)
  - .github/workflows/build-matrix.yml   (read completely)
  - Any other .yml files in .github/workflows/ (list and read them)
  - build.ps1 (current state after M.2 — the CI builds via build.ps1)

Requirements:

1. .github/workflows/code-quality.yml

   Remove:
     - actions/setup-go step
     - go vet ./... step
     - go test ./... step
     - Any wails setup step (wails install, etc.)
     - Any reference to app/ Go directory

   Add:
     - C++ build dependencies:
         Windows: Visual Studio Build Tools or MSVC (usually pre-installed on windows-latest)
         macOS:   brew install ninja cmake (if not pre-installed)
         Linux:   apt-get install ninja-build cmake libgtk-3-dev libwebkit2gtk-4.1-dev
                  (WebKitGTK for Linux builds)
     - vcpkg setup: use actions/github-script or a dedicated vcpkg action to bootstrap vcpkg
         git clone https://github.com/microsoft/vcpkg && ./vcpkg/bootstrap-vcpkg.sh
         or use ilammy/setup-nasm + lukka/run-vcpkg action
     - Frontend build:
         npm install && npm run build in app/frontend/
         npm install && npm run build in installer/windows/frontend/
     - C++ build: cmake -B cpp/build -S cpp -DCMAKE_TOOLCHAIN_FILE=<vcpkg> && cmake --build
     - TypeScript type check: npx tsc --noEmit in app/frontend/

   Update "Verify build outputs" step:
     Replace old artifact paths with new ones:
       cpp/build/Release/cmdide.exe (or platform equivalent)
       cpp/build/Release/cmdide-installer.exe
       cpp/build-dev/Release/cmdide-installer.exe

2. .github/workflows/release.yml

   Remove:
     - Go setup action (actions/setup-go)
     - Wails setup action
     - wails build calls
     - Go-specific signing steps that reference .exe paths of the Wails output

   Update Windows job:
     - Run ./build.ps1 to produce artifacts (as the single build command)
     - Sign: signtool sign artifacts at the new paths
     - Upload: cmdIDE-windows-amd64.zip

   Update macOS job:
     - Install cmake, ninja, vcpkg, webview deps
     - Run ./build.ps1 (or equivalent shell script if build.ps1 uses PowerShell-only syntax)
       Note: build.ps1 uses PowerShell; on macOS install pwsh:
         brew install powershell && pwsh ./build.ps1
       Or create a build.sh that mirrors build.ps1 logic for macOS/Linux.
     - Sign: codesign step at updated .app path
     - Create DMG: create-dmg step
     - Upload: cmdIDE-macos-arm64.dmg and cmdIDE-macos-x86_64.dmg

   Update Linux job:
     - apt-get install cmake ninja-build libgtk-3-dev libwebkit2gtk-4.1-dev libssl-dev
     - Run pwsh ./build.ps1 or build.sh
     - Upload: cmdIDE-linux-amd64.tar.gz

3. .github/workflows/build-matrix.yml

   Update the matrix:
     Remove: go-version entries
     Add/update: cmake-version, platform-specific WebKit deps
   Update build commands: replace wails build with cmake --build
   Update artifact verification: new binary names

4. Other workflows (lint.yml, pr-checks.yml, etc.)
   Scan for any Go-related steps (golangci-lint, go vet, etc.) and remove them.
   Update any artifact name references.

5. Add a C++ lint/static analysis step (optional but recommended):
   In code-quality.yml, add:
     - name: C++ static analysis
       run: |
         cmake --build cpp/build --config Release --target run-clang-tidy || true
   This is non-blocking (|| true) to avoid failing builds on warnings.

Git commits — commit after each of the following milestones:
  1. code-quality.yml updated — Go removed, C++ build added:
       git commit -m "ci: update code-quality workflow — remove Go/Wails, add C++ CMake build"
  2. release.yml updated — all three platform jobs updated:
       git commit -m "ci: update release workflow — C++ build pipeline for Windows/macOS/Linux"
  3. build-matrix.yml and other workflows updated:
       git commit -m "ci: update build-matrix and remaining workflows for C++ migration"
  4. git push and verify CI passes:
       git push
       # Wait for CI to run, verify all checks pass
```

### Effects
- `.github/workflows/code-quality.yml`: Go removed, C++ build added
- `.github/workflows/release.yml`: Wails build replaced with CMake + packaging
- `.github/workflows/build-matrix.yml`: updated for pure C++ builds
- All other workflow files: Go/Wails references removed

---

## Phase M Checklist

- [ ] `./build.ps1` on Windows produces `cmdide.exe`, `cmdide-installer.exe`, `cmdide-installer-dev.exe`
- [ ] `./build.ps1` on macOS produces `cmdIDE.app` and `.dmg`
- [ ] `./build.ps1` on Linux produces `cmdIDE-linux-amd64.tar.gz`
- [ ] The new artifact names match what the release workflow uploads
- [ ] `code-quality.yml` CI passes with no Go steps remaining
- [ ] `release.yml` produces and uploads artifacts for all 3 platforms
- [ ] No `go` or `wails` commands remain in any workflow file
- [ ] `git log --oneline` shows clean commits per milestone
- [ ] Branch pushed and CI green: `git push`
