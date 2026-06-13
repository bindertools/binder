# In-House Editor & Explorer Migration Plan

Decision record for replacing Monaco with an in-house, C++-backed,
GPU-rendered editor and explorer. Researched 2026-06-12 on branch
`feat/webview-migration`.

## 1. Current-state audit

### Editor (two Monaco surfaces — both get replaced)

- `app/frontend/src/components/Editor.tsx` — per-tab Monaco editor used by
  App.tsx editor tabs (`Editor.tsx:184`). Content is read **once** via
  `ReadFile` (`App.tsx:1056`, `App.tsx:679`) and passed as `defaultValue`;
  auto-save via 1s-debounced `WriteFile` (`Editor.tsx:172-178`). Word-based
  completions only (`Editor.tsx:80-99`).
- `app/frontend/src/fullscreen/FullscreenIDE.tsx` — the main IDE overlay.
  Always-mounted below `SplitPaneView` (comment at `App.tsx:1098`) so its
  state survives tab switches. Open files live in React state (`openFiles`),
  one Monaco model per path, cursor/scroll preserved via
  `viewStatesRef: Map<"panel:path", viewState>` (`FullscreenIDE.tsx:132-135`).
  Has split view (left/right panels), diff-ish workflows, Ctrl+S capture
  (`FullscreenIDE.tsx:442`).

### Open-file / session preservation (the critical constraint)

- Preservation is **entirely frontend-side today**: it works only because
  `FullscreenIDE` never unmounts. Buffer text, undo history, and view state
  all live in Monaco models in JS memory.
- `cpp/src/session.cpp` is a SQLite store (`sessions.db`) for tab *metadata*
  and command history — it does **not** hold buffer content, cursor, or undo
  state.
- Consequence: a window reload loses unsaved edits and undo history; App.tsx
  editor tabs re-read the file each time a tab is created. Moving buffers to
  the backend is a strict improvement, not a regression risk.

### Explorer

- `app/frontend/src/fullscreen/FileExplorer.tsx` (316 lines) — plain DOM
  tree, no virtualization, no skeletons.
- Data: `ExplorerOpen` → `fs.tree` → `fileops::build_tree`
  (`cpp/src/fileops.cpp:76`) — **eager full recursive walk** of the whole
  cwd. No lazy loading, no file watching anywhere in `cpp/`.

### IPC surface

- Frontend: `app/frontend/src/lib/ipc.ts` — `invoke<T>(type, args)` +
  `on/off/offAll` for backend-push events; `wails-shim.ts` adapts legacy
  Wails imports to `invoke`.
- Backend: `cpp/host/dispatch.cpp` — new-style inline handlers
  (`Dispatcher::dispatch`, line 136) plus `old_to_new` (line 97) delegating
  to module dispatchers (`fileops::dispatch`, `search_ops::dispatch`, …).
  Result envelope: `{ok:true,data}` / `{ok:false,error}`. Events:
  `Dispatcher::emit` → `window.__cmdide_emit` (dispatch.cpp:89).
- New editor IPC plugs in as another module in the `old_to_new` chain; push
  events need `Dispatcher::emit` (new-style), so the buffer module exposes an
  emit callback hook.

### GPU rendering precedent

- `Terminal.tsx:268-279` — xterm `WebglAddon` with Canvas/DOM fallback,
  working today in WebView2. Proves WebGL glyph-atlas text rendering in this
  exact host.

### Reusable vs replaced

- **Reuse**: IPC layer (ipc.ts + dispatch chain), `fs.*` ops, session.cpp
  storage, theme system (`themes.ts` exposes token colors), tab/pane model,
  search.cpp (backend search exists for the search palette).
- **Replace**: both Monaco surfaces, `monaco-editor` +
  `@monaco-editor/react` deps, FileExplorer.tsx rendering + `fs.tree` eager
  walk.

## 2. Parsing / highlighting — tree-sitter (decided)

