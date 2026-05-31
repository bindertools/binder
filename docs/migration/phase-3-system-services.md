# Phase 3 — System Services

## Overview

Move search/completions, ports/performance monitoring, and the preview HTTP server into C++. After
Phase 3, all active request-handling is owned by C++. The Go layer is reduced to a thin Wails host
that forwards events and delegates every real call to the subprocess.

---

## Git Workflow

**Branch:** `feat/cpp-migration` (already created in Phase 0)

Commit after each backbone feature listed in each prompt's **Git commits** section. Push after
this phase completes: `git push`

---

## Prompt 3.1 — Search and Completions in C++

```
Context: terminal-IDE. Go currently handles two search features: (1) ripgrep-based file content
search used by /search, and (2) tab-completion suggestions for file paths and command names. We want
both in C++.

Task: Implement search and completions in C++.

C++ files to create: cpp/src/search.hpp, cpp/src/search.cpp

IPC messages to handle:
  search.files   {"query":"...","path":"...","maxResults":50}
      Recursive filename search using std::filesystem::recursive_directory_iterator with
      case-insensitive substring match (no ripgrep needed for filenames).
      → {"type":"search.files","results":[{"path":"...","name":"..."},...]}

  search.content {"query":"...","path":"...","maxResults":50}
      Spawn rg --json as a child process, parse its NDJSON output.
      If rg is not on PATH, return empty results with a "warning":"ripgrep not found" field.
      → {"type":"search.content","results":[{"path":"...","line":int,"text":"..."},...]}

  complete.path  {"prefix":"..."}
      List filesystem paths starting with the given prefix.
      → {"type":"complete.path","completions":["...",...]}

  complete.command {"prefix":"..."}
      Return command names from the CommandRegistry starting with the given prefix.
      → {"type":"complete.command","completions":["...",...]}

Go changes: wrap the /search command dispatch in app/terminal.go and any completion methods in
app/app.go with the UseCppBackend guard.

Git commits — commit after each of the following milestones:
  1. search.files working (filename search returns correct results):
       git add cpp/src/search.hpp cpp/src/search.cpp
       git commit -m "feat(cpp): add filesystem search and tab-completion IPC handlers"
  2. search.content working (ripgrep integration verified or graceful fallback confirmed):
       git commit -m "feat(cpp): add ripgrep-backed content search with missing-rg fallback"
  3. Go search/complete methods wrapped; regression confirmed:
       git commit -m "refactor(terminal,app): delegate search and completions to C++ when UseCppBackend=true"
```

### Effects
- `cpp/src/search.hpp`, `cpp/src/search.cpp`
- `app/terminal.go`, `app/app.go`: search/complete methods wrapped

---

## Prompt 3.2 — Ports and Performance Monitoring in C++

```
Context: terminal-IDE. Go has a /ports command (shows listening TCP ports + process names) and a
performance monitor (/perf or similar — CPU, memory for the current session). These currently use
Go's net and os packages or shell out to netstat. We want both in C++ using native Windows APIs.

Task: Implement ports and performance monitoring in C++.

C++ files to create: cpp/src/sysinfo.hpp, cpp/src/sysinfo.cpp

IPC messages to handle:
  sysinfo.ports
      Use GetExtendedTcpTable from iphlpapi.h to enumerate listening TCP ports.
      For each port, resolve the owning process name via OpenProcess + GetModuleFileNameExW.
      → {"type":"sysinfo.ports","ports":[{"port":int,"pid":int,"process":"...","state":"..."},...]}

  sysinfo.perf
      CPU: compute from two GetSystemTimes samples 250ms apart (idle/kernel/user delta ratio).
      Memory: GlobalMemoryStatusEx for physical + commit charge.
      → {"type":"sysinfo.perf","cpu":float,"memMB":int,"commitMB":int}

  sysinfo.processes {"sortBy":"cpu"|"mem"|"name","limit":20}
      Enumerate via EnumProcesses / OpenProcess / GetProcessMemoryInfo / GetModuleFileNameExW.
      → {"type":"sysinfo.processes","processes":[{"pid":int,"name":"...","memMB":int},...]}

CMakeLists.txt: add iphlpapi.lib and psapi.lib to target_link_libraries for cmdide-backend.

Go changes: wrap /ports and /perf command handlers in app/terminal.go with UseCppBackend guard.

Read before coding: app/terminal.go — find the /ports handler and note the exact output format
(column widths, header text, ANSI colors) so C++ output is byte-identical.

Git commits — commit after each of the following milestones:
  1. sysinfo.ports returning correct data; CMakeLists updated with new link libs:
       git add cpp/src/sysinfo.hpp cpp/src/sysinfo.cpp cpp/CMakeLists.txt
       git commit -m "feat(cpp): add ports and process monitoring via GetExtendedTcpTable and psapi"
  2. sysinfo.perf returning CPU and memory; Go handlers wrapped:
       git commit -m "feat(cpp): add CPU/memory perf monitor; delegate /ports and /perf to C++"
```

