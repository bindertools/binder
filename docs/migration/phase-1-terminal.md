# Phase 1 — Terminal Core

## Overview

This is the heart of the migration. By the end of Phase 1, the C++ subprocess hosts a real
ConPTY-backed terminal session and handles all custom `/commands`. The Go layer routes I/O through
C++ when `UseCppBackend = true`. A feature-flag flip makes the new backend live while the old Go
path remains intact as a fallback.

---

## Git Workflow

**Branch:** `feat/cpp-migration` (already created in Phase 0)

Commit after each backbone feature listed in each prompt's **Git commits** section. Push after
this phase completes: `git push`

---

## Prompt 1.1 — ConPTY Terminal in C++

```
Context: terminal-IDE. We have a C++ subprocess (cpp/) that connects to Go via named pipe JSON IPC.
The current Go terminal (app/terminal.go) spawns PowerShell via os/exec and pipes stdin/stdout
manually — it has no true PTY. We want to replace this with a Windows ConPTY session hosted
entirely in C++.

Task: Implement a ConPTY-backed terminal session in C++.

Files to create/modify: cpp/src/terminal.hpp, cpp/src/terminal.cpp

Requirements:
- Class Terminal with methods:
    bool Start(const std::string& shell, uint16_t cols, uint16_t rows)
        Calls CreatePseudoConsole, spawns shell (default: powershell.exe) via CreateProcess with
        STARTUPINFOEXW, sets up I/O threads.
    void Write(std::string_view data)
        Writes to ConPTY input pipe (user keystrokes).
    void Resize(uint16_t cols, uint16_t rows)
        Calls ResizePseudoConsole.
    void SetOutputCallback(std::function<void(std::string_view)> cb)
        Output data callback, called from reader thread.
    void Stop()
        Closes ConPTY, waits for process exit.
    bool IsRunning() const

- I/O threads: reader thread calls the output callback with raw VT sequences; no filtering
- Live PATH injection (mirrors app/envpath_windows.go:liveEnv()):
    GUI apps inherit the Explorer PATH snapshot from login — tools installed after that update the
    registry but never propagate to running processes. Before calling CreateProcess, build the
    environment block by reading the live PATH from the Windows registry:
      HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment  (system PATH)
      HKCU\Environment                                                     (user PATH)
    Expand %VAR% references in each value via ExpandEnvironmentStrings, concatenate with ";",
    and replace the PATH entry in the inherited environment. Use this merged environment as
    lpEnvironment in the CreateProcess call. Without this, any tool installed after app launch
    (winget, scoop, npm -g, etc.) will not be found in the terminal.
- Handle CTRL_C_EVENT and process exit cleanly
- Wire into main.cpp message dispatch:
    IPC message "terminal.start"  {"shell":"powershell.exe","cols":80,"rows":24}
    IPC message "terminal.write"  {"data":"<base64-encoded input>"}
    IPC message "terminal.resize" {"cols":int,"rows":int}
    IPC message "terminal.stop"   {}
  Output sent back as {"type":"terminal.output","data":"<base64>"} (base64 transports binary VT
  sequences safely over JSON)

Do NOT modify any Go files in this prompt.

Git commits — commit after each of the following milestones:
  1. Terminal class compiles and CreatePseudoConsole succeeds in isolation:
       git add cpp/src/terminal.hpp cpp/src/terminal.cpp
       git commit -m "feat(cpp): add ConPTY Terminal class with I/O threading"
  2. IPC dispatch wired — terminal.start/write/resize/stop handled in main.cpp:
       git commit -m "feat(cpp): wire terminal IPC message dispatch in main.cpp"
  3. Manual smoke test passes (start app, open terminal, type echo hello, see output):
       git commit -m "feat(cpp): ConPTY terminal session verified working end-to-end"
```

