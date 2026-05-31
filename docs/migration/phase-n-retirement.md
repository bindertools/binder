# Phase N — Go Retirement

## Overview

Phase N is the final, irreversible cleanup: all Go code is deleted, Wails is removed, and the
project structure is simplified to reflect the pure C++/WebView architecture. Run this phase
only when the C++ host has been stable in production for at least several days and all Phase H–M
checklist items are confirmed green on CI.

---

## Git Workflow

**Branch:** `feat/webview-migration` (already created)

This phase contains irreversible deletions. Commit file-by-file so every deletion is
independently reviewable. Push after the phase completes and CI confirms green.

---

## Prompt N.1 — Remove All Go Code

```
Context: terminal-IDE. The C++ WebView host is feature-complete and stable. The Wails app in
app/ and the Go installer in installer/windows/ are no longer the primary build targets. Phase M
removed them from build.ps1 and the CI workflows. It is time to delete all Go code.

Task: Delete all Go source files, Go module files, and Wails configuration.

This is a documentation-only audit first, then deletion. Do NOT delete anything until
the audit is complete.

Step 1 — Audit before deletion

List every file or directory that will be deleted. For each one, confirm:
  (a) It has no callers in the remaining C++ or TypeScript codebase.
  (b) Its functionality is fully covered by the C++ implementation.

Files to delete:
  app/                            — entire Go backend directory (all .go files, go.mod, go.sum,
                                    wails.json, build/, frontend/wailsjs/go/)
  installer/windows/              — Go installer directory (main.go, app.go, channel*.go,
                                    go.mod, go.sum, wails.json)
                                    NOTE: installer/windows/frontend/ is KEPT (TSX source)
                                    NOTE: installer/windows/frontend/wailsjs/ is deleted
                                    (the Wails-generated JS bindings are replaced by the IPC shim)

  Do NOT delete:
    app/frontend/                 — TSX frontend source (stays)
    installer/windows/frontend/src/  — installer frontend TSX (stays)
    cpp/                          — C++ code (stays)
    docs/                         — docs (stays)
    build.ps1                     — build script (already updated in Phase M)
    .github/                      — CI workflows (already updated in Phase M)

Audit checklist (verify each before deleting):
  [ ] app/cppbridge/ — only called by Go code. Safe to delete.
  [ ] app/terminal.go — only called by Go main. Safe to delete.
  [ ] app/config/ — config now handled entirely by C++. Safe to delete.
  [ ] app/database/ — session DB now handled by C++ SQLite. Safe to delete.
  [ ] app/plugins/ — check if any TSX code imports from here. If so, update first.
  [ ] app/frontend/wailsjs/ — Wails-generated bindings. Safe to delete (shim replaces them).
  [ ] installer/windows/frontend/wailsjs/ — same. Safe to delete.
  [ ] go.sum / go.mod — no longer needed.

Step 2 — Delete

After confirming the audit, delete in this order:

  1. app/frontend/wailsjs/ (Wails JS bindings — replaced by shim)
       git rm -r app/frontend/wailsjs/
       git commit -m "chore: remove Wails-generated JS bindings — replaced by IPC shim"

  2. installer/windows/frontend/wailsjs/ (installer Wails bindings)
       git rm -r installer/windows/frontend/wailsjs/
       git commit -m "chore: remove installer Wails JS bindings — replaced by IPC shim"

  3. installer/windows/ Go backend (keep frontend/src/ only)
       git rm installer/windows/main.go installer/windows/app.go installer/windows/channel*.go
       git rm installer/windows/go.mod installer/windows/go.sum installer/windows/wails.json
       git commit -m "chore: remove Go/Wails installer backend — C++ installer is production"

  4. app/ Go backend (keep app/frontend/ only)
       git rm -r app/cppbridge/ app/config/ app/database/ app/perf/ app/plugins/ app/ports/
       git rm -r app/problems/ app/search/ app/session/ app/fullscreen/
       git rm app/*.go
       git rm app/go.mod app/go.sum app/wails.json
       git commit -m "chore: remove Go/Wails application backend — C++ host is production"

  5. Verify nothing was missed:
       # No .go files should remain:
       find . -name "*.go" -not -path "./.git/*"  → should be empty
       # No go.mod/go.sum files:
       find . -name "go.mod" -o -name "go.sum"    → should be empty
       # Wails config:
       find . -name "wails.json"                  → should be empty
       git commit -m "chore: verify — no Go or Wails files remain in repository"

Step 3 — Update .gitignore

  Remove Go-specific ignore entries (GOPATH, vendor/, etc.) if present.
  Remove Wails-specific entries if present (app/build/).
  Keep: cpp/build/, cpp/host/generated/, cpp/installer/generated/, node_modules/
  git commit -m "chore: update .gitignore — remove Go/Wails entries"

Step 4 — Verify the repo still builds

  Run build.ps1 and confirm all C++ artifacts are produced correctly.
  Run npm run build in app/frontend/ and installer/windows/frontend/ — confirm no errors.
  TypeScript type check: npx tsc --noEmit — must pass.

Git commits — as listed in Step 2 above (one commit per deletion unit):
  1. Wails JS bindings deleted (app and installer)
  2. Go installer deleted
  3. Go application backend deleted
  4. Verification commit
  5. .gitignore updated
  6. git push:
       git push
```

