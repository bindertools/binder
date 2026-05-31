# Phase H — C++ WebView Host

## Overview

Scaffolds the C++ WebView host application that will replace Go/Wails as the desktop host.
By the end of Phase H you have a working `cmdide-host` binary (alongside the still-building
Wails app) that opens a window, loads the frontend UI, and proves a round-trip IPC call via
the browser console. No Go code is modified.

---

## Git Workflow

**Branch:** `feat/webview-migration` (created off `feat/cpp-migration`)

Commit after each backbone milestone in each prompt's **Git commits** section.
Push after this phase completes: `git push`

---

## Prompt H.1 — WebView Host Scaffold

```
Context: terminal-IDE. Step 1 of the C++ migration is complete on the feat/cpp-migration branch.
The C++ backend (cpp/src/) handles all features; Go/Wails is the thin host. We are now starting
Step 2: building a native C++ WebView host to replace Go/Wails entirely. The C++ code lives in
cpp/. We will create a new cpp/host/ subdirectory for the host application. The Wails app must
continue to build throughout this phase — do not modify any Go files.

Task: Create the C++ WebView host scaffold.

WebView library: webview/webview (vcpkg name: "webview"). This library wraps:
  - WebView2 on Windows (Chromium-based, requires WebView2 runtime)
  - WKWebView on macOS
  - WebKitGTK on Linux
Key APIs:
  webview::webview wv(debug, nullptr)   — create instance (debug=true shows DevTools)
  wv.set_title(title)                   — set window title
  wv.set_size(w, h, WEBVIEW_HINT_NONE)  — set window size
  wv.navigate(url)                      — navigate to URL
  wv.run()                              — start event loop (blocking)
  wv.bind(name, callback, arg)          — expose C++ function to JS
  wv.resolve(seq, status, result)       — resolve a pending bind call
  wv.eval(js)                           — execute JS in the page
  wv.dispatch(fn)                       — run fn on the main thread (thread-safe)
  wv.get_native_handle(kind)            — get platform handle

Requirements:

1. Add to cpp/vcpkg.json:
   "webview" to the dependencies array.
   On Windows, webview depends on the WebView2 SDK — vcpkg will pull it automatically.

2. Create cpp/host/CMakeLists.txt:
   - Target: cmdide-host (WIN32 executable on Windows, plain executable on macOS/Linux)
   - Sources: main.cpp (add others as needed in later prompts)
   - find_package(webview CONFIG REQUIRED)
   - target_link_libraries(cmdide-host PRIVATE webview::core)
   - Windows-only: also link the backend modules (cpp/src/) — add them as a static library
     target cmdide-backend-lib in cpp/CMakeLists.txt so both the old cmdide-backend.exe and
     the new cmdide-host can link against it.
   - Set C++ standard to C++17.
   - On Windows: add WIN32_LEAN_AND_MEAN, NOMINMAX, UNICODE definitions.
   - Copy WebView2Loader.dll to the output directory post-build (webview vcpkg provides it).

3. Create cpp/host/main.cpp:
   #include <webview/webview.h>
   int main() {
     webview::webview wv(false, nullptr);
     wv.set_title("cmdIDE");
     wv.set_size(1280, 800, WEBVIEW_HINT_NONE);
     wv.navigate("about:blank");
     wv.run();
     return 0;
   }
   On Windows, use WinMain / wWinMain instead of main (required for WIN32 subsystem):
   #include <windows.h>
   int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) { ... }

4. Update cpp/CMakeLists.txt:
   - Extract the existing sources into a static library target cmdide-backend-lib
     (all cpp/src/*.cpp except the old main.cpp which stays as cmdide-backend.exe entry point).
   - Add: add_subdirectory(host)
   - Verify cmdide-backend.exe still links cmdide-backend-lib + main.cpp.

5. Update build.ps1:
   After the existing cmake --build step for cmdide-backend.exe, add a step that also builds
   the cmdide-host target:
     cmake --build cpp/build --config Release --target cmdide-host
   Artifact path: cpp/build/Release/cmdide-host.exe (Windows) or cpp/build/cmdide-host (Unix).
   Do NOT remove the existing Wails build steps — Wails app must still build.

6. .gitignore: no changes needed (cpp/build/ is already ignored).

Verification:
  cmake --build cpp/build --config Release --target cmdide-host
  Running cmdide-host.exe opens a blank window with title "cmdIDE". Close it with Alt+F4.

Git commits — commit after each of the following milestones:
  1. vcpkg.json updated, cpp/host/ sources written, CMake configure succeeds:
       git add cpp/vcpkg.json cpp/host/ cpp/CMakeLists.txt
       git commit -m "feat(host): scaffold C++ WebView host target with webview/webview"
  2. cmake --build succeeds and blank window opens:
       git commit -m "feat(host): blank WebView window opens — host binary compiles and runs"
  3. build.ps1 updated:
       git commit -m "build: add cmdide-host to build.ps1 alongside existing Wails build"
  4. git push:
       git push
```

