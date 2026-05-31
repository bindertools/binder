# Phase 5 — Retirement Prep

## Overview

Phase 5 audits the Go layer, removes every dead code path, and produces the Option 3 readiness
assessment document. After Phase 5, Go is as thin as it can possibly be while still hosting Wails:
the `App` struct, `cppbridge.Bridge`, and event forwarding. This is the launchpad for Option 3.

---

## Git Workflow

**Branch:** `feat/cpp-migration` (already created in Phase 0)

This phase is the most consequential — commits here are **irreversible** deletions of the Go
fallback paths. Commit file-by-file so every deletion is independently reviewable. Push after
this phase completes: `git push`

---

## Prompt 5.1 — Go Layer Audit and Dead Code Removal

```
Context: terminal-IDE. Every backend feature — terminal, commands, file ops, config, search, ports,
perf, preview, session, pack, update — has been implemented in C++ (Phases 1–4). Every Go method
is wrapped with if a.UseCppBackend { ... } else { ... }. UseCppBackend has been true by default for
several weeks with no regression found. It is time to delete the Go fallback code.

Task: Remove all dead Go code.

Process — work through these files in order, one commit per file:
  app/terminal.go
  app/preview_server.go
  app/update.go
  app/update_windows.go
  app/update_other.go
  app/app.go
  app/utils.go

For each file:
  1. Find every  if a.UseCppBackend { ... } else { ... }  block.
     Delete the else branch and the condition wrapper; keep only the C++ delegation call inline.
  2. After removing else branches, identify any Go functions/methods that are now unreachable
     (i.e., only called from the deleted else branches). Delete them.
  3. If a file becomes empty (only package declaration and imports remain), delete it entirely.

After all files are cleaned:
  4. Run  go mod tidy  in app/ — remove any Go dependencies that are now unused.
  5. Run  go vet ./...  — must pass with zero warnings.
  6. Run  go test ./...  — must pass.

At the top of each modified file, add a brief comment listing what was removed:
  // Removed in Phase 5: <comma-separated list of deleted function names>

Do NOT delete:
  - The App struct or its Wails lifecycle methods (startup, shutdown, domReady, beforeClose)
  - app/cppbridge/  — still required
  - Any Wails-bound method that is still actively called (GetCppBackendStatus, DebugInfo, etc.)
  - app/main.go

Git commits — one commit per file cleaned (do not batch multiple files):
  git commit -m "refactor(terminal): remove Go PTY fallback path — C++ backend is permanent"
  git commit -m "refactor(preview_server): remove Go HTTP preview fallback"
  git commit -m "refactor(update): remove Go update fallback; delete update_windows.go and update_other.go"
  git commit -m "refactor(app): remove Go fallback branches; prune dead helper functions"
  git commit -m "refactor(utils): delete detectLanguage — owned by C++ since Phase 2"
  git commit -m "build(go): run go mod tidy; remove unused dependencies"
```

### Effects
- All `UseCppBackend` else-branches removed
- Dead Go functions/methods deleted
- `app/go.mod` and `app/go.sum` pruned via `go mod tidy`
- `app/utils.go` potentially deleted if `detectLanguage` was its only export
- `app/preview_server.go` potentially reduced to just the Wails event forwarder

---

## Prompt 5.2 — Option 3 Readiness Assessment

```
Context: terminal-IDE. Phase 5.1 is complete. Go is now a thin Wails host: App struct,
cppbridge.Bridge, Wails event forwarding, and nothing else. We want to formally assess what it
would take to replace Wails + Go with a C++ webview/webview host (Option 3).

Task: Write docs/migration/option3-readiness.md — a structured assessment document.

This is a documentation-only prompt. Do NOT write code.

The document must cover these sections:

1. What Go still does
   Enumerate every remaining Go function/method (post Phase 5.1). For each one, classify it:
     (a) Trivially replaceable in C++ — no new logic needed
     (b) Requires a webview API equivalent — e.g. window manipulation, dialog boxes
     (c) Requires custom implementation — non-trivial work

   Make sure to explicitly assess these two that are NOT covered by earlier migration phases:

   jumplist_windows.go — calls win.InitJumpList() to register Windows taskbar jump-list shortcuts
   (right-click on the taskbar icon). The underlying windows package uses COM APIs. Classification
   hint: COM is native to C++; this is likely (a). Note the Win32 COM calls needed.

   splash_windows.go — 422 lines of raw Win32 GDI: a borderless popup window, PNG decoding,
   and a real Win32 message loop shown while the WebView loads. No business logic; pure
   presentation. Classification hint: stays in Go for all of Option 1 (Wails controls the window
   lifecycle after the splash closes). For Option 3 this would move to C++ and is likely (a)
   given it is already pure Win32. Document the GDI calls so the C++ port is straightforward.

2. Wails-specific API surface
   List every runtime.* call remaining in the Go codebase
   (e.g. runtime.EventsEmit, runtime.WindowSetTitle, runtime.OpenDirectoryDialog, etc.).
   For each one, provide the equivalent using webview/webview's window.Eval / postMessage / native
   Win32 API, or note that there is no direct equivalent and custom work is needed.

3. Frontend changes required
   Wails injects window.go.main.App.* bindings via its RPC bridge.
   webview uses postMessage / window.external.invoke.
   Document the shim layer needed in app/frontend/ to make the frontend work with both:
     - Interface the frontend already uses (window.go.main.App.*)
     - What the shim must translate it to for webview
     - Estimated lines of code

4. Build system changes
   Current: wails build -platform windows/amd64 -o ...
   Option 3: CMake builds the C++ webview host + embeds app/frontend/dist as a resource
   List every build.ps1 and CI workflow change needed.

5. Estimated effort
   Provide a rough estimate per section (story points or engineering days).
   Be honest about unknowns.

6. Go / No-Go recommendation
   Based on the analysis above: is the codebase ready to execute Option 3 now, or is more
   groundwork needed? State the recommendation clearly and list any blockers.

Git commits:
  git add docs/migration/option3-readiness.md
  git commit -m "docs: add Option 3 (C++ + webview) readiness assessment"
  git push
```

### Effects
- `docs/migration/option3-readiness.md` created
- No code changes

---

## Phase 5 Checklist

- [ ] `go vet ./...` passes after dead code removal
- [ ] `go test ./...` passes
- [ ] `go mod tidy` shows no unused dependencies
- [ ] All deleted functions listed in per-file comments
- [ ] Each file cleaned is its own commit — `git log --oneline` is fully readable
- [ ] Option 3 readiness document written and reviewed by the team
- [ ] Decision recorded: proceed to Option 3 | stay on Option 1 and iterate
- [ ] Branch pushed: `git push`