### Effects
- `app/` reduced to `app/frontend/` only — all `.go` files, `go.mod`, `go.sum`, `wails.json` deleted
- `installer/windows/` reduced to `frontend/src/` only
- `app/frontend/wailsjs/` deleted
- `installer/windows/frontend/wailsjs/` deleted
- `.gitignore` updated

---

## Prompt N.2 — Final Cleanup

```
Context: terminal-IDE. All Go code is deleted. The repository now contains only C++ source,
TypeScript/TSX frontend, documentation, and build infrastructure.

Task: Final project cleanup — update documentation, directory structure, and confirm
everything is correct before merging to main.

Read before coding:
  - docs/migration/README.md    (Step 1 roadmap — update to reflect completion)
  - docs/migration/step2-README.md  (Step 2 roadmap — mark as complete)
  - README.md (root — update tech stack, build instructions)
  - cpp/CMakeLists.txt           (clean up: remove cmdide-backend.exe target if it is obsolete)
  - cpp/src/ipc.hpp/cpp          (the named-pipe IPC transport was only needed when Go was the
                                  host — it is now dead code; assess and remove)

Requirements:

1. Remove dead C++ code

   cpp/src/ipc.hpp and cpp/src/ipc.cpp — the named-pipe IPC transport.
   This code was the bridge between Go and C++. Now that Go is gone and the host calls
   backend modules directly, this transport is unused.
   Before deleting, confirm no other file #includes ipc.hpp or calls IPC functions.
   If confirmed unused: delete both files and remove from CMakeLists.txt.
     git rm cpp/src/ipc.hpp cpp/src/ipc.cpp
     git commit -m "chore(cpp): remove named-pipe IPC transport — obsolete after Go removal"

2. Remove the standalone cmdide-backend.exe target

   cpp/src/main.cpp was the entry point for the old standalone C++ backend subprocess.
   Now that the host links the backend modules directly, this standalone executable is unused.
   Before deleting: confirm cmdide-backend.exe is not referenced in any remaining script or doc.
   If confirmed: delete cpp/src/main.cpp and remove the cmdide-backend executable target from
   cpp/CMakeLists.txt. The cmdide-backend-lib static library stays (linked by the host).
     git rm cpp/src/main.cpp
     git commit -m "chore(cpp): remove standalone backend entry point — host links backend directly"

3. Update docs/migration/README.md
   Add a new section at the top:
     ## Step 2 Complete ✅
     All Go and Wails code removed. The application is now purely C++ + WebView + TSX.
     See step2-README.md for the Step 2 migration log.
   Update the Phase Map table to add "(Step 1)" to the heading.

4. Update docs/migration/step2-README.md
   Add a completion status section mirroring the Step 1 README format:
     ## Phase Map — Step 2 Status
     | Phase | Status |
     |-------|--------|
     | H — WebView Host      | ✅ |
     | I — Frontend IPC      | ✅ |
     | J — Native Window     | ✅ |
     | K — Cross-Platform    | ✅ |
     | L — Installer         | ✅ |
     | M — Build & CI/CD     | ✅ |
     | N — Go Retirement     | ✅ |

5. Update the root README.md (if it exists)
   Find and update:
     - "Built with Go + Wails" → "Built with C++ + WebView"
     - Build instructions: replace `wails build` with `cmake --build`
     - Prerequisites: remove Go/Wails, add cmake/vcpkg/WebKitGTK (Linux)
     - Technology stack section

6. Final directory structure verification
   Confirm the repo looks clean:
     cpp/         — C++ source (host, installer, backend modules)
     app/frontend/ — TSX frontend
     installer/windows/frontend/src/ — installer TSX frontend
     docs/        — documentation
     build.ps1    — unified build script
     .github/     — CI/CD workflows
   No Go source files, no Wails config, no go.mod/go.sum anywhere.

7. Merge both feature branches to main (one operation)
   Both Step 1 and Step 2 have been on feature branches throughout. Now that everything is
   complete and CI is green, land it all in a single merge to main:
     git checkout main
     git merge --no-ff feat/webview-migration -m "feat: complete Go/Wails → C++/WebView migration"
     git tag v<next-version>
     git push --follow-tags
   NOTE: feat/webview-migration already contains feat/cpp-migration as its base, so this
   single merge brings in both steps at once.

Git commits — commit after each of the following milestones:
  1. Named-pipe IPC code removed:
       git commit -m "chore(cpp): remove named-pipe IPC transport — obsolete after Go removal"
  2. Standalone backend entry point removed:
       git commit -m "chore(cpp): remove standalone cmdide-backend.exe target — host is self-contained"
  3. Migration docs updated to mark Step 2 complete:
       git commit -m "docs: mark Step 2 migration complete — pure C++/WebView/TSX"
  4. Root README updated:
       git commit -m "docs: update README for C++/WebView stack"
  5. git push:
       git push
  6. CI passes — merge both feature branches to main as a single operation:
       git checkout main
       git merge --no-ff feat/webview-migration -m "feat: complete Go/Wails → C++/WebView migration"
       git push --follow-tags
```

