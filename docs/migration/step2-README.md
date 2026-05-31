# terminal-IDE Migration Roadmap — Step 2 ✅ COMPLETE
## Go + Wails + C++ → C++ + WebView + TSX (Final)

Step 1 (Phases 0–5, F, G) is complete. The C++ backend handles all features; Go/Wails is a thin
host. Step 2 eliminates Go and Wails entirely: a native C++ host embeds WebView2 (Windows),
WKWebView (macOS), or WebKitGTK (Linux) directly. The TSX frontend is unchanged. The installer
(launcher) migrates from its own Go/Wails app to a C++/WebView app.

---

## Phase Map

## Phase Map — Step 2 Status

| File | Phase | Prompts | Status | What changed |
|------|-------|---------|--------|--------------|
| [phase-h-webview-host.md](phase-h-webview-host.md) | H — WebView Host | 3 | ✅ | vcpkg webview, C++ window, frontend assets, IPC skeleton |
| [phase-i-frontend-ipc.md](phase-i-frontend-ipc.md) | I — Frontend IPC | 3 | ✅ | TS IPC client, Wails shim, full C++ dispatch |
| [phase-j-native-window.md](phase-j-native-window.md) | J — Native Window | 3 | ✅ | Frameless drag, GDI splash, jump list + single-instance |
| [phase-k-crossplatform.md](phase-k-crossplatform.md) | K — Cross-Platform | 4 | ✅ | forkpty terminal, config paths, sysinfo guards, cpp-httplib |
| [phase-l-installer.md](phase-l-installer.md) | L — Installer | 3 | ✅ | C++ WebView installer scaffold + backend + IPC shim |
| [phase-m-build.md](phase-m-build.md) | M — Build & CI/CD | 3 | ✅ | build.ps1 CMake-only, platform packaging, CI updated |
| [phase-n-retirement.md](phase-n-retirement.md) | N — Go Retirement | 2 | ✅ | All Go/Wails code deleted; pure C++/WebView/TSX |

**Total: 21 prompts across 7 phases.**

> **Prerequisites:** All Phase 0–5, F, G checklist items green on `feat/cpp-migration`.
> The C++ backend is the only backend path (no Go fallback anywhere).
> `feat/webview-migration` branches directly off `feat/cpp-migration` — nothing merges to
> `main` until the entire migration (Step 1 + Step 2) is complete at the end of Phase N.

---

## Git Workflow

**New branch off `feat/cpp-migration`:**
```
git checkout feat/cpp-migration
git checkout -b feat/webview-migration
git push -u origin feat/webview-migration
```

**Commit after every backbone milestone** listed in each prompt's **Git commits** section.
Push after every phase so CI catches regressions early.

**Commit message prefixes:**
```
feat(host):       new C++ WebView host code
feat(installer):  installer migration
refactor(frontend): frontend IPC or shim changes
build:            CMakeLists, build.ps1, vcpkg changes
ci:               GitHub Actions workflow changes
docs:             migration docs
chore:            Go removal, file deletion, cleanup
```

---

## Execution Rules

1. **Complete phases in order** (H → I → J → K → L → M → N).
2. **One prompt per session.** Each prompt is scoped to a single reviewable unit.
3. **The Wails app must stay buildable through Phase M.** Do not delete Go code until Phase N.
4. **Read before writing.** Every prompt that touches existing code says "Read before coding."
5. **Phase N is irreversible.** Run it only when the C++ host has been stable for several days
   and all features are verified working through the full Phase M build pipeline.

---

## Architecture Change Summary

### What changes at the host level

| Layer | Step 1 (current) | Step 2 (target) |
|-------|-----------------|-----------------|
| Desktop host | Wails v2 (Go) | C++ (`cpp/host/`) |
| Window | Wails WebView2/WKWebView | `webview::webview` |
| IPC: frontend → backend | `window.go.main.App.*` → Go → named pipe → C++ | `window.__cmdide_invoke()` (webview bind) → C++ directly |
| IPC: backend → frontend | `runtime.EventsEmit` (Go) → Wails bridge → JS | `webview.dispatch` + `webview.eval` → JS |
| Backend process | Separate `cmdide-backend.exe` | Same process as host (`cpp/src/` linked in) |
| Installer | Wails Go app in `installer/windows/` | C++ WebView app in `cpp/installer/` |
| Build | `wails build` + CMake | CMake only |

