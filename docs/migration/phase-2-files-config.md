# Phase 2 — Files & Config

## Overview

Move file operations and the config system from Go into C++. After Phase 2, the only Go code
serving active requests handles things that genuinely need Wails RPC (triggering frontend events).
File browsing and config reads/writes are fully owned by C++.

---

## Git Workflow

**Branch:** `feat/cpp-migration` (already created in Phase 0)

Commit after each backbone feature listed in each prompt's **Git commits** section. Push after
this phase completes: `git push`

---

## Prompt 2.1 — File Operations in C++

```
Context: terminal-IDE. The C++ subprocess is live and handling terminal I/O (Phase 1 complete).
Go's app/app.go contains several Wails-bound methods for file operations: reading directory trees,
reading file contents, writing files, detecting file language (delegating to utils.go:detectLanguage),
and the fullscreen file explorer feature. We want to move all of these into C++.

Task: Implement file operations in C++ and update Go to delegate when UseCppBackend = true.

C++ files to create: cpp/src/fileops.hpp, cpp/src/fileops.cpp

C++ IPC messages to handle:
  fs.readdir   {"path":"...","depth":1}
               → {"type":"fs.readdir","entries":[{"name":"...","isDir":bool,"size":int,"mtime":int},...]}
  fs.readfile  {"path":"..."}
               → {"type":"fs.readfile","content":"<base64>","language":"..."}
  fs.writefile {"path":"...","content":"<base64>"}
               → {"type":"fs.writefile","ok":true}
  fs.delete    {"path":"..."}
               → {"type":"fs.delete","ok":true}
  fs.rename    {"from":"...","to":"..."}
               → {"type":"fs.rename","ok":true}
  fs.stat      {"path":"..."}
               → {"type":"fs.stat","exists":bool,"isDir":bool,"size":int}

Go changes (app/app.go): wrap each matching Wails-bound method with:
  if a.UseCppBackend { return a.cpp.RoundTrip(...) }
  existing implementation in the else branch.

CRITICAL: The language detection extension map in C++ (for fs.readfile "language" field) must be
byte-for-byte identical to app/utils.go's detectLanguage function. Copy the entire extension map
exactly, including the Dockerfile and Makefile base-name checks. Do not abbreviate or reorder it.

Git commits — commit after each of the following milestones:
  1. C++ fileops compile and fs.readdir / fs.readfile work (directory tree and file open tested):
       git add cpp/src/fileops.hpp cpp/src/fileops.cpp
       git commit -m "feat(cpp): add file operations IPC handlers (readdir, readfile, writefile, delete, rename, stat)"
  2. Go delegation wired — all file-op methods wrapped in app/app.go:
       git commit -m "refactor(app): delegate file operations to C++ when UseCppBackend=true"
  3. Write and delete verified end-to-end; Go fallback path regression confirmed:
       git commit -m "test(fileops): verify C++ file ops end-to-end and Go fallback unchanged"
```

### Effects
- `cpp/src/fileops.hpp`, `cpp/src/fileops.cpp`: full file-ops IPC handlers
- `app/app.go`: all file-op methods wrapped with `UseCppBackend` guard
- Language detection duplicated in C++ (intentional — Go version deleted in Phase 5)

---

## Prompt 2.2 — Config System in C++

```
Context: terminal-IDE. Config is managed in Go — app/app.go has GetConfig, SaveConfig, and
ResetConfig methods that read/write a JSON config file at %APPDATA%\cmdIDE\config.json. Fields
include theme, font family, font size, keybindings, and any other user preferences. We want C++ to
own config I/O while guaranteeing the JSON format is byte-identical (same field names, same
defaults, same indentation: 2 spaces).

Task: Implement the config system in C++.

C++ files to create: cpp/src/config.hpp, cpp/src/config.cpp

Requirements:
- class Config backed by nlohmann::json
- Load from %APPDATA%\cmdIDE\config.json; create with defaults if the file is missing
- Defaults must match current Go defaults exactly — read app/app.go GetConfig / SaveConfig to
  extract every field and its default value before writing any C++ code
- IPC messages:
    config.get          → full config as JSON object
    config.set          {"key":"...","value":...}   → sets one key, persists, returns {"ok":true}
    config.reset        → restores all defaults, persists, returns {"ok":true}
- JSON serialization: nlohmann::json::dump(2)  (2-space indent, matches Go's
  json.MarshalIndent(v, "", "  "))
- File write: write to a .tmp file first, then MoveFileExW with MOVEFILE_REPLACE_EXISTING
  (atomic replace on same volume — prevents corrupt config on crash)

Go changes: GetConfig, SaveConfig, ResetConfig in app/app.go wrapped with UseCppBackend guard.

Verification: toggle UseCppBackend on and off several times, changing a config value each time.
%APPDATA%\cmdIDE\config.json must be byte-identical regardless of which path wrote it last.

Git commits — commit after each of the following milestones:
  1. Config class compiles; config.get returns correct defaults on a clean machine:
       git add cpp/src/config.hpp cpp/src/config.cpp
       git commit -m "feat(cpp): add Config class backed by nlohmann::json with atomic file writes"
  2. config.set and config.reset IPC messages working; Go methods wrapped:
       git commit -m "refactor(app): delegate config get/set/reset to C++ when UseCppBackend=true"
  3. Byte-identical JSON confirmed by diffing config.json output from both paths:
       git commit -m "test(config): confirm config.json byte-identical between Go and C++ paths"
  4. Push the branch:
       git push
```

### Effects
- `cpp/src/config.hpp`, `cpp/src/config.cpp`
- `app/app.go`: config methods wrapped
- Config file format guaranteed identical between Go and C++ paths

---

## Phase 2 Checklist

- [ ] File explorer opens and shows the correct directory tree
- [ ] Open a file, edit it, save — file on disk matches what was written
- [ ] Config change (e.g., switch theme) persists across app restart
- [ ] Toggle `UseCppBackend` to `false` → all of the above still work via Go path (regression)
- [ ] `config.json` is byte-identical whether written by Go or C++
- [ ] `git log --oneline` shows a clean commit per milestone
- [ ] Branch pushed and visible to collaborators
