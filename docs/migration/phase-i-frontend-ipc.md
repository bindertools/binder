# Phase I — Frontend IPC Migration

## Overview

Replaces Wails RPC bindings with the new `__cmdide_invoke` / `__cmdide_emit` IPC. By the end
of Phase I the C++ host runs all features end-to-end: terminal, file ops, config, search, ports,
perf, preview. The Wails app still builds and runs throughout this phase (both host paths
work simultaneously using a compatibility shim).

---

## Git Workflow

**Branch:** `feat/webview-migration` (already created)

Commit after each backbone milestone. Push after this phase: `git push`

---

## Prompt I.1 — TypeScript IPC Client

```
Context: terminal-IDE. The C++ WebView host (cpp/host/) exposes window.__cmdide_invoke() via
webview.bind and will push events via window.__cmdide_emit(). The frontend currently calls
window.go.main.App.* (Wails bindings). We need a clean TypeScript IPC layer before migrating
call sites.

Task: Create app/frontend/src/lib/ipc.ts — the low-level IPC client.

Read before coding:
  - app/frontend/src/main.tsx         (entry point — understand how the app initialises)
  - app/frontend/wailsjs/go/main/App.d.ts  (full list of Wails-bound methods we must replace)
  - app/frontend/wailsjs/runtime/runtime.d.ts  (Wails runtime APIs we must replace)

Requirements:

1. app/frontend/src/lib/ipc.ts

Type declarations (add to the file, not a separate .d.ts):
  declare global {
    interface Window {
      __cmdide_invoke?: (type: string, argsJson: string, reqId: string) => Promise<string>
      __cmdide_emit?: (event: string, dataJson: string) => void
    }
  }

  type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

Exported functions:

  export function isWebViewHost(): boolean
    Returns true if window.__cmdide_invoke is defined (C++ host mode).
    Returns false in Wails host mode.

  export async function invoke<T = unknown>(type: string, args: object = {}): Promise<T>
    If window.__cmdide_invoke is not defined: throw new Error("IPC not available")
    Call: const raw = await window.__cmdide_invoke(type, JSON.stringify(args), crypto.randomUUID())
    Parse: const result = JSON.parse(raw) as IpcResult<T>
    If result.ok === false: throw new Error(result.error)
    Return result.data

  export function on(event: string, handler: (data: unknown) => void): () => void
    Registers an event handler for C++ → JS events.
    Returns an unsubscribe function.
    Implements: maintain a Map<string, Set<handler>>

  export function off(event: string, handler: (data: unknown) => void): void
    Removes the handler.

Global setup (called once at module load, not exported):
  Define window.__cmdide_emit if it is not already defined:
    window.__cmdide_emit = (event: string, dataJson: string) => {
      const data = JSON.parse(dataJson)
      const handlers = _handlers.get(event)
      handlers?.forEach(h => h(data))
    }

2. app/frontend/src/lib/events.ts
   Re-export a typed version of on/off for the events the C++ backend emits:
   export type TerminalOutputEvent = { id: string; data: string }
   export type InstallProgressEvent = { pct: number; msg: string }
   // etc. for other events emitted by the backend

3. No call sites are changed in this prompt. The ipc.ts module is created only.

Verification:
  - TypeScript compiles with no errors: npm run build in app/frontend/
  - In the C++ host DevTools console, after the page loads:
      window.__cmdide_emit("test", JSON.stringify({hello: "world"}))
    Then: import('/src/lib/ipc.js') — or verify via the app that on() registrations work.
  - isWebViewHost() returns true in the C++ host, false in the Wails app.

Git commits — commit after each of the following milestones:
  1. ipc.ts and events.ts created, TypeScript compiles:
       git add app/frontend/src/lib/
       git commit -m "feat(frontend): add TypeScript IPC client — invoke/on/off for C++ host"
  2. git push:
       git push
```

### Effects
- `app/frontend/src/lib/ipc.ts`: new — `invoke<T>()`, `on()`, `off()`, `isWebViewHost()`
- `app/frontend/src/lib/events.ts`: new — typed event interfaces
- No existing files modified; no behaviour change in either host

---

## Prompt I.2 — Wails Compatibility Shim

