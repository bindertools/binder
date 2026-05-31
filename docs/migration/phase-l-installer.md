# Phase L — Installer/Launcher Migration

## Overview

The installer (launcher) is currently a separate Wails v2 Go app in `installer/windows/`.
Phase L creates a C++ WebView replacement in `cpp/installer/` with the same frontend UI and
the same two-binary (stable / dev channel) model. The existing Go installer continues to build
until Phase N.

---

## Git Workflow

**Branch:** `feat/webview-migration` (already created)

Commit after each backbone milestone. Push after this phase: `git push`

---

## Prompt L.1 — C++ WebView Installer Scaffold

```
Context: terminal-IDE. The installer is a Wails v2 Go app in installer/windows/ that:
  - Shows a 460×330 frameless window
  - Has three screens: version picker, installing progress, complete
  - Fetches releases from GitHub, shows a version picker, downloads and installs
  - Produces two binaries: cmdIDE-installer-windows.exe (stable) and
    cmdIDE-installer-dev-windows.exe (stable + pre-release)

We are creating a C++ WebView replacement in cpp/installer/.
The same TSX frontend (installer/windows/frontend/src/) will be reused — we only change
how the C++ backend communicates with it.

Task: Create the C++ WebView installer scaffold.

Read before coding:
  - installer/windows/main.go   (Wails window config — window size, colours, frameless)
  - installer/windows/app.go    (all bound Go methods — we must replicate these in C++)
  - installer/windows/channel.go and channel_dev.go  (build flag pattern to replicate in C++)
  - cpp/host/main.cpp           (host pattern to follow)
  - cpp/host/assets.hpp         (asset serving infrastructure to reuse)

Requirements:

1. cpp/installer/CMakeLists.txt
   Target: cmdide-installer (WIN32 on Windows)
   Sources: main.cpp, installer.cpp (added in L.2)
   find_package(webview CONFIG REQUIRED)
   find_package(nlohmann_json CONFIG REQUIRED)
   find_package(spdlog CONFIG REQUIRED)
   find_package(httplib CONFIG REQUIRED)
   target_link_libraries(cmdide-installer PRIVATE webview::core nlohmann_json::nlohmann_json
                                                   spdlog::spdlog httplib::httplib)
   Windows: link WebView2Loader, winhttp (or use cpp-httplib with OpenSSL from K.4)

   Build flag for dev channel:
     option(CMDIDE_INSTALLER_DEV "Include pre-release versions" OFF)
     if(CMDIDE_INSTALLER_DEV)
       target_compile_definitions(cmdide-installer PRIVATE CMDIDE_INSTALLER_DEV=1)
     endif()

   Add to cpp/CMakeLists.txt: add_subdirectory(installer)

2. cpp/installer/channel.hpp
   #ifdef CMDIDE_INSTALLER_DEV
   constexpr bool kIncludePrerelease = true;
   #else
   constexpr bool kIncludePrerelease = false;
   #endif

3. cpp/installer/main.cpp — window scaffold
   Same pattern as cpp/host/main.cpp but with installer-specific settings:
     webview::webview wv(false, nullptr);
     wv.set_title("cmdIDE Installer");
     wv.set_size(460, 330, WEBVIEW_HINT_FIXED);  // fixed size, not resizable
   Frameless window (same technique as Phase J.1):
     Make it frameless, centered on screen, drop shadow.
     No drag region IPC needed — the full window is draggable.
   Load the installer frontend:
     Reuse ExtractAssets() and GetFrontendUrl() from cpp/host/assets.hpp.
     The installer has its own asset set: installer/windows/frontend/dist/.
     Create cpp/installer/assets.hpp that points to the installer dist/ for codegen.
   Register IPC (stub for now — full implementation in L.2):
     wv.bind("__cmdide_invoke", [stub returning not-yet-implemented], &installer_app);
   Run: wv.run();

4. Asset codegen for the installer
   Reuse the gen_assets.cmake script from Phase H.2, but point it at
   installer/windows/frontend/dist/ instead of app/frontend/dist/.
   Output: cpp/installer/generated/assets.cpp

5. Logging
   Log to %TEMP%\cmdide-installer.log (Windows) or /tmp/cmdide-installer.log (Unix).

Verification:
  - cmake --build cpp/build --config Release --target cmdide-installer
  - Running cmdide-installer.exe opens a 460×330 frameless window showing the installer UI.
  - The window is centered on screen.
  - The UI renders (three-screen flow visible; JS calls fail — expected at this stage).

Git commits — commit after each of the following milestones:
  1. cpp/installer/ scaffold compiles, window opens with installer UI:
       git commit -m "feat(installer): C++ WebView installer scaffold — window opens with UI"
  2. Both stable and dev targets build (cmake -DCMDIDE_INSTALLER_DEV=ON):
       git commit -m "feat(installer): add CMDIDE_INSTALLER_DEV compile flag for dev channel"
  3. git push:
       git push
```