### Effects
- `cpp/vcpkg.json`: `webview` added to dependencies
- `cpp/CMakeLists.txt`: `cmdide-backend-lib` static library extracted; `add_subdirectory(host)`
- `cpp/host/CMakeLists.txt`, `cpp/host/main.cpp`: new host target
- `build.ps1`: cmdide-host build step appended
- No Go/Wails files modified

---

## Prompt H.2 — Load Frontend Assets

```
Context: terminal-IDE. The C++ WebView host (cpp/host/main.cpp) opens a blank window.
Now we need it to load the actual frontend UI (app/frontend/dist/).

Task: Implement asset bundling and serving so the C++ host displays the frontend.

Strategy: Embed the contents of app/frontend/dist/ as binary data in the C++ executable.
At startup, extract to a temp directory and navigate the WebView to index.html.

On Windows, use WebView2's SetVirtualHostNameToFolderMapping so the page loads on
"https://app.local/index.html" instead of file://, enabling service workers and
avoiding file:// CORS restrictions.

Requirements:

1. CMake asset codegen
   In cpp/host/CMakeLists.txt, add a custom command that runs at build time:
     - Input: app/frontend/dist/ (all files recursively)
     - Output: cpp/host/generated/assets.cpp
     - Tool: a small Python or CMake script (cpp/host/gen_assets.cmake or gen_assets.py)
       that reads every file in dist/, base64-encodes it, and writes a C++ source file:

       // generated/assets.cpp (AUTO-GENERATED — do not edit)
       #include "assets_data.hpp"
       const EmbeddedFile kEmbeddedFiles[] = {
         { "index.html", /* base64 */ "PCFkb2N0eXBlI...", 12345 },
         { "assets/index-XXX.js", "...", 98765 },
         ...
         { nullptr, nullptr, 0 }
       };

       // assets_data.hpp
       struct EmbeddedFile { const char* path; const char* b64; size_t size; };
       extern const EmbeddedFile kEmbeddedFiles[];

   Use CMake's configure_depends to re-run when dist/ changes.

2. Create cpp/host/assets.hpp:
   Functions:
     std::string ExtractAssets();
       Iterates kEmbeddedFiles[], base64-decodes each entry, writes to:
         Windows: %TEMP%\cmdide-webview\<hash-of-build-id>\<path>
         macOS:   $TMPDIR/cmdide-webview/<hash>/<path>
         Linux:   /tmp/cmdide-webview/<hash>/<path>
       Creates intermediate directories. Returns the extracted root directory path.
       On subsequent runs (same hash), skip extraction if files already exist.

     std::string GetFrontendUrl(const std::string& extractedRoot);
       Windows: registers the virtual host and returns "https://app.local/index.html"
         - Access ICoreWebView2Controller via wv.get_native_handle(WEBVIEW_NATIVE_HANDLE_KIND_BROWSER)
         - QI to ICoreWebView2, then to ICoreWebView2_3
         - Call SetVirtualHostNameToFolderMapping(L"app.local", <wide_root>,
             COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW)
         - Returns "https://app.local/index.html"
         NOTE: GetFrontendUrl must be called AFTER wv.run() has started (use wv.dispatch on first
         navigation). Use a one-shot dispatch to call it after the WebView is ready.
       macOS/Linux: returns "file://" + extractedRoot + "/index.html"

     std::string GetDevUrl();
       Returns "http://localhost:5173" — used in debug builds when CMDIDE_DEV=1 env var is set.

3. Update cpp/host/main.cpp:
   - Call ExtractAssets() before starting the event loop.
   - On Windows: defer virtual host registration to after the event loop starts.
     Set a bool flag; call wv.dispatch([&]{ RegisterAndNavigate(); }) to run it on the
     main thread after wv.run() starts.
   - Navigate to the frontend URL.
   - If CMDIDE_DEV env var is set, navigate to http://localhost:5173 instead (dev mode).
   - Enable debug mode (first arg to webview::webview constructor) in Debug builds.

4. Add cpp/host/base64_decode.hpp (or reuse cpp/src/base64.hpp if it has a decode function).
   The generated assets.cpp uses base64 encoding; we need a decode function at runtime.

Read before coding:
  - cpp/src/base64.hpp — check if it already has a decode function (reuse if so)
  - app/frontend/dist/ — list the files present to understand the asset set
  - cpp/host/main.cpp — current state (from H.1)

Verification:
  1. cmake --build produces cmdide-host.exe with embedded assets.
  2. Running cmdide-host.exe opens a window showing the cmdIDE frontend UI.
  3. The UI renders (CSS loads, components mount — JS calls to window.go.* will fail, which is expected).
  4. Browser DevTools (Ctrl+Shift+I when debug=true) show no 404s for assets.

Git commits — commit after each of the following milestones:
  1. Asset codegen script and generated assets.cpp in place:
       git add cpp/host/gen_assets.cmake cpp/host/assets.hpp cpp/host/assets_data.hpp
       git commit -m "feat(host): add CMake asset codegen — embed frontend dist/ as C++ byte arrays"
  2. Extraction and navigation working — frontend UI visible:
       git commit -m "feat(host): extract and serve frontend assets — UI renders in WebView window"
  3. git push:
       git push
```

