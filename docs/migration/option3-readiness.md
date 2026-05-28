# Option 3 Readiness Assessment — C++ + WebView2 Host

**Date:** 2026-05-27  
**Branch:** `feat/cpp-migration` (post Phase 5.1)  
**Status:** Go is now a thin Wails host. All domain logic lives in the C++ backend.

---

## 1. What Go Still Does

The following is the complete inventory of Go code that would need a C++ equivalent before Wails can be dropped. Each item is classified:

- **(a) Trivially replaceable** — pure IPC wrapper, no new logic needed
- **(b) Needs webview API equivalent** — uses a Wails runtime call (dialog, event, clipboard, window)
- **(c) Requires custom implementation** — non-trivial C++ work

### 1.1 App Lifecycle

| Function | Classification | Notes |
|---|---|---|
| `NewApp()` | (a) | Struct init; becomes C++ constructor |
| `startup(ctx)` | (a) | Launch C++ bridge, call `config.Init` — already done by C++ |
| `domReady(ctx)` | (b) | Calls `WindowExecJS` to inject Tab key handler and close splash |
| `shutdown(ctx)` | (a) | Sends `shutdown` IPC to C++ backend; trivial in C++ |
| `resolveCppBackend()` | — | Disappears entirely — C++ host embeds the backend |
| `initCppPreview()`, `initCppPack()` | — | Disappears — function vars replaced by direct C++ calls |

### 1.2 Wails-Bound RPC Methods

**All-IPC wrappers — trivially replaceable (a):**

`ExplorerOpen`, `ExplorerGetTree`, `ExplorerGetFile`, `ExplorerSaveFile`, `ExplorerCreateFile`, `ExplorerCreateDir`, `ExplorerRename`, `ExplorerDelete`, `ExplorerMove`, `ReadFile`, `WriteFile`, `DeleteFile`, `SearchFiles`, `GetCompletions`, `SaveSession`, `LoadSession`, `GetAppConfig`, `SaveCustomTheme`, `SaveAppConfig`, `GetSystemPorts`, `GetSystemPerf`, `CheckForUpdate`, `GetCppBackendStatus`

These methods are already thin wrappers around `a.cpp.RoundTrip`. In Option 3 the C++ host calls the same backend directly over the same named pipe — no translation needed.

**Methods using Wails APIs — need webview equivalent (b):**

| Method | Wails call | Webview/Win32 equivalent |
|---|---|---|
| `SelectDirectory()` | `OpenDirectoryDialog` | `IFileOpenDialog` COM API |
| `GetClipboardText()` | `ClipboardGetText` | `OpenClipboard` / `GetClipboardData` Win32 |
| `SetClipboardText()` | `ClipboardSetText` | `OpenClipboard` / `SetClipboardData` Win32 |
| `StartPerfMonitor()` | `EventsEmit` (loop) | `webview.Eval` / `postMessage` to frontend |
| `PerformUpdate()` | `wailsruntime.Quit` | `DestroyWindow` / `PostQuitMessage` |
| `domReady` | `WindowExecJS` | `ICoreWebView2.ExecuteScript` |

**Methods requiring custom C++ work (c):**

| Method | Notes |
|---|---|
| `ExecSilent()` | `CreateProcess` + pipe capture; ~50 lines |
| `ExplorerReveal()` | `ShellExecuteW(L"explore", ...)` ; ~5 lines |
| `OpenNewWindow()` | `CreateProcess` on own exe; ~10 lines |
| `CtrlClickPath()` | Path stat + dispatch — logic is plain, but needs the postMessage bridge for the event emission part |
| `ReadDatabase()` | SQLite read; C++ already has sqlite3 — add a `db.read` IPC message |
| `FetchExternalPlugin()` | WinHTTP GET + JSON parse; identical pattern to updater.cpp |
| `ScanProblems()` | Runs `go vet` / `tsc --noEmit` as subprocesses and parses stdout. ~200 lines of C++ with `CreateProcess` + pipe |
| `KillPort()` | `TerminateProcess` + netstat — sysinfo.cpp already has port/PID mapping |

### 1.3 Terminal Built-in Commands

Every `builtin*` method in `terminal.go` (cd, ls, /pack, /config, /preview, /problems, etc.) emits events via `wailsruntime.EventsEmit`. None use native OS APIs beyond `exec.Command` for `git` and `explorer.exe`.

In Option 3, each `wailsruntime.EventsEmit(ctx, "event:name", payload)` becomes a call to `ICoreWebView2.PostWebMessageAsJson(payload_with_event_name)`. This is mechanical and can be wrapped in a one-line C++ helper:

```cpp
void emit(const std::string& event, const json& payload) {
    json msg = {{"__event", event}, {"data", payload}};
    webview_->PostWebMessageAsJson(to_wstr(msg.dump()).c_str());
}
```

