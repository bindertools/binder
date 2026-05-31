# terminal-IDE Migration Roadmap
## Step 2 Complete ✅
All Go and Wails code removed. The application is now purely **C++ + WebView + TSX**.
See [step2-README.md](step2-README.md) for the Step 2 migration log.

## Go + Wails + TSX  →  Go + Wails + C++  →  C++ + WebView + TSX ✅

Each file in this folder is a self-contained phase. Feed the prompts inside to an AI assistant
one at a time. Each prompt includes enough context to execute cold — no memory of prior sessions
required.

---

## Phase Map

| File | Phase | Prompts | What changes |
|------|-------|---------|--------------|
| [phase-0-foundation.md](phase-0-foundation.md) | 0 — Foundation | 3 | C++ scaffold, Go IPC bridge, feature flag |
| [phase-1-terminal.md](phase-1-terminal.md) | 1 — Terminal Core | 4 | ConPTY + live PATH, custom commands, I/O routing, flag flip |
| [phase-2-files-config.md](phase-2-files-config.md) | 2 — Files & Config | 2 | File ops, config system |
| [phase-3-system-services.md](phase-3-system-services.md) | 3 — System Services | 3 | Search, ports/perf, preview HTTP server |
| [phase-4-data-utilities.md](phase-4-data-utilities.md) | 4 — Data & Utilities | 2 | Sessions/SQLite, pack/zip, update checker |
| [phase-5-retirement-prep.md](phase-5-retirement-prep.md) | 5 — Retirement Prep | 2 | Dead code removal, Option 3 assessment (incl. jumplist + splash) |
| [phase-f-tailwind.md](phase-f-tailwind.md) | F — Tailwind CSS | 1 | Frontend CSS migration (run at any time) |
| [phase-g-launcher.md](phase-g-launcher.md) | G — Dual Launcher | 3 | Live release downloader, version picker UI, two installer binaries |

**Total: 20 prompts** across 8 phases.

> **Notes on coverage:**
> - `envpath_windows.go` (live registry PATH) is addressed inside Phase 1.1's ConPTY requirements.
> - `jumplist_windows.go` and `splash_windows.go` are assessed in Phase 5.2 (Option 3 readiness).
>   Both stay in Go for all of Option 1; both move to C++ naturally for Option 3.
> - The installer (`installer/`) is covered entirely by Phase G.

---

## Git Workflow (applies to every phase)

**One branch for the entire migration:**
```
git checkout -b feat/cpp-migration
```
Create this once before starting Phase 0. All 17 prompts land on this branch.

**Commit after every backbone feature**, not every file save. Each commit should be a
self-contained, reviewable unit that leaves the app in a working state. Every prompt lists its
specific commit checkpoints in a **Git commits** section.

**Push after every phase** so collaborators can review progress and jump in:
```
git push -u origin feat/cpp-migration   # first time
git push                                 # subsequent pushes
```

**Commit message format** (conventional commits):
```
feat(cpp):       new C++ feature or file
feat(cppbridge): Go IPC bridge changes
refactor(app):   Go-side routing/delegation changes
refactor(terminal): Go terminal routing changes
build:           CMakeLists, vcpkg, build.ps1 changes
docs:            verification checklists, assessment docs
test:            new test files
```

---

## Execution Rules

1. **Complete phases in order** (0 → 1 → 2 → 3 → 4 → 5). Phase F can run at any time.
2. **One prompt per session.** Each prompt is intentionally scoped to a single reviewable PR.
3. **`UseCppBackend: false` is sacred until Phase 5.** Every change must leave the Go fallback
   path 100% working. Regression-test it after every prompt.
4. **Read before writing.** Every prompt that touches existing Go code starts with "Read before
   coding" — follow that instruction. ANSI output and JSON formats must be byte-identical.
5. **Phase 5 is irreversible.** Only run it when `UseCppBackend = true` has been stable in
   production for several weeks.

---

## Wire Protocol Reference

All IPC between Go and C++ uses **newline-delimited JSON** over a Windows named pipe
`\\.\pipe\cmdide-<pid>`.

Every request from Go includes an `"id"` field (UUID). Every C++ response echoes the same `"id"`.
`RoundTrip` uses this to match responses when multiple requests are in flight.

```jsonc
// Go → C++
{ "type": "terminal.write", "id": "abc123", "data": "aGVsbG8=" }

// C++ → Go
{ "type": "terminal.output", "id": "abc123", "data": "aGVsbG8gd29ybGQK" }
```

Data payloads that may contain binary bytes (terminal VT sequences, file contents) are
**base64-encoded** inside the JSON string. Everything else is plain UTF-8.

---

## Technology Stack (post-migration)

| Layer | Technology |
|-------|-----------|
| Desktop host | Wails v2 (Go) — thin shell only |
| IPC | Named pipe, newline-delimited JSON |
| Backend | C++17, CMake, vcpkg |
| Terminal | Windows ConPTY (`CreatePseudoConsole`) |
| HTTP preview | cpp-httplib |
| Markdown | cmark |
| JSON | nlohmann-json |
| Logging | spdlog |
| Database | SQLite (sqlite3 via vcpkg) |
| Zip | libzip |
| Frontend | React + TypeScript (TSX) |
| CSS | Tailwind CSS v4 (Phase F) |
| Build | build.ps1 (Wails + CMake) |

---

## Step 2 — Final Migration (Go/Wails → C++/WebView)

Step 1 is complete. **[Step 2 roadmap →](step2-README.md)**

Step 2 eliminates Go and Wails entirely, replacing the host with a native C++ WebView app
and migrating the installer from Go/Wails to C++/WebView. Phases H–N on branch
`feat/webview-migration`.