### Effects
- `cpp/src/terminal.hpp`, `cpp/src/terminal.cpp`: full ConPTY implementation
- `cpp/src/main.cpp`: IPC message dispatch wired to `Terminal`
- `CMakeLists.txt`: no new deps needed (ConPTY is Windows SDK)

---

## Prompt 1.2 — Custom Command System in C++

```
Context: terminal-IDE has a rich set of custom slash commands implemented in Go (app/terminal.go —
look for handleCommand, handleBuiltinCommand, and all the case "/..." branches). These include
commands like /clear, /theme, /font, /search, /ports, /pack, /update, /session, /plugins, /ai, and
others. We need to re-implement the full command system in C++ so that when UseCppBackend = true,
commands are handled by C++ and return byte-identical ANSI output.

Task: Implement the complete custom command system in C++.

Files: cpp/src/commands.hpp, cpp/src/commands.cpp

Requirements:
- class CommandRegistry — maps command name → handler function
- Each handler receives:
    const std::vector<std::string>& args
    Terminal& term
    Bridge& bridge   (for calling back to Go/frontend during migration)
- Implement ALL commands currently in app/terminal.go. For each command, the ANSI escape sequence
  output must be identical to the Go implementation. Read the Go source carefully before writing
  any handler.
- Commands that currently call into other Go subsystems (file ops, config, search, ports, preview)
  should stub with Bridge.RoundTrip({"type":"cmd.<name>","args":[...]}) — Go handles the call for
  now; C++ takes over in later phases.
- Wire into main.cpp: when terminal.write contains a line starting with /, intercept before passing
  to ConPTY and dispatch to CommandRegistry.
- IPC message "commands.list" returns {"type":"commands.list","commands":[...]} — list of all
  registered command names (used by frontend autocomplete).

Read before coding: app/terminal.go — specifically handleCommand(), handleBuiltinCommand(), and
every case "/..." branch. The ANSI output must be byte-for-byte identical.

Git commits — commit after each of the following milestones:
  1. CommandRegistry skeleton + /clear and /help implemented and verified:
       git add cpp/src/commands.hpp cpp/src/commands.cpp
       git commit -m "feat(cpp): add CommandRegistry with /clear and /help handlers"
  2. All remaining commands implemented (stubs for subsystem-dependent ones):
       git commit -m "feat(cpp): implement all slash commands; subsystem stubs RoundTrip to Go"
  3. "/" interception wired in main.cpp and commands.list IPC message working:
       git commit -m "feat(cpp): wire command interception and commands.list IPC response"
```

### Effects
- `cpp/src/commands.hpp`, `cpp/src/commands.cpp`: full command registry
- `cpp/src/main.cpp`: `/`-prefixed input intercepted before ConPTY
- Stubbed commands RoundTrip back to Go for subsystems not yet migrated

---

## Prompt 1.3 — Go I/O Routing Through C++

```
Context: terminal-IDE. app/cppbridge.Bridge exists and can send/receive JSON IPC messages to the
C++ subprocess. The C++ subprocess now hosts a ConPTY terminal and handles custom commands. We need
to modify app/terminal.go so that when App.UseCppBackend = true, all terminal I/O is routed through
C++ instead of the Go PTY implementation.

Task: Add C++ routing to app/terminal.go.

Requirements:
- Every Wails-bound method in terminal.go that writes to or reads from the terminal must check
  a.UseCppBackend:
    true  → delegate to a.cpp.Send(...) / a.cpp.RoundTrip(...) with appropriate IPC message types
    false → existing Go implementation (must remain 100% intact and structurally unchanged)

- Terminal output events: C++ sends {"type":"terminal.output","data":"<base64>"} back; Go decodes
  the base64 and emits the same Wails event the current implementation emits
  (runtime.EventsEmit(a.ctx, "terminal:data", ...)) with the same payload shape.

- Start a background goroutine in App.startup() (when UseCppBackend = true) that calls
  a.cpp.Recv() in a loop and dispatches terminal.output messages as Wails events.

- The fallback path (all existing Go code) must not be touched structurally — only wrap with
  if a.UseCppBackend { ... } else { ... }

Constraint: go vet ./... must pass. No new external Go dependencies.

Git commits — commit after each of the following milestones:
  1. All terminal.go methods wrapped; go build ./... passes:
       git commit -m "refactor(terminal): wrap all terminal I/O methods with UseCppBackend guard"
  2. Background recv goroutine added and Wails event forwarding verified:
       git commit -m "feat(app): add C++ output recv loop; forward terminal.output as Wails events"
  3. UseCppBackend: false regression confirmed — existing Go path still works identically:
       git commit -m "test(terminal): verify Go fallback path unchanged after routing refactor"
```