---

## 2. Wails-Specific API Surface

Every `wailsruntime.*` call remaining in the codebase after Phase 5.1:

| Wails call | Location | WebView2 / Win32 equivalent | Effort |
|---|---|---|---|
| `EventsEmit(ctx, name, data)` | app.go, terminal.go (23 callsites) | `ICoreWebView2::PostWebMessageAsJson` | One C++ helper, then mechanical substitution |
| `WindowExecJS(ctx, script)` | app.go (domReady) | `ICoreWebView2::ExecuteScript` | Direct 1:1 replacement |
| `OpenDirectoryDialog(ctx, opts)` | app.go (SelectDirectory) | `IFileOpenDialog` COM, ~40 lines | Moderate |
| `ClipboardGetText(ctx)` | app.go | `OpenClipboard` + `GetClipboardData(CF_UNICODETEXT)` | ~20 lines |
| `ClipboardSetText(ctx, text)` | app.go | `OpenClipboard` + `SetClipboardData` | ~20 lines |
| `Quit(ctx)` | update_windows.go | `PostMessage(hwnd, WM_CLOSE, 0, 0)` | 1 line |

**Wails RPC bridge** (`window.go.main.App.*`): Wails auto-generates TypeScript bindings that the frontend uses to call Go methods. This is the largest conceptual gap — see Section 3.

---

## 3. Frontend Changes Required

### 3.1 Current frontend interface

The frontend calls Go methods via Wails-generated bindings:

```typescript
// Wails auto-generated (frontend/wailsjs/go/main/App.js)
import { ReadFile, WriteFile, SearchFiles, ... } from '../wailsjs/go/main/App';

// Usage throughout the frontend:
const content = await ReadFile(path);
await WriteFile(path, content);
const results = await SearchFiles(terminalId, query);
```

Events are received via the Wails runtime:

```typescript
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime';
EventsOn('terminal:output:' + id, (data) => xterm.write(data));
```

### 3.2 What needs to change

In Option 3, the C++ host is the message broker. The frontend posts messages to C++ and receives them back via `window.chrome.webview.addEventListener('message', ...)`.

**Required shim layer** (`frontend/src/bridge/`):

```
bridge/
  rpc.ts          — promisified request/response over postMessage (replaces Wails RPC)
  events.ts       — EventsOn/EventsOff/EventsEmit shim over postMessage
  index.ts        — drop-in re-export so existing import paths still work
```

**`rpc.ts` sketch:**

```typescript
const pending = new Map<string, { resolve: Function, reject: Function }>();
let seq = 0;

window.chrome.webview.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.__rpc_id) {
    const p = pending.get(msg.__rpc_id);
    if (p) { p.resolve(msg.result); pending.delete(msg.__rpc_id); }
  } else if (msg.__event) {
    eventBus.emit(msg.__event, msg.data);
  }
});

export function call<T>(method: string, ...args: any[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `r${seq++}`;
    pending.set(id, { resolve, reject });
    window.chrome.webview.postMessage(JSON.stringify({ __rpc_id: id, method, args }));
  });
}
```

**`events.ts` sketch:**

```typescript
const listeners = new Map<string, Set<Function>>();

export const EventsOn = (event: string, cb: Function) => { ... };
export const EventsOff = (event: string, cb: Function) => { ... };
```

**`wailsjs/` shim:** The Wails-generated `frontend/wailsjs/go/main/App.js` file is consumed throughout the frontend. Each export must be remapped to call `rpc.call('MethodName', ...args)`.

```typescript
// frontend/wailsjs/go/main/App.ts (generated shim, replaces Wails output)
import { call } from '../../src/bridge/rpc';

export const ReadFile    = (path: string) => call<string>('ReadFile', path);
export const WriteFile   = (path: string, content: string) => call<void>('WriteFile', path, content);
export const SearchFiles = (id: string, query: string) => call<SearchResult[]>('SearchFiles', id, query);
// ... one line per bound method (~45 total)
```

**Estimated size:**
- `rpc.ts` + `events.ts`: ~150 lines
- `wailsjs/go/main/App.ts` shim: ~60 lines (one per method)
- `wailsjs/runtime/runtime.ts` shim: ~50 lines (EventsOn, EventsOff, Quit, etc.)
- **Total: ~260 lines of TypeScript**

No frontend component files need to change — imports stay the same. The shim is a drop-in replacement for Wails' generated output.

---

## 4. Build System Changes

### 4.1 Current build

```powershell
# build.ps1 (simplified)
wails build -platform windows/amd64 `
  -ldflags "-X 'main.AppVersion=$version'" `
  -o dist/cmdIDE-windows-amd64.exe
```

Wails bundles the frontend (via embedded FS) and the Go binary into a single PE executable. The C++ backend (`cmdide-backend.exe`) is a separate artifact placed alongside it.