### Effects
- `cpp/installer/CMakeLists.txt`: new installer target with dev-channel flag
- `cpp/installer/main.cpp`: WebView window scaffold (460×330, frameless, centered)
- `cpp/installer/channel.hpp`: compile-time `kIncludePrerelease` constant
- `cpp/CMakeLists.txt`: `add_subdirectory(installer)`

---

## Prompt L.2 — Port Installer Backend to C++

```
Context: terminal-IDE. The C++ installer window opens but IPC calls fail. The Go installer
backend (installer/windows/app.go) implements:
  GetReleases() []Release    — fetch GitHub releases, filter by channel
  GetChannel() string        — return "stable" or "dev"
  Install(version, createShortcut, installPlugins) — download + install
  LaunchAndClose()           — launch installed app, close installer
  CloseInstaller()           — close installer without launching

Task: Implement the installer backend in C++.

Read before coding:
  - installer/windows/app.go       (REQUIRED — read the complete implementation)
  - installer/windows/channel.go   (build flag — we replicate with kIncludePrerelease)
  - cpp/src/updater.hpp/cpp        (GitHub API calling pattern to reuse)
  - cpp/installer/channel.hpp      (from L.1)
  - cpp/installer/main.cpp         (current state from L.1)

Requirements:

1. cpp/installer/installer.hpp
   class InstallerApp {
   public:
     explicit InstallerApp(webview::webview& wv);

     // Called from IPC dispatch:
     void GetReleases(const std::string& seq);
     void GetChannel(const std::string& seq);
     void Install(const std::string& seq, const std::string& version,
                  bool createShortcut, bool installPlugins);
     void LaunchAndClose(const std::string& seq);
     void CloseInstaller(const std::string& seq);

   private:
     webview::webview& wv_;
     std::vector<Release> releases_cache_;
     void emit_progress(int pct, const std::string& msg);
   };

   struct Release {
     std::string version;
     std::string name;
     std::string published_at;
     bool prerelease;
     std::string download_url;
     std::string plugins_download_url; // URL for plugins binary if present in assets
     std::string release_notes;
   };

2. cpp/installer/installer.cpp — implementation

   GetReleases():
     Call GitHub releases API: GET https://api.github.com/repos/<owner>/<repo>/releases
     Set User-Agent: "cmdIDE-installer/1.0"
     Parse JSON response with nlohmann-json into vector<Release>
     Filter: if !kIncludePrerelease, exclude entries where prerelease == true
     For each release, find the appropriate download asset:
       Windows: asset ending in "-windows.exe" or "-windows-amd64.exe"
       macOS: asset ending in "-darwin.dmg" or "-macos.dmg"
       Linux: asset ending in "-linux.tar.gz" or "-linux-amd64.tar.gz"
     Cache in releases_cache_
     Resolve IPC with JSON array of Release objects.

   GetChannel():
     Resolve with "dev" if kIncludePrerelease, else "stable".

   Install():
     Emit progress events at the same percentages as the Go implementation:
       5%   "Preparing"
       10%  "Fetching release info"
       15%–90% "Downloading <version> (<downloaded>MB / <total>MB)"
       92%  "Verifying download"
       95%  "Installing"
       98%  "Creating shortcut" (if requested)
       100% "Installation complete"

     Download the binary from Release.download_url using cpp-httplib with streaming:
       httplib::SSLClient cli(host);
       auto res = cli.Get(path, [&](const char* data, size_t len) {
         // write to file, update progress
         return true;
       });
     Write to a temporary file, then move to the install directory.

     Install directory (platform-specific):
       Windows:  %LOCALAPPDATA%\Programs\cmdIDE\
       macOS:    ~/Applications/cmdIDE.app (or run the DMG + mount + copy)
       Linux:    ~/.local/bin/cmdide

     Windows extras (matching the Go implementation):
       Register in HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\cmdIDE
         DisplayName, DisplayVersion, InstallLocation, UninstallString, Publisher, URLInfoAbout
       Create desktop shortcut (if createShortcut): write .lnk file to %USERPROFILE%\Desktop
         Use IShellLink COM API (same pattern as the Go implementation in app.go)
       Write uninstall script: uninstall.ps1 in the install directory

     Optional plugins download (if installPlugins):
       Download the plugins binary from Release.plugins_download_url to the install directory.

     Resolve IPC with {ok: true} on success, {ok: false, error: ...} on failure.
     Run the download+install on a std::thread so the main thread is not blocked.

   LaunchAndClose():
     Windows: ShellExecuteW to launch the installed exe, then wv_.dispatch([&]{wv_.terminate();})
     macOS/Linux: platform open command, then terminate.

   CloseInstaller():
     wv_.dispatch([&]{ wv_.terminate(); });

3. cpp/installer/main.cpp — wire up the IPC
   Register the __cmdide_invoke binding with a dispatcher that routes to InstallerApp:
     "installer.getReleases"  → app.GetReleases(seq)
     "installer.getChannel"   → app.GetChannel(seq)
     "installer.install"      → app.Install(seq, version, createShortcut, installPlugins)
     "installer.launch"       → app.LaunchAndClose(seq)
     "installer.close"        → app.CloseInstaller(seq)

4. Progress events
   The Go code uses Wails EventsEmit("install:progress", {pct, msg}).
   In C++, push via emit():
     emit_progress(pct, msg) calls:
       wv_.dispatch([this, pct, msg]{
         std::string js = "window.__cmdide_emit('install:progress'," +
                           nlohmann::json{{"pct",pct},{"msg",msg}}.dump() + ")";
         wv_.eval(js);
       });

Verification:
  - Open cmdide-installer.exe (stable build): version picker loads releases from GitHub.
  - Filter: no pre-release versions shown.
  - Open cmdide-installer-dev.exe (dev build): pre-release versions included.
  - Click Install: progress bar animates from 5% to 100%.
  - After install: launch button appears.
  - Uninstall entry visible in Windows Settings > Apps.

Git commits — commit after each of the following milestones:
  1. GetReleases() returns filtered releases from GitHub:
       git commit -m "feat(installer): C++ GetReleases — fetches GitHub releases with channel filter"
  2. Install() downloads with progress events:
       git commit -m "feat(installer): C++ Install() downloads with streaming progress events"
  3. Shortcut, registry, and uninstall script written on Windows:
       git commit -m "feat(installer): Windows install — registry entry, shortcut, uninstall script"
  4. LaunchAndClose and CloseInstaller working:
       git commit -m "feat(installer): LaunchAndClose and CloseInstaller implemented"
  5. git push:
       git push
```

