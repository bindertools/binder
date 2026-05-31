# Phase 4 — Data & Utilities

## Overview

Move the two remaining Go subsystems — session persistence/SQLite and the pack/update system —
into C++. After Phase 4, every backend feature is owned by C++. The Go layer is now a pure Wails
host: `App` struct, `cppbridge.Bridge`, event forwarding, and nothing more.

---

## Git Workflow

**Branch:** `feat/cpp-migration` (already created in Phase 0)

Commit after each backbone feature listed in each prompt's **Git commits** section. Push after
this phase completes: `git push`

---

## Prompt 4.1 — Session Persistence and SQLite in C++

```
Context: terminal-IDE. Session persistence is managed in Go — command history, session metadata,
and a SQLite database at %APPDATA%\cmdIDE\sessions.db. We want C++ to own this, keeping the
database schema and file path identical so existing user data is preserved.

Task: Implement session persistence in C++.

Add to cpp/vcpkg.json:
  "sqlite3"

C++ files to create: cpp/src/session.hpp, cpp/src/session.cpp

BEFORE WRITING ANY CODE: read app/app.go and app/terminal.go to find every session-related method.
Note the exact SQLite table definitions, column names, and data types. Your C++ schema must be
byte-identical — same table names, same column names, same types, same constraints.

IPC messages to handle (derive the exact field names from the Go source):
  session.save        {"id":"...","name":"...","history":[...], ...}
                      → persist to SQLite, return {"ok":true}
  session.load        {"id":"..."}
                      → return full session JSON object
  session.list        {}
                      → return array of session metadata objects
  session.delete      {"id":"..."}
                      → delete session row(s), return {"ok":true}
  session.history.add {"sessionId":"...","command":"..."}
                      → append to history table, return {"ok":true}
  session.history.get {"sessionId":"...","limit":100}
                      → return array of history entry objects, newest first

Use SQLite WAL mode (PRAGMA journal_mode=WAL) for better concurrent read performance.
Wrap all writes in transactions.

Go changes: every session method in app/app.go and app/terminal.go wrapped with UseCppBackend
guard. Do not structurally change the else branches.

Git commits — commit after each of the following milestones:
  1. SQLite schema created; session.save and session.load round-trip correctly:
       git add cpp/src/session.hpp cpp/src/session.cpp cpp/vcpkg.json
       git commit -m "feat(cpp): add SQLite-backed session persistence (save, load, list, delete)"
  2. History add/get working; Go methods wrapped:
       git commit -m "refactor(app,terminal): delegate all session methods to C++ when UseCppBackend=true"
  3. sessions.db verified identical whether written by Go or C++ path:
       git commit -m "test(session): confirm sessions.db schema and data intact across path switch"
```

### Effects
- `cpp/src/session.hpp`, `cpp/src/session.cpp`
- `cpp/vcpkg.json`: `sqlite3` added
- `app/app.go`, `app/terminal.go`: session methods wrapped
- `sessions.db` schema preserved exactly — existing user data migrates seamlessly

---

## Prompt 4.2 — Pack/Zip and Update Checker in C++

```
Context: terminal-IDE. Two utility features remain in Go:
  1. /pack  — zips the current project directory into a .zip archive (app/terminal.go)
  2. update — app/update.go / app/update_windows.go polls a GitHub releases API endpoint, downloads
              a new installer .exe, and launches it via ShellExecuteW

We want both in C++.

Task: Implement pack and update in C++.

Add to cpp/vcpkg.json:
  "libzip"
  (cpp-httplib and nlohmann-json are already present from earlier phases)

C++ files to create:
  cpp/src/pack.hpp, cpp/src/pack.cpp
  cpp/src/updater.hpp, cpp/src/updater.cpp

IPC messages — Pack:
  pack.create {"sourcePath":"...","outputPath":"...","exclude":["node_modules",".git","cpp/build"]}
      Recursively zip sourcePath into outputPath using libzip.
      Skip any path component that appears in the exclude list.
      → {"type":"pack.done","outputPath":"...","sizeMB":float}

IPC messages — Updater:
  updater.check {}
      Call the GitHub releases API endpoint (read app/update.go for the exact URL and
      version-comparison logic — replicate both exactly).
      → {"type":"updater.result","updateAvailable":bool,"latestVersion":"...",
         "downloadUrl":"...","releaseNotes":"..."}

  updater.download {"url":"...","destPath":"..."}
      Download the installer using cpp-httplib with progress reporting.
      Send {"type":"updater.progress","pct":float} events during download (approx every 5%).
      → {"type":"updater.downloaded","path":"..."} when complete.

  updater.install {"installerPath":"..."}
      Launch the installer via ShellExecuteW with "runas" verb (triggers UAC elevation).
      → {"type":"updater.installing"}

CRITICAL: Read app/update.go and app/update_windows.go in full before writing the updater. The
GitHub API endpoint URL, the version comparison algorithm, and the installer launch mechanism must
be replicated exactly. Any deviation will break the update flow for existing users.

Go changes:
  app/update.go / app/update_windows.go — wrap update methods with UseCppBackend guard.
  app/terminal.go — wrap /pack command handler with UseCppBackend guard.

Git commits — commit after each of the following milestones:
  1. /pack creates a valid .zip (verified with a zip tool):
       git add cpp/src/pack.hpp cpp/src/pack.cpp cpp/vcpkg.json
       git commit -m "feat(cpp): add libzip-backed /pack command producing valid .zip archives"
  2. updater.check returns correct latest version from GitHub API:
       git add cpp/src/updater.hpp cpp/src/updater.cpp
       git commit -m "feat(cpp): add update checker against GitHub releases API"
  3. updater.download and updater.install complete; Go methods wrapped:
       git commit -m "feat(cpp): add update download with progress events and UAC-elevated install"
  4. Go fallback confirmed for both /pack and update:
       git commit -m "refactor(terminal,update): delegate /pack and update to C++ when UseCppBackend=true"
  5. Push the branch:
       git push
```

### Effects
- `cpp/src/pack.hpp`, `cpp/src/pack.cpp`, `cpp/src/updater.hpp`, `cpp/src/updater.cpp`
- `cpp/vcpkg.json`: `libzip` added
- `app/update.go`, `app/update_windows.go`, `app/terminal.go`: wrapped with `UseCppBackend` guard
- GitHub API endpoint and version logic replicated exactly

---

## Phase 4 Checklist

- [ ] `/pack` creates a valid `.zip` of the current directory, excluding `node_modules` and `.git`
- [ ] Update check returns the correct latest version from the GitHub API
- [ ] Update download shows progress and completes
- [ ] Session history persists across app restarts
- [ ] SQLite `sessions.db` is the same file whether the Go or C++ path wrote to it last
- [ ] Toggle `UseCppBackend: false` → all of the above still work via Go path (regression)
- [ ] `git log --oneline` shows a clean commit per milestone
- [ ] Branch pushed and visible to collaborators