- **Core runtime via vcpkg** — port `tree-sitter` 0.26.9 exists upstream and
  in the local vcpkg checkout; pure C, MIT, static-links cleanly on all three
  platforms with our existing manifest + `x64-windows-static` triplet. This
  matches how every other C++ dep is consumed here. (Verified 2026-06-12.)
- **Grammars vendored as generated C** in `cpp/third_party/grammars/<lang>/`
  (`parser.c`, optional `scanner.c`, `queries/highlights.scm`, license).
  vcpkg has only a handful of grammar ports — not our full language list — so
  vendoring generated parsers (no codegen step, no node/rust toolchain) is
  the portable story. Grammar ABI 14/15 is compatible with runtime 0.26.
- POC grammars: **JSON v0.24.8** (tiny, no scanner) and **JavaScript
  v0.25.0** (real-world scale, external scanner, rich highlights query).
  TypeScript/TSX use the identical pipeline (their `parser.c` is just much
  larger) — phase 2. All required languages (C, C#, C++, Zig, Rust, Go, HTML,
  CSS, SCSS, TS/TSX/JS/JSX, Java, Lua, JSON, Markdown, YAML, TOML, Python,
  Bash, Dockerfile) have maintained tree-sitter grammars.
- **Highlighting**: run each grammar's `highlights.scm` through the C query
  API (`ts_query_new` / `ts_query_cursor_exec`). Note: the C library parses
  but does **not evaluate** query predicates (`#eq?`, `#match?`, …) — the
  buffer module implements a small predicate evaluator. Capture names
  (`keyword`, `string`, `function`, …) are shipped to the frontend as a style
  table; the frontend maps them to theme colors.
- **Incremental**: on edit → `ts_tree_edit(old_tree, &edit)` →
  `ts_parser_parse` (reuses unchanged subtrees) →
  `ts_tree_get_changed_ranges(old, new)` → re-run the highlight query only
  over changed ranges → ship only changed lines' spans.

## 3. GPU rendering — WebGL2 baseline (decided)

- **WebGL2** is available and proven in all three targets; xterm's WebGL
  addon already runs in this app's WebView2 (`Terminal.tsx:268`). WebGL2 has
  shipped in WKWebView since Safari 15 and in WebKitGTK for years.
- **WebGPU is NOT a viable baseline** (verified 2026-06): shipped in
  Safari 26 (Sept 2025) but not on by default in WKWebView on earlier OS
  versions; WebKitGTK support is experimental/off by default; WebView2 has it
  via Chromium. Treat WebGPU as a per-platform progressive enhancement later,
  never a requirement.
- Renderer model (xterm-style): offscreen Canvas2D rasterizes glyphs in
  white into a texture atlas keyed by codepoint; WebGL2 draws one quad per
  visible glyph, tinted by vertex color from the highlight span. Solid rects
  (current-line, selection, cursor, scrollbar, minimap) reuse a white-pixel
  atlas region. Only the viewport's lines are tessellated per frame —
  100k-line files cost the same per frame as 50-line files.
- Canvas2D is the fallback path (same renderer interface), mirroring xterm's
  WebGL→Canvas→DOM ladder.

## 4. IPC additions (namespace `buffer.*`, `explorer.*`)

Request/response (via existing `invoke`):

| Type | Args | Result |
|------|------|--------|
| `buffer.open` | `{path}` | `{bufferId, version, language, captureNames[], lines[], spans[][]}` |
| `buffer.edit` | `{bufferId, version, range{startLine,startCol,endLine,endCol}, text}` | `{version, lineDelta, startLine, lines[], spans[][], incremental, parseUs, changedRanges}` |
| `buffer.close` | `{bufferId}` | `{ok}` |
| `buffer.save` | `{bufferId}` | `{ok}` (writes backend text to disk) |
| `buffer.list` | `{}` | `[{bufferId, path, dirty, version}]` |
| `buffer.search` (phase 3) | `{bufferId, query, regex}` | match ranges |
| `buffer.complete` (phase 4) | `{bufferId, line, col}` | candidates from parse tree |
| `explorer.readdir` (phase 5) | `{path}` | one level, lazy |
| `explorer.watch` / `explorer.unwatch` (phase 5) | `{path}` | — |

