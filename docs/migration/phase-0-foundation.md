# Phase 0 — Foundation

## Overview

Scaffolds the C++ side of the project and establishes the IPC bridge between Go and C++. Nothing
changes for end users — the feature flag defaults to `false`. By the end of Phase 0 you have a C++
binary that compiles and speaks the wire protocol, and Go code that can spawn it and exchange
messages (but doesn't yet route any real traffic through it).

---

## Git Workflow

**Branch:** `feat/cpp-migration` — create it once before starting:
```
git checkout -b feat/cpp-migration
```
Commit after each backbone feature listed in each prompt's **Git commits** section. Push after
this phase completes: `git push -u origin feat/cpp-migration`

---

## Prompt 0.1 — C++ Project Scaffold

```
Context: This is the terminal-IDE project, a Windows desktop app built with Wails v2 (Go + React/TSX).
The app lives in app/ (Go), app/frontend/ (React/TSX), and the repo root contains build.ps1. We are
beginning a phased migration to add a C++ subprocess that will eventually replace most Go backend
logic. The C++ process communicates with Go over a Windows named pipe using newline-delimited JSON.

Task: Create the C++ project scaffold at cpp/ in the repo root.

Requirements:
- Build system: CMake 3.26+ with vcpkg integration (vcpkg.json manifest)
- Dependencies via vcpkg: nlohmann-json (JSON parsing), spdlog (structured logging)
- Target: cmdide-backend.exe — a Windows console application
- Entry point: cpp/src/main.cpp — reads the named-pipe path from argv[1], connects to it, enters a
  read-loop, and echoes back {"type":"pong","id":"<id>"} for any {"type":"ping","id":"<id>"} message
  (wire protocol smoke test)
- Named pipe I/O: use CreateFile to open the pipe (Go creates it as server), then ReadFile/WriteFile
  in a loop; frame messages by newline (\n)
- Logging: spdlog writing to %TEMP%\cmdide-backend.log
- cpp/CMakeLists.txt must be standalone (does not depend on Go or the Go build)
- Add cpp/ to .gitignore build artifact paths (keep source; ignore cpp/build/)
- Update build.ps1 so that after the Go/Wails build it also runs
  cmake --build cpp/build --config Release (create the build dir and run
  cmake -B cpp/build -S cpp -DCMAKE_TOOLCHAIN_FILE=... if it doesn't exist)
- Do NOT modify any Go files in this prompt

Files to create: cpp/CMakeLists.txt, cpp/vcpkg.json, cpp/src/main.cpp, cpp/src/ipc.hpp,
cpp/src/ipc.cpp

Verification: cmake -B cpp/build -S cpp && cmake --build cpp/build --config Release produces
cpp/build/Release/cmdide-backend.exe with no errors.

Git commits — commit after each of the following milestones:
  1. cpp/ source files written and cmake configure succeeds (no build yet):
       git add cpp/ && git commit -m "feat(cpp): add C++ project scaffold with CMake and vcpkg"
  2. cmake --build succeeds and cmdide-backend.exe runs (ping/pong manually tested):
       git commit -m "feat(cpp): IPC smoke test — ping/pong over named pipe works"
  3. .gitignore and build.ps1 updated:
       git commit -m "build: add C++ build step to build.ps1; exclude cpp/build/ from git"
```

### Effects
- New directory: `cpp/` with CMakeLists, vcpkg manifest, and IPC smoke-test source
- `.gitignore` updated: `cpp/build/` excluded
- `build.ps1` updated: C++ build step appended after Wails build
- No Go files modified; no user-visible behavior change

---

## Prompt 0.2 — Go IPC Bridge Package

```
Context: terminal-IDE. We have just added a C++ project at cpp/ that builds cmdide-backend.exe.
That binary takes a named-pipe path as argv[1], connects to it, and speaks newline-delimited JSON.

Task: Create a new Go package app/cppbridge/ that manages the lifecycle of the C++ subprocess.

Requirements:
- app/cppbridge/bridge.go — exports:
    type Bridge struct   (fields: cmd *exec.Cmd, conn net.Conn, pipeName string, mu sync.Mutex,
                          started bool)
    func New() *Bridge
    func (b *Bridge) Start(exePath string) error
        Creates the named pipe server at \\.\pipe\cmdide-<pid>, starts exePath as a subprocess
        with the pipe path as argv[1], calls ConnectNamedPipe to accept the C++ client connection.
    func (b *Bridge) Stop()
        Sends {"type":"shutdown"}, closes pipe, kills process if still running.
    func (b *Bridge) Send(msg map[string]any) error
        Marshals to JSON + \n, writes to pipe.
    func (b *Bridge) Recv() (map[string]any, error)
        Blocking read of one newline-terminated JSON message.
    func (b *Bridge) RoundTrip(req map[string]any, timeoutMs int) (map[string]any, error)
        Send + matching Recv by "id" field, with timeout.
- Use golang.org/x/sys/windows for CreateNamedPipe, ConnectNamedPipe syscalls (already a dep via
  Wails — verify in app/go.mod)
- The package must compile on non-Windows via //go:build windows guards (stub file
  app/cppbridge/bridge_other.go returns errors.New("not supported"))
- Write app/cppbridge/bridge_test.go that starts cmdide-backend.exe (skip if file doesn't exist),
  sends a ping, asserts pong response within 2 seconds

Do NOT modify app/app.go or any other existing Go file.

Git commits — commit after each of the following milestones:
  1. Package compiles (go build ./cppbridge/... succeeds):
       git add app/cppbridge/ && git commit -m "feat(cppbridge): add Go IPC bridge package with named pipe transport"
  2. Ping/pong test passes (go test ./cppbridge/...):
       git commit -m "test(cppbridge): add bridge integration test — ping/pong in under 2s"
```

### Effects
- New package: `app/cppbridge/` (`bridge.go`, `bridge_other.go`, `bridge_test.go`)
- No behavior change for the running app
- `go test ./cppbridge/` passes when `cmdide-backend.exe` exists

---

## Prompt 0.3 — Feature Flag Integration

```
Context: terminal-IDE. We have app/cppbridge.Bridge (spawns C++ subprocess, speaks newline-delimited
JSON over named pipe). Now we wire the bridge into the main App struct behind a feature flag so it
can be toggled at runtime without any behavior change when off.

Task: Integrate cppbridge.Bridge into app/app.go behind a UseCppBackend feature flag.

Requirements:
- Add field  cpp *cppbridge.Bridge  to the App struct in app/app.go
- Add field  UseCppBackend bool  to the App struct (default: false)
- In App.startup() (the Wails lifecycle hook): if UseCppBackend, resolve cmdide-backend.exe
  relative to the app executable, call a.cpp.Start(exePath), log success/failure — if Start fails,
  log a warning and set UseCppBackend = false (graceful degradation)
- In App.shutdown(): if a.cpp != nil, call a.cpp.Stop()
- Expose a Wails-bound method GetCppBackendStatus() string that returns "enabled", "disabled", or
  "error: <msg>" — useful for a debug info panel
- Do NOT route any real terminal/file/config traffic through C++ yet (that is Phase 1+)
- Do NOT break any existing functionality — all existing Wails-bound methods must continue to work
  identically

Verification: go build ./... in app/ succeeds. Running the app with UseCppBackend: false (default)
is identical to today.

Git commits — commit after each of the following milestones:
  1. App compiles and launches cleanly with UseCppBackend: false:
       git commit -m "feat(app): integrate UseCppBackend feature flag with graceful degradation"
  2. GetCppBackendStatus bound method verified in running app:
       git commit -m "feat(app): add GetCppBackendStatus Wails-bound method"
```

### Effects
- `app/app.go`: `App` struct gains `cpp` and `UseCppBackend` fields; startup/shutdown wired;
  `GetCppBackendStatus` bound method added
- No behavior change with default `UseCppBackend: false`

---

## Phase 0 Checklist

- [ ] `cpp/build/Release/cmdide-backend.exe` compiles clean
- [ ] `go test ./cppbridge/` — ping/pong test passes
- [ ] `go build ./...` — no errors
- [ ] App launches and behaves identically with `UseCppBackend: false`
- [ ] `git log --oneline` shows clean commits for each milestone above
- [ ] `git push -u origin feat/cpp-migration` — branch visible to collaborators