### Effects
- `cpp/host/gen_assets.cmake` (or `.py`): build-time codegen script
- `cpp/host/assets.hpp`: `ExtractAssets()`, `GetFrontendUrl()`, `GetDevUrl()`
- `cpp/host/generated/assets.cpp`: auto-generated, in .gitignore
- `cpp/host/main.cpp`: updated to extract assets and navigate
- `.gitignore`: `cpp/host/generated/` excluded

---

## Prompt H.3 — IPC Bind/Eval Skeleton

```
Context: terminal-IDE. The C++ WebView host loads the frontend UI. The frontend tries to call
window.go.main.App.* (Wails bindings) which fail because Go/Wails is not running. In this
prompt we register the new IPC entry point so the frontend can communicate with C++, and
verify a round-trip from the browser console. Full dispatch is implemented in Phase I.3.

Task: Register the __cmdide_invoke binding and a stub dispatcher; prove round-trip IPC works.

IPC contract:
  JS calls:   window.__cmdide_invoke(type, argsJson, reqId) → Promise<string>
  C++ sees:   seq (webview internal), req = JSON array [type, argsJson, reqId]
  C++ calls:  wv.resolve(seq, 0, resultJson) to fulfill the Promise
  JS also needs: window.__cmdide_emit(event, dataJson) — a plain function that C++ can call
                 via wv.eval() to push events. The frontend (Phase I.1) will define this.

Requirements:

1. Create cpp/host/dispatch.hpp and cpp/host/dispatch.cpp:
   class Dispatcher {
   public:
     explicit Dispatcher(webview::webview& wv);
     // Called from the bind callback — dispatches on a thread pool, resolves via wv.resolve
     void dispatch(const std::string& seq,
                   const std::string& type,
                   const std::string& args_json);
     // Push an event to the frontend
     void emit(const std::string& event, const nlohmann::json& data);
   private:
     webview::webview& wv_;
     // thread pool or std::thread per request (use std::async for now)
   };

   In dispatch(), for this stub phase:
     - Log the call: spdlog::info("IPC: type={} args={}", type, args_json)
     - Return a stub response: {"ok": false, "error": "not yet implemented: <type>"}
     - Exception: "ping" type should respond {"ok": true, "data": "pong"}
     - Call wv_.resolve(seq, 0, response.dump())
     NOTE: vw.resolve is thread-safe in webview/webview — can call from any thread.

   In emit(), call:
     std::string js = "if(window.__cmdide_emit){window.__cmdide_emit('" +
                       event + "'," + data.dump() + ")}";
     wv_.dispatch([this, js]{ wv_.eval(js); });

2. Update cpp/host/main.cpp:
   - Instantiate Dispatcher after creating wv.
   - Register the binding:
       wv.bind("__cmdide_invoke",
         [](const std::string& seq, const std::string& req, void* arg) {
           auto* d = static_cast<Dispatcher*>(arg);
           auto arr = nlohmann::json::parse(req);
           d->dispatch(seq, arr[0].get<std::string>(), arr[1].get<std::string>());
         }, &dispatcher);
   - The binding must be registered BEFORE wv.run().

3. Update cpp/host/CMakeLists.txt:
   Add dispatch.cpp to the cmdide-host sources.

4. Suppress Wails binding errors in the browser console:
   After registering __cmdide_invoke, also register a no-op placeholder for
   window.go so existing Wails calls fail silently instead of throwing:
     wv.init("window.go = window.go || new Proxy({}, {get: (_,k) => new Proxy(function(){},{
       get: (_,k2) => new Proxy(function(){},{
         get: (_,k3) => () => Promise.reject('Wails not available in C++ host')
       })
     })});");
   This allows the frontend to load without console errors from Wails call sites
   (the full fix is in Phase I).

Read before coding:
  - cpp/host/main.cpp (current state after H.2)
  - cpp/src/main.cpp (existing message dispatch logic — Dispatcher will eventually mirror this)

Verification:
  1. Open cmdide-host.exe with debug=true (DevTools enabled).
  2. In the DevTools console, run:
       window.__cmdide_invoke("ping", "{}", "test-1").then(console.log)
     Expected output: '{"ok":true,"data":"pong"}'
  3. Run:
       window.__cmdide_invoke("unknown", "{}", "test-2").then(console.log)
     Expected: '{"ok":false,"error":"not yet implemented: unknown"}'
  4. No Wails-related errors in the console on page load.

Git commits — commit after each of the following milestones:
  1. Dispatcher stub registered, ping/pong works in DevTools:
       git add cpp/host/dispatch.hpp cpp/host/dispatch.cpp
       git commit -m "feat(host): register __cmdide_invoke bind — ping/pong IPC round-trip works"
  2. Wails window.go stub suppresses console errors:
       git commit -m "feat(host): suppress Wails window.go errors with no-op proxy"
  3. git push:
       git push
```

### Effects
- `cpp/host/dispatch.hpp`, `cpp/host/dispatch.cpp`: stub dispatcher, `emit()` helper
- `cpp/host/main.cpp`: bind registered, Wails proxy injected via `wv.init()`
- No Go files modified; Wails app still builds and runs

---

## Phase H Checklist

- [ ] `cmake --build cpp/build --config Release --target cmdide-host` succeeds
- [ ] `cmdide-host.exe` opens a window showing the cmdIDE frontend UI
- [ ] `window.__cmdide_invoke("ping", "{}", "0")` returns `{"ok":true,"data":"pong"}` in DevTools console
- [ ] Unknown types return `{"ok":false,"error":"not yet implemented: <type>"}`
- [ ] No Wails-related errors on page load in the DevTools console
- [ ] Wails app (`wails build`) still builds and runs identically
- [ ] `build.ps1` builds both Wails app and cmdide-host in one run
- [ ] `git log --oneline` shows clean commits for each milestone above
- [ ] Branch pushed: `git push`
