# Phase G — Dual Launcher

## Overview

The current installer (`installer/`) is a **bundled installer**: it embeds a fixed `cmdIDE.exe`
binary at compile time and simply copies it to `%LOCALAPPDATA%\cmdIDE\`. There is no version
list, no GitHub API call, and `GetReleases()` returns an empty slice.

This phase redesigns it into a **live release downloader**: it fetches available versions from
the GitHub releases API, shows them in a version-picker UI, and downloads the chosen build. Two
binaries are produced from the same source code with a single compile-time flag:

| Binary | GitHub filter | Audience |
|--------|--------------|----------|
| `cmdIDE-installer-windows.exe` | Stable releases only (`prerelease: false`) | End users |
| `cmdIDE-installer-dev-windows.exe` | All releases (stable + pre-release) | Developers / testers |

This phase is **independent of the C++ backend migration** (Phases 0–5) and can run at any time.

---

## Git Workflow

**Branch:** create a dedicated branch for this work:
```
git checkout -b feat/dual-launcher
```
Merge into `main` (or `feat/cpp-migration`) when complete. Push after the phase: `git push -u origin feat/dual-launcher`

---

## Prompt G.1 — Installer Backend: GitHub Releases API

```
Context: terminal-IDE. The installer lives at installer/embedded/ and is a separate Wails v2 Go
module. Currently installer/embedded/app.go embeds cmdIDE.exe at compile time and GetReleases()
returns an empty slice. We want to replace this with a live GitHub releases downloader.

Task: Rewrite installer/embedded/app.go to fetch and install releases from GitHub.

Read before coding:
  - installer/embedded/app.go   (current implementation — understand what to preserve)
  - app/update.go               (already calls the GitHub releases API — reuse the same endpoint
                                 URL and version-parsing logic; do not duplicate, extract a shared
                                 helper if possible)

Requirements:

1. Build flag
   Add a Go file installer/embedded/channel.go:
     //go:build !dev
     package main
     const IncludePrerelease = false

   And installer/embedded/channel_dev.go:
     //go:build dev
     package main
     const IncludePrerelease = true

   The standard build uses no tag; the developer build is compiled with -tags dev.

2. Release type
   Define a struct in app.go:
     type Release struct {
       Version     string `json:"version"`
       Name        string `json:"name"`
       PublishedAt string `json:"publishedAt"`
       Prerelease  bool   `json:"prerelease"`
       DownloadURL string `json:"downloadUrl"`
       ReleaseNotes string `json:"releaseNotes"`
     }

3. GetReleases() []Release
   - Call the GitHub releases API (same endpoint as app/update.go)
   - Set a User-Agent header: "cmdIDE-installer/<version>"
   - Parse the JSON response
   - Filter: if IncludePrerelease == false, exclude any release where prerelease == true
   - Return releases sorted newest first (the API already returns them this way)
   - On network error or non-200 response, return an empty slice and emit an
     "installer:error" Wails event with the error message

4. Install(version string, createShortcut bool, installPlugins bool) error
   - Look up the Release matching version from the last GetReleases() response (cache it)
   - Download the .exe asset from Release.DownloadURL using net/http with progress tracking
   - Emit "install:progress" events (pct int, msg string) at meaningful intervals:
       5%   Preparing
       10%  Fetching release info
       15%–90% Downloading <version> (<downloaded>MB / <total>MB)
       92%  Verifying download
       95%  Installing
       98%  Creating shortcut (if requested)
       100% Installation complete
   - Write the downloaded binary to filepath.Join(GetInstallDir(), "cmdIDE.exe")
   - The optional installPlugins bool: if true, also download cmdIDE-plugins-windows-amd64.exe
     from the same release assets and write to GetInstallDir()
   - Keep createDesktopShortcut unchanged

5. Remove the //go:embed assets/cmdIDE.exe line and the appBinary variable entirely.
   The assets/ directory and embedded binary are no longer needed.

6. GetChannel() string — new bound method
   Returns "stable" if IncludePrerelease == false, "dev" if true.
   Used by the frontend to show a "Developer Channel" badge.

Constraint: go build ./... must pass for both:
  go build ./...                  (standard — IncludePrerelease = false)
  go build -tags dev ./...        (developer — IncludePrerelease = true)

Git commits — commit after each of the following milestones:
  1. channel.go and channel_dev.go added; both build tags compile:
       git add installer/embedded/channel.go installer/embedded/channel_dev.go
       git commit -m "feat(installer): add IncludePrerelease build flag for stable/dev channels"
  2. GetReleases() fetches and filters GitHub releases correctly:
       git commit -m "feat(installer): implement live GitHub release fetching with channel filter"
  3. Install() downloads with progress events; embedded binary removed:
       git commit -m "feat(installer): replace embedded binary with GitHub release downloader"
  4. GetChannel() bound method added:
       git commit -m "feat(installer): add GetChannel() bound method for frontend channel badge"
```

### Effects
- `installer/embedded/channel.go`, `installer/embedded/channel_dev.go`: build-flag constants
- `installer/embedded/app.go`: `GetReleases()`, `Install()`, `GetChannel()` rewritten
- `installer/assets/cmdIDE.exe` and the `//go:embed` line: removed
- Both build tags produce a working binary

---

## Prompt G.2 — Installer Frontend: Version Picker UI