### Effects
- `cpp/installer/installer.hpp/cpp`: full installer backend
- `cpp/installer/main.cpp`: IPC dispatch wired to InstallerApp

---

## Prompt L.3 — Update Installer Frontend for New IPC

```
Context: terminal-IDE. The installer frontend (installer/windows/frontend/src/) currently calls
window.go.main.App.* (Wails bindings). The C++ installer uses window.__cmdide_invoke() instead.

Task: Update the installer frontend to use the new IPC, matching the type names registered
in the C++ dispatcher from L.2.

Read before coding:
  - installer/windows/frontend/src/  (read ALL source files — understand the full component tree)
  - The three-screen UI flow:
      Screen 1: GetReleases() + GetChannel()
      Screen 2: Install() progress events
      Screen 3: LaunchAndClose() / CloseInstaller()
  - The Wails event names used: "install:progress", "installer:error"
  - cpp/installer/main.cpp IPC type names (from L.2): installer.getReleases, etc.

Requirements:

1. Create installer/windows/frontend/src/lib/ipc.ts
   Copy from app/frontend/src/lib/ipc.ts (created in Phase I.1).
   This gives the installer its own ipc.ts (same code, separate copy to avoid cross-module deps).

2. Create installer/windows/frontend/src/lib/wails-shim.ts
   Map the installer's Wails bound methods to IPC:
     window.go.main.App.GetReleases     → invoke("installer.getReleases")
     window.go.main.App.GetChannel      → invoke("installer.getChannel")
     window.go.main.App.Install         → invoke("installer.install", {version, createShortcut, installPlugins})
     window.go.main.App.LaunchAndClose  → invoke("installer.launch")
     window.go.main.App.CloseInstaller  → invoke("installer.close")
   Map Wails events:
     runtime.EventsOn("install:progress", cb) → on("install:progress", cb)
     runtime.EventsOn("installer:error", cb)  → on("installer:error", cb)

3. Update installer/windows/frontend/src/main.tsx
   Same conditional shim injection as app/frontend/src/main.tsx:
     import { isWebViewHost } from './lib/ipc'
     if (isWebViewHost()) {
       await import('./lib/wails-shim')
     }

4. Do NOT change any component logic — only the communication layer changes.
   The three-screen flow, progress bar, version picker, and all UI remain identical.

5. Build the installer frontend and verify:
   npm run build in installer/windows/frontend/
   The dist/ output is picked up by the C++ asset codegen (from L.1).

Verification:
  1. Open cmdide-installer.exe (C++ build) — full install flow works end-to-end.
  2. Open the Go/Wails installer (still builds from installer/windows/) — still works (regression).
  3. Screen 1: version list loads, channel badge shows correctly.
  4. Screen 2: progress bar animates during download.
  5. Screen 3: Launch and Close buttons work.
  6. Error banner appears if GitHub is unreachable.

Git commits — commit after each of the following milestones:
  1. ipc.ts and wails-shim.ts added to installer frontend:
       git commit -m "feat(installer): add IPC client and Wails shim to installer frontend"
  2. Conditional shim injection in installer main.tsx:
       git commit -m "refactor(installer-ui): inject Wails shim in C++ installer mode at startup"
  3. Full install flow verified in C++ installer:
       git commit -m "feat(installer): full install flow works in C++ WebView installer"
  4. git push:
       git push
```

### Effects
- `installer/windows/frontend/src/lib/ipc.ts`: new (copy of app frontend ipc.ts)
- `installer/windows/frontend/src/lib/wails-shim.ts`: maps installer Wails calls to IPC
- `installer/windows/frontend/src/main.tsx`: conditional shim injection
- Go/Wails installer unchanged; both builds work

---

## Phase L Checklist

- [ ] `cmake --build cpp/build --config Release --target cmdide-installer` succeeds
- [ ] `cmake --build cpp/build --config Release --target cmdide-installer -DCMDIDE_INSTALLER_DEV=ON` succeeds
- [ ] Stable installer: pre-releases not shown in version list
- [ ] Dev installer: pre-releases shown with "Pre-release" badge
- [ ] Install flow: progress bar goes from 5% to 100%
- [ ] After install: app binary present in platform install directory
- [ ] Windows: uninstall entry in Settings > Apps; desktop shortcut created (if selected)
- [ ] LaunchAndClose: launches the installed app and closes the installer window
- [ ] Error banner appears when GitHub API returns non-200
- [ ] Go/Wails installer still builds and works (regression)
- [ ] `git log --oneline` shows clean commits per milestone
- [ ] Branch pushed: `git push`