### New directory layout

```
cpp/
  src/          ← backend modules (unchanged from Step 1)
    terminal.hpp/cpp
    fileops.hpp/cpp
    config.hpp/cpp
    search.hpp/cpp
    sysinfo.hpp/cpp
    preview.hpp/cpp
    session.hpp/cpp
    pack.hpp/cpp
    updater.hpp/cpp
    base64.hpp
  host/         ← NEW: C++ WebView host application
    CMakeLists.txt
    main.cpp
    dispatch.cpp
    assets.hpp
    splash_windows.cpp   (ported from app/splash_windows.go)
    jumplist_windows.cpp (ported from app/jumplist_windows.go)
  installer/    ← NEW: C++ WebView installer application
    CMakeLists.txt
    main.cpp
    installer.cpp
    channel.hpp
```

---

## IPC Protocol Reference

### Frontend → C++ (request)

The frontend calls the `webview`-bound function:
```js
// JS (TypeScript, via ipc.ts invoke())
const result = await window.__cmdide_invoke(type, argsJson, reqId)
// Returns Promise<string> (JSON-encoded IpcResult)
```

In C++:
```cpp
wv.bind("__cmdide_invoke",
  [](const std::string& seq, const std::string& req, void* arg) {
    // seq: webview's internal promise sequence ID
    // req: JSON array ["type", "argsJson", "reqId"]
    auto host = static_cast<Host*>(arg);
    auto arr  = nlohmann::json::parse(req);
    host->dispatch(seq, arr[0], arr[1]);  // async OK — resolve later
  }, this);

// After operation completes (any thread):
nlohmann::json result = {{"ok", true}, {"data", payload}};
wv_.resolve(seq, 0, result.dump());  // resolves the JS Promise
```

### C++ → frontend (event)

```cpp
// From any thread — push event to JS
void emit_event(const std::string& event, const nlohmann::json& data) {
  std::string js = "window.__cmdide_emit('" + event + "'," + data.dump() + ")";
  wv_.dispatch([this, js] { wv_.eval(js); });
}
```

```typescript
// JS — registered by ipc.ts
window.__cmdide_emit = (event: string, dataJson: string) => { ... }
```

### IpcResult envelope

Every C++ response uses this envelope:
```json
{ "ok": true,  "data": <payload> }
{ "ok": false, "error": "<message>" }
```

### Message types

All the same IPC types from Step 1 are preserved (terminal.*, fileops.*, config.*, search.*,
sysinfo.*, preview.*, session.*, pack.*, updater.*) — the dispatch table moves from
`cpp/src/main.cpp` (which handled the named-pipe loop) to `cpp/host/dispatch.cpp`.

---

## Technology Stack (post-Step-2)

| Layer | Technology |
|-------|-----------|
| Desktop host | C++17 + `webview/webview` |
| Window (Windows) | WebView2 via `webview/webview` |
| Window (macOS) | WKWebView via `webview/webview` |
| Window (Linux) | WebKitGTK via `webview/webview` |
| IPC | `webview.bind` / `webview.resolve` / `webview.eval` |
| Backend | C++17, CMake, vcpkg (same as Step 1) |
| Terminal (Windows) | ConPTY |
| Terminal (macOS/Linux) | forkpty + execvp |
| HTTP | cpp-httplib (preview + updater, replaces WinHTTP) |
| Markdown | cmark |
| JSON | nlohmann-json |
| Logging | spdlog |
| Database | SQLite |
| Zip | libzip |
| Frontend | React + TypeScript (TSX) — unchanged |
| CSS | Tailwind CSS v4 — unchanged |
| Build | build.ps1 (CMake only, no Wails) |