### Effects
- `cpp/src/ipc.hpp`, `cpp/src/ipc.cpp`: deleted (named-pipe transport obsolete)
- `cpp/src/main.cpp`: deleted (standalone backend entry point obsolete)
- `docs/migration/README.md`, `docs/migration/step2-README.md`: marked complete
- `README.md`: updated tech stack and build instructions
- `feat/webview-migration` (containing both Step 1 + Step 2) merged into `main` as one operation

---

## Phase N Checklist

- [ ] `find . -name "*.go"` returns nothing (outside `.git/`)
- [ ] `find . -name "go.mod" -o -name "go.sum"` returns nothing
- [ ] `find . -name "wails.json"` returns nothing
- [ ] `cpp/src/ipc.hpp` and `ipc.cpp` deleted
- [ ] `cpp/src/main.cpp` (standalone backend entry) deleted
- [ ] `cmake --build cpp/build --config Release --target cmdide-host` succeeds
- [ ] `./build.ps1` produces all expected artifacts on each platform
- [ ] TypeScript type check (`npx tsc --noEmit`) passes in both frontends
- [ ] CI is green on all checks in `.github/workflows/`
- [ ] `git log --oneline` shows one commit per deletion/cleanup unit
- [ ] `feat/webview-migration` merged to `main` with a version tag
- [ ] Migration docs updated to show all phases complete