### Effects
- `cpp/src/sysinfo.hpp`, `cpp/src/sysinfo.cpp`
- `CMakeLists.txt`: `iphlpapi.lib` + `psapi.lib` added to link libs
- `app/terminal.go`: `/ports` and `/perf` command handlers wrapped

---

## Prompt 3.3 — Preview HTTP Server in C++

```
Context: terminal-IDE. app/preview_server.go runs a local HTTP server for Markdown and HTML preview
(the /preview command). It serves files from the current working directory, renders Markdown to
HTML, and emits a Wails event when the server is listening. We want to move this HTTP server
entirely into C++.

Task: Implement the preview HTTP server in C++.

C++ files to create: cpp/src/preview.hpp, cpp/src/preview.cpp

Add to cpp/vcpkg.json:
  "cpp-httplib"  (header-only HTTP server — use the "httplib" port)
  "cmark"        (CommonMark Markdown → HTML renderer)

IPC messages to handle:
  preview.start  {"rootPath":"...","port":0}
      Start cpp-httplib server on any available port (port 0 = OS assigns).
      Serve static files from rootPath.
      For .md files: render to HTML via cmark_markdown_to_html, wrap in a minimal HTML shell with
      system-UI font and #1c1c1e background (match the app's dark theme).
      → {"type":"preview.started","port":int,"url":"http://localhost:<port>"}

  preview.stop   {}
      → {"type":"preview.stopped"}

  preview.status {}
      → {"type":"preview.status","running":bool,"port":int}

Go changes (app/preview_server.go):
  Wrap StartPreviewServer and StopPreviewServer with the UseCppBackend guard.
  When delegating to C++: after receiving the preview.started IPC response, forward the "url" to
  the frontend using the SAME Wails event name and payload structure as the current Go code.
  Read app/preview_server.go carefully to get the exact event name and payload shape before writing
  any code — the frontend must receive an identical event.

Git commits — commit after each of the following milestones:
  1. Preview server starts, serves static files, Markdown renders to HTML:
       git add cpp/src/preview.hpp cpp/src/preview.cpp cpp/vcpkg.json
       git commit -m "feat(cpp): add cpp-httplib preview server with cmark Markdown rendering"
  2. Go preview methods wrapped; Wails event forwarded with identical payload:
       git commit -m "refactor(preview_server): delegate preview start/stop to C++ when UseCppBackend=true"
  3. /preview command tested end-to-end; Go fallback confirmed:
       git commit -m "test(preview): verify C++ preview server and Go fallback path"
  4. Push the branch:
       git push
```

### Effects
- `cpp/src/preview.hpp`, `cpp/src/preview.cpp`
- `cpp/vcpkg.json`: `cpp-httplib`, `cmark` added
- `app/preview_server.go`: both methods wrapped with `UseCppBackend` guard
- Wails event forwarded with identical name and payload as current Go implementation

---

## Phase 3 Checklist

- [ ] `/search foo` returns filename and content results
- [ ] Tab-completion suggests file paths and command names
- [ ] `/ports` shows listening ports with correct process names
- [ ] `/perf` shows CPU and memory usage
- [ ] `/preview` opens a Markdown file in the browser, rendered correctly
- [ ] All three work with `UseCppBackend: false` (Go path regression check)
- [ ] `git log --oneline` shows a clean commit per milestone
- [ ] Branch pushed and visible to collaborators