### 4.2 Option 3 build

The Wails build step disappears. Instead:

**Step 1 — Frontend bundle (unchanged):**
```powershell
cd app/frontend && npm run build  # outputs frontend/dist/
```

**Step 2 — Embed frontend into Windows resource:**
```powershell
# New: compile frontend/dist/ into a .res file (RC script)
rc.exe /fo build/frontend.res cpp/resources/frontend.rc
```

`frontend.rc` would list every file in `frontend/dist/` as a `RCDATA` resource, or (simpler) use a single ZIP resource that the C++ host extracts at startup to a temp directory and serves via the existing cpp-httplib preview server.

**Step 3 — Build C++ host + backend:**
```powershell
cmake --build build --config Release --target cmdIDE cmdide-backend
```

New CMake target `cmdIDE` (the webview2 host):
- `cpp/src/webview_host.cpp` — main, window creation, WebView2 init, RPC bridge
- Links: `WebView2LoaderStatic.lib`, `Ole32.lib`, `Shell32.lib`, `winhttp.lib`
- Embeds: `build/frontend.res`

**CI workflow changes (`.github/workflows/`):**

| Current | Option 3 |
|---|---|
| `actions/setup-go` | Remove |
| `wails build` step | Remove |
| Add `cmake --build` step | Already present (builds C++ backend) |
| Add `rc.exe` / resource step | New |
| Artifact: `cmdIDE-windows-amd64.exe` | Same name, different producer |

**Approximate files to change:**
- `build.ps1` — replace wails build section (~20 lines changed)
- `.github/workflows/release.yml` — remove Go setup, add resource compilation (~15 lines)
- `cpp/CMakeLists.txt` — add `cmdIDE` webview host target (~50 lines)
- New: `cpp/src/webview_host.cpp` (~300 lines)
- New: `cpp/resources/frontend.rc` (~20 lines)

---

## 5. Estimated Effort

| Work item | Days | Unknowns |
|---|---|---|
| C++ WebView2 host (`webview_host.cpp`) — window, init, message loop | 2 | WebView2 COM initialization in this project's build env |
| C++ RPC bridge — route frontend calls to IPC backend, emit events | 1.5 | None; pattern is identical to existing IPC bridge |
| Frontend shim (`rpc.ts`, `events.ts`, `App.ts` shim) | 1.5 | None; mechanical |
| Win32 replacements (clipboard, `IFileOpenDialog`, `ShellExecuteW`) | 0.5 | None |
| `ScanProblems` C++ port (subprocess + stdout parse) | 1 | Go-specific linter output format |
| `ReadDatabase` IPC message + C++ handler | 0.5 | None; sqlite3 already linked |
| Resource embedding + build system changes | 1 | Frontend assets as RC resources vs temp-dir extraction |
| End-to-end testing (all features, CI green) | 3 | Surface area is large |
| **Total** | **11 days** | Spike first to validate WebView2 init |

---

## 6. Go / No-Go Recommendation

**Recommendation: Go — proceed to Option 3, but spike WebView2 first.**

### Rationale

**The codebase is ready.** After Phase 5.1:
- Zero domain logic remains in Go.
- The C++ backend implements 100% of the product's features (terminal, file ops, search, preview, session, pack, update).
- Go is a 50-method thin shim: 45 IPC wrappers + 6 terminal event emitters + 3 Wails dialog/clipboard calls.
- The `go-pty`, `creack/pty`, and `u-root` dependencies are already gone. The Go module is minimal.

**The migration is mechanical.** Every Wails `EventsEmit` maps to `PostWebMessageAsJson`. Every Wails RPC binding maps to a one-line TypeScript shim. There are no architectural surprises.

**The main risk is WebView2 initialization.** Wails wraps WebView2 and handles environment setup, user data folder, and the `--webview-gpu-disabled` workarounds automatically. A custom WebView2 host must replicate this. The risk is low but non-zero — some machines have WebView2 in unusual states (corporate GPO, outdated runtime). **Recommended: build a 2-day prototype (`webview_host.cpp` + hello-world frontend) before committing to the full migration.**

### Blockers (none are showstoppers)

1. **WebView2 init prototype** — must validate before full commitment. Estimated 2 days to build and test on 3 representative machines.
2. **`IFileOpenDialog` on all Windows versions** — works on Windows 10+; this app already requires Windows 10 for WebView2. Non-issue.
3. **Splash screen** — currently a separate native window launched by Go before Wails starts. Must be reimplemented in C++ (a `CreateWindow` + bitmap paint, ~50 lines).

### Decision record

- [ ] Proceed to Option 3 spike (2 days, output: `webview_host.cpp` prototype)
- [ ] Stay on Option 1 (Wails) and iterate features

*Record the decision here once made.*