Push events (via `Dispatcher::emit`): `buffer:changed` (external file change
detected), `explorer:changed` (watched dir delta). Spans are
`[startCol, endCol, captureIdx]` triples per line, columns in UTF-16 code
units (converted backend-side from tree-sitter byte offsets).

## 5. Session / buffer manager design

- `cpp/src/editor_buffers.{hpp,cpp}`: registry `bufferId → Buffer{path,
  text, line index, TSParser, TSTree, version, dirty, undo stack}` — owned by
  the backend, **independent of any tab/view**.
- Frontend tabs hold only `{bufferId, scrollTop, cursor}` view state.
  Switching tabs = pointing the renderer at a different bufferId; the buffer
  stays warm (parsed tree, spans, undo) regardless of what's displayed.
  Multiple panes can view one buffer.
- Versioning: every edit increments `version`; responses echo it so a stale
  frontend mirror can resync via `buffer.open` semantics (refetch). Undo/redo
  become backend ops (`buffer.undo`) in phase 2 — undo history then survives
  even a frontend reload, which Monaco's model never could.
- Frontend keeps a text mirror purely for zero-latency rendering between
  keystroke and edit-ack; the backend is the source of truth (saves write
  backend text).

## 6. Phased roadmap

1. **P1 — this session (POC slice)**: vendor tree-sitter + JSON/JS grammars;
   `editor_buffers` module with open/edit/close + incremental highlight over
   IPC; WebGL2 glyph-atlas renderer behind opt-in flag
   (`localStorage cmdide.nativeEditor = "1"`) rendering text, syntax colors,
   line numbers, current-line highlight, basic typing. Monaco untouched.
2. **P2 — editing core**: backend undo/redo, multi-cursor model,
   bracket-match/auto-close/auto-indent (tree-sitter node-aware), selection
   rendering, Ctrl+S save path, remaining grammars (TS/TSX first), buffer ↔
   FullscreenIDE integration replacing the left/right Monaco panels.
3. **P3 — find/replace + minimap**: `buffer.search` (regex via std::regex or
   PCRE2 later), match highlight overlay, minimap (downscaled span texture —
   nearly free given spans already exist), scrollbar markers.
4. **P4 — autocomplete**: provider interface (`CompletionProvider`) fed by
   tree-sitter symbol extraction + keyword tables; LSP client can implement
   the same interface later without architectural change.
5. **P5 — explorer**: `explorer.readdir` lazy walk + native file watching
   (ReadDirectoryChangesW / FSEvents / inotify) + virtualized GPU/DOM-hybrid
   tree with skeleton rows.
6. **P6 — diff view + Monaco removal**: two-buffer diff render mode for the
   Version Control tab; delete `monaco-editor`, `@monaco-editor/react`, both
   old editor components; bundle-size win (~3 MB min+gz of JS removed).

## 7. Risks / notes

- WebView2 IPC payloads are strings through `__cmdide_invoke`; a 100k-line
  file's full span set on open is a few MB of JSON — acceptable on open, but
  edits must (and do) ship only changed lines. If open-payload latency
  becomes an issue, switch spans to a packed base64 `Uint32Array`.
- Query predicate evaluation is on us (C API limitation) — implemented for
  `#eq?`/`#not-eq?`/`#match?`/`#not-match?`/`#any-of?`; upstream
  `highlights.scm` files using exotic predicates may degrade gracefully
  (capture kept, predicate treated as pass).
- Grammar `parser.c` files are large (JS ~3 MB, TS ~20 MB+); compile time is
  the cost, runtime size is small. Vendor only what we ship.
- `cpp/src/fileops.cpp` line endings: buffers store bytes verbatim; CRLF
  handling lives in the renderer/edit layer (split on `\n`, strip `\r` for
  display, preserve on save).