### Effects
- `app/terminal.go`: every I/O method wrapped with `UseCppBackend` guard
- `app/app.go`: background recv goroutine started in `startup()` when flag is true
- Existing behavior (`UseCppBackend: false`) completely unchanged

---

## Prompt 1.4 — Enable Flag and Verify

```
Context: terminal-IDE. All Phase 1 C++ code is written. The feature flag UseCppBackend in
app/app.go currently defaults to false. We want to flip it to true, add a lightweight debug overlay,
and produce a verification checklist.

Task: Enable UseCppBackend and add a debug overlay.

Requirements:
- In app/app.go, change the UseCppBackend default to true
- Add a Wails-bound method DebugInfo() map[string]string that returns:
    {
      "backend":     "cpp" or "go",
      "cpp_pid":     "<pid of C++ process>",
      "cpp_pipe":    "<named pipe path>",
      "cpp_version": "<semver string from C++ binary>"
    }
  C++ should respond to IPC message "debug.version" with {"type":"debug.version","version":"x.y.z"}
- In app/frontend/src/ add a DebugOverlay.tsx React component:
    - Toggled by Ctrl+Shift+D
    - Calls window.go.main.App.DebugInfo() and displays the result
    - Floating pill, top-right corner, dark bg (#1c1c1e), monospace font, z-index above everything
    - Does not affect any other UI element
- Write docs/verification/phase1.md with this exact checklist:
    [ ] App launches; C++ process visible in Task Manager
    [ ] Terminal opens; type "echo hello" and see "hello"
    [ ] /clear command clears the screen
    [ ] /theme dark and /theme light work
    [ ] Resize the window; terminal reflows correctly
    [ ] Close app; C++ process exits (not visible in Task Manager)
    [ ] Ctrl+Shift+D opens debug overlay showing backend: cpp

Do NOT merge or delete the Go PTY code — it must remain as the fallback.

Git commits — commit after each of the following milestones:
  1. UseCppBackend flipped to true, DebugInfo method added, app compiles:
       git commit -m "feat(app): enable UseCppBackend by default; add DebugInfo bound method"
  2. DebugOverlay component added and toggling correctly:
       git commit -m "feat(frontend): add Ctrl+Shift+D debug overlay showing backend status"
  3. All items in docs/verification/phase1.md manually checked off:
       git add docs/verification/phase1.md
       git commit -m "docs: add Phase 1 verification checklist (all items passing)"
  4. Push the branch:
       git push
```

### Effects
- `app/app.go`: `UseCppBackend` set to `true`; `DebugInfo()` method added
- `app/frontend/src/DebugOverlay.tsx`: new component, Ctrl+Shift+D toggle
- `docs/verification/phase1.md`: checklist created

---

## Phase 1 Checklist

- [ ] ConPTY session starts; VT sequences render correctly in the frontend
- [ ] All custom `/commands` produce identical output to the Go implementation
- [ ] `UseCppBackend: false` still passes all existing behavior (regression)
- [ ] Debug overlay shows `backend: cpp`
- [ ] App exits cleanly — no orphaned C++ processes in Task Manager
- [ ] `git log --oneline` shows a clean commit per milestone
- [ ] Branch pushed and visible to collaborators