```
Context: terminal-IDE installer. The backend (installer/embedded/app.go) now has:
  GetReleases() []Release  — returns available versions, filtered by channel
  Install(version, createShortcut, installPlugins)  — downloads and installs
  GetChannel() string  — returns "stable" or "dev"
  LaunchAndClose()     — launches the installed app and quits the installer
  CloseInstaller()     — quits without launching

The installer frontend lives at installer/frontend/. It is a Wails v2 TSX app. We need to redesign
the UI to show the version picker and download progress.

Task: Redesign the installer frontend.

Design constraints (match the main app's dark theme):
  Background:   #0d0d0f  (existing BackgroundColour in main.go)
  Surface:      #1c1c1e
  Accent:       #0A84FF
  Text:         #f5f5f7
  Text muted:   #8e8e93
  Font:         system-ui, -apple-system, sans-serif
  Window size:  460×330 (fixed, frameless — do not change)

UI layout — three screens, rendered in a single-page component:

Screen 1 — Welcome / version picker (shown on load)
  - cmdIDE logo/wordmark centred at top (reuse existing SVGs from frontend/dist/)
  - If GetChannel() returns "dev": show a small "Developer Channel" badge next to the logo
  - "Select version" label
  - Dropdown or scrollable list of releases from GetReleases():
      Each item shows: version tag, release name, date (formatted "May 28 2026"), Prerelease badge
      if prerelease: true
  - Two checkboxes: "Create desktop shortcut" (default: true), "Install plugins" (default: true)
  - Primary button: "Install" — disabled until a version is selected
  - Secondary link: "Cancel"

Screen 2 — Installing (shown while Install() is running)
  - Same logo at top
  - Progress bar (thin, accent colour, animated fill)
  - Status message (from "install:progress" event msg field)
  - Percentage label
  - No buttons (non-cancellable during download)

Screen 3 — Complete (shown when Install() resolves)
  - Checkmark icon (accent colour)
  - "cmdIDE <version> installed"
  - Primary button: "Launch cmdIDE" — calls LaunchAndClose()
  - Secondary link: "Close" — calls CloseInstaller()

Wails event to listen for: "install:progress" (pct: number, msg: string)
Wails event to listen for: "installer:error" (message: string) — show an inline error banner,
  return to Screen 1

Bind calls to use:
  window.go.main.App.GetReleases()
  window.go.main.App.GetChannel()
  window.go.main.App.Install(version, createShortcut, installPlugins)
  window.go.main.App.LaunchAndClose()
  window.go.main.App.CloseInstaller()

Git commits — commit after each of the following milestones:
  1. Welcome screen renders with version list and both checkboxes:
       git commit -m "feat(installer-ui): add version picker with release list and install options"
  2. Install flow wired — progress bar updates, Screen 2 shows during download:
       git commit -m "feat(installer-ui): wire install progress bar and status messages"
  3. Complete screen with Launch/Close actions:
       git commit -m "feat(installer-ui): add post-install complete screen with launch action"
  4. Developer channel badge shown when GetChannel() returns dev:
       git commit -m "feat(installer-ui): show Developer Channel badge for dev builds"
  5. Error banner shown on installer:error event:
       git commit -m "feat(installer-ui): add inline error banner for network/install failures"
```

### Effects
- `installer/frontend/src/`: UI rewritten with three-screen flow
- No changes to installer Go backend in this prompt

---

## Prompt G.3 — Build System: Two Launcher Binaries

```
Context: terminal-IDE installer. The installer backend uses a -tags dev build flag to include
pre-release versions (IncludePrerelease = true) vs. stable only (IncludePrerelease = false).
We need build.ps1 and the CI workflow to produce both binaries.

Task: Update build.ps1 and .github/workflows/code-quality.yml to build and verify both installer
binaries.

build.ps1 changes:
  The installer is currently built with something like:
    wails build ... -o cmdIDE-installer-windows.exe
  Replace with two sequential builds:

    # Standard installer (stable releases only)
    wails build -platform windows/amd64 `
      -o app\build\bin\cmdIDE-installer-windows.exe `
      -ldflags "-X main.Version=$version"

    # Developer installer (stable + pre-release)
    wails build -platform windows/amd64 `
      -tags dev `
      -o app\build\bin\cmdIDE-installer-dev-windows.exe `
      -ldflags "-X main.Version=$version"

  Both are built from installer/embedded/ — adjust the working directory accordingly.
  Read the existing build.ps1 carefully to understand the current wails build invocation,
  then replicate the flags exactly for both builds, only changing -tags and -o.

.github/workflows/code-quality.yml changes:
  The "Verify build outputs" step currently checks for cmdIDE-installer-windows.exe.
  Add cmdIDE-installer-dev-windows.exe to the expected outputs list.

No other files need to change.

Git commits — commit after each of the following milestones:
  1. build.ps1 builds both binaries locally without error:
       git commit -m "build: produce both stable and dev installer binaries from build.ps1"
  2. CI workflow updated to verify both artifacts:
       git commit -m "ci: add cmdIDE-installer-dev-windows.exe to expected build outputs"
  3. Push the branch and open a PR:
       git push
```

### Effects
- `build.ps1`: two sequential `wails build` calls for standard and dev installer
- `.github/workflows/code-quality.yml`: dev installer added to artifact verification list
- Release artifacts: `cmdIDE-installer-windows.exe` + `cmdIDE-installer-dev-windows.exe`

---

## Phase G Checklist

- [ ] `go build ./...` (no tags) produces standard installer — `GetReleases()` omits pre-releases
- [ ] `go build -tags dev ./...` produces dev installer — `GetReleases()` includes pre-releases
- [ ] Version picker UI shows release list with dates and pre-release badges
- [ ] Install flow downloads correct binary, shows progress, reaches 100%
- [ ] Desktop shortcut and plugins checkboxes work
- [ ] "Launch cmdIDE" on the complete screen launches the app and closes the installer
- [ ] Error banner appears when GitHub API is unreachable
- [ ] `build.ps1` produces both binaries in one run
- [ ] CI "Verify build outputs" passes with both artifacts present
- [ ] `git log --oneline` shows a clean commit per milestone
- [ ] Branch pushed and PR opened for review