```
Context: terminal-IDE. We have app/frontend/src/lib/ipc.ts. The frontend currently calls
window.go.main.App.* and window.runtime.* (Wails) across hundreds of call sites. Rather than
rewrite them all at once, we create a compatibility shim that makes those calls go through the
new IPC layer when running in the C++ host.

Task: Create a Wails compatibility shim and inject it for the C++ host.

Read before coding:
  - app/frontend/wailsjs/go/main/App.d.ts   (every Wails-bound method — shim ALL of them)
  - app/frontend/wailsjs/go/main/App.js     (the actual Wails JS implementation — understand how
                                              each method maps to a Go call so we can replicate)
  - app/frontend/wailsjs/runtime/runtime.d.ts (Wails runtime: EventsOn, EventsOff, EventsEmit,
                                               WindowSetTitle, WindowMinimise, etc.)
  - app/frontend/src/main.tsx               (entry point — where to inject the shim)

Requirements:

1. app/frontend/src/lib/wails-shim.ts

   This file patches window.go and window.runtime to route through ipc.ts.
   It is only applied when isWebViewHost() === true.

   window.go patching:
     window.go = {
       main: {
         App: {
           // Every method from App.d.ts, mapped to ipc.invoke():
           // The method name in Wails is typically the Go method name with same casing.
           // Map it to the IPC type used by the C++ dispatch table.
           // Example:
           SendCommand: (cmd: string) =>
             invoke("terminal.command", { cmd }),
           GetConfig: () =>
             invoke<AppConfig>("config.get", {}),
           SetConfig: (cfg: AppConfig) =>
             invoke("config.set", { config: cfg }),
           // ... all other methods
           GetCppBackendStatus: () =>
             invoke<string>("debug.version", {}),
         }
       }
     }

   window.runtime patching (Wails runtime):
     (window as any).runtime = {
       EventsOn: (event: string, cb: Function) => { on(event, cb as any) },
       EventsOff: (event: string, cb: Function) => { off(event, cb as any) },
       EventsEmit: (event: string, ...args: any[]) => {
         // C++ host doesn't support frontend-initiated events to Go — log and no-op
         console.warn("EventsEmit not supported in C++ host:", event, args)
       },
       WindowSetTitle: (title: string) =>
         invoke("window.setTitle", { title }),
       WindowMinimise: () =>
         invoke("window.minimise", {}),
       WindowMaximise: () =>
         invoke("window.maximise", {}),
       WindowUnmaximise: () =>
         invoke("window.unmaximise", {}),
       WindowToggleMaximise: () =>
         invoke("window.toggleMaximise", {}),
       WindowClose: () =>
         invoke("window.close", {}),
       WindowIsMaximised: () =>
         invoke<boolean>("window.isMaximised", {}),
       WindowIsMinimised: () =>
         invoke<boolean>("window.isMinimised", {}),
       BrowserOpenURL: (url: string) =>
         invoke("shell.openUrl", { url }),
       // Add any other runtime.* calls found in the codebase
     }

   IMPORTANT: Only map methods/events to IPC types that the C++ dispatch table actually handles.
   Check cpp/host/dispatch.cpp (stub from H.3) and cpp/src/main.cpp (Step 1 dispatch) to
   verify each type name. The type names must be IDENTICAL to what the C++ dispatcher expects.

2. app/frontend/src/main.tsx
   At the very top of the file (before any other imports that might call Wails):
     import { isWebViewHost } from './lib/ipc'
     if (isWebViewHost()) {
       await import('./lib/wails-shim')
     }
   NOTE: This uses a dynamic import to ensure the shim loads before any component calls Wails.
   If top-level await is not available in the build config, use an IIFE or move setup to a
   dedicated init() function called before ReactDOM.render.

3. Verify dual-host compatibility:
   - In the Wails app: window.go.main.App.* still goes through Wails (shim is not loaded).
   - In the C++ host: window.go.main.App.* goes through ipc.ts (shim is loaded).
   - Both should work for basic operations (the C++ dispatch is still a stub at this point —
     most calls will return "not yet implemented", which is expected).

Git commits — commit after each of the following milestones:
  1. wails-shim.ts created with all methods mapped:
       git add app/frontend/src/lib/wails-shim.ts
       git commit -m "feat(frontend): add Wails compatibility shim — routes App.* calls through new IPC"
  2. Shim injection in main.tsx:
       git commit -m "refactor(frontend): inject Wails shim in C++ host mode at startup"
  3. git push:
       git push
```

### Effects
- `app/frontend/src/lib/wails-shim.ts`: new — maps all `window.go.main.App.*` to `ipc.invoke()`
- `app/frontend/src/main.tsx`: conditional shim injection
- No change to Wails code paths; Wails app unchanged

---

## Prompt I.3 — Full C++ Dispatch Implementation

```
Context: terminal-IDE. The frontend calls window.__cmdide_invoke() which reaches
cpp/host/dispatch.cpp — currently a stub returning "not yet implemented". Now we wire the
Dispatcher to the actual backend modules so every feature works in the C++ host.

Task: Implement full IPC dispatch in cpp/host/dispatch.cpp, mirroring the logic in
cpp/src/main.cpp (the old named-pipe dispatch loop from Step 1).

Read before coding:
  - cpp/src/main.cpp (REQUIRED — this is the source of truth for every IPC type and its
    handling. Read it completely before writing dispatch.cpp.)
  - cpp/src/terminal.hpp, fileops.hpp, config.hpp, search.hpp, sysinfo.hpp,
    preview.hpp, session.hpp, pack.hpp, updater.hpp
    (read the public APIs — dispatch.cpp calls these directly)
  - cpp/host/dispatch.hpp, cpp/host/dispatch.cpp (current stub state)
  - app/frontend/src/lib/wails-shim.ts (verify IPC type names match exactly)

Requirements:

1. cpp/host/dispatch.cpp — full implementation

   The Dispatcher class holds references/instances of all backend modules:
     Terminal registry (unordered_map<string, Terminal>)
     FileOps instance
     Config instance
     Search instance
     SysInfo instance
     Preview instance
     Session instance
     Pack instance
     Updater instance

   Dispatcher::dispatch() implements a switch/if-else on the type string, calling the
   appropriate backend module and resolving with the result JSON. The logic must be
   FUNCTIONALLY IDENTICAL to the dispatch table in cpp/src/main.cpp — copy the
   handling per message type, adjusting only:
     - Remove IPC read/write — replace with direct function calls
     - Instead of writing to the pipe: call wv_.resolve(seq, 0, result.dump())
     - For async operations (terminal output, preview server events): use std::async or
       std::thread, then call wv_.dispatch([]{...}) when done

   Handle every message type that exists in cpp/src/main.cpp:
     ping, shutdown, debug.version
     terminal.start, terminal.write, terminal.resize, terminal.stop, terminal.list
     fileops.readdir, fileops.readfile, fileops.writefile, fileops.delete, fileops.rename,
     fileops.mkdir, fileops.stat, fileops.exists
     config.get, config.set, config.getAll, config.reset
     search.files, search.content
     sysinfo.ports, sysinfo.perf, sysinfo.processes
     preview.start, preview.stop, preview.url
     session.save, session.load, session.list, session.delete
     pack.create
     updater.check, updater.download, updater.install

   For terminal output events: when the Terminal calls its output callback, call
   emit("terminal.output", {id: termId, data: base64_data}). Use the emit() method
   from Phase H.3 which safely dispatches to the main thread.

   Handle window management types (added for the shim):
     window.setTitle    → wv_.dispatch([&]{ wv_.set_title(title); }); resolve ok
     window.minimise    → platform-specific (Phase J) — resolve ok for now (no-op)
     window.maximise    → platform-specific (Phase J) — resolve ok for now (no-op)
     window.close       → wv_.dispatch([&]{ wv_.terminate(); }); resolve ok
     shell.openUrl      → platform open URL (ShellExecuteW on Windows, open/xdg-open on Unix)

2. cpp/host/CMakeLists.txt
   Ensure dispatch.cpp is in the sources list.
   Link cmdide-host against cmdide-backend-lib (already set up in H.1).

3. Thread safety
   The webview event loop runs on the main thread. All backend module calls in dispatch()
   run on worker threads (via std::async). Never call wv_.eval() or wv_.resolve() directly
   from a worker thread — always use wv_.dispatch().
   Exception: wv_.resolve() IS thread-safe in webview/webview — check the library docs.
   If thread-safe, resolve can be called directly; emit must still use dispatch.

4. Logging
   Keep the same spdlog logging style as cpp/src/main.cpp:
     spdlog::info("IPC dispatch: type={}", type);
     spdlog::error("IPC dispatch error: type={} error={}", type, e.what());

Read before coding:
  cpp/src/main.cpp — read this file in full. Every dispatch case must be replicated.

Verification — test each feature category in the C++ host window:
  Terminal:
    - Open a terminal session — shell spawns, output appears, input works
    - Resize works (no garbled output after resize)
    - Multiple terminal sessions work simultaneously
  File ops:
    - File explorer loads directory listings
    - Open a file in the editor (readfile)
    - Save a file (writefile)
  Config:
    - Settings panel opens and shows current config
    - Changing a setting persists after reload
  Search:
    - File search returns results
    - Content search (ripgrep) returns results
  Sysinfo:
    - Ports panel shows open ports
    - Perf panel shows CPU/memory metrics
  Preview:
    - Preview panel renders a Markdown file as HTML
  Session:
    - Session saves and restores
  Pack:
    - /pack command creates a zip archive
  Updater:
    - Update check runs without error (may return "up to date")

Git commits — commit after each feature category is verified:
  1. Terminal fully working in C++ host:
       git commit -m "feat(host): wire terminal dispatch — ConPTY terminal works in WebView host"
  2. File ops, config, search working:
       git commit -m "feat(host): wire fileops/config/search dispatch — editor and explorer work"
  3. Sysinfo, preview, session, pack working:
       git commit -m "feat(host): wire sysinfo/preview/session/pack dispatch — all panels work"
  4. Updater and window management wired:
       git commit -m "feat(host): wire updater and window management — all IPC types dispatched"
  5. git push:
       git push
```

### Effects
- `cpp/host/dispatch.cpp`: full implementation — all IPC types handled
- `cpp/host/main.cpp`: Dispatcher instantiated with all backend modules
- All features work end-to-end in the C++ host window

---

## Phase I Checklist

- [ ] TypeScript compiles with no errors after ipc.ts and wails-shim.ts are added
- [ ] `isWebViewHost()` returns `true` in C++ host, `false` in Wails app
- [ ] All features work in the C++ host: terminal, file ops, config, search, ports, perf, preview, session, pack
- [ ] All features still work in the Wails app (regression test)
- [ ] Terminal output events stream in real-time (no buffering delays)
- [ ] Multiple concurrent terminal sessions work
- [ ] `git log --oneline` shows one commit per feature category
- [ ] Branch pushed: `git push`
