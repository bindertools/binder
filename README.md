<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/binder-repo.png">
  <img src=".github/assets/binder-wide-light.png" alt="Binder" width="600">
</picture>

**A terminal-first desktop IDE for developers who live in the command line.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/BinderTools/binder/actions/workflows/code-quality.yml/badge.svg)](https://github.com/BinderTools/binder/actions/workflows/code-quality.yml)
[![Latest Release](https://img.shields.io/github/v/release/BinderTools/binder?label=release)](https://github.com/BinderTools/binder/releases/latest)

[Download](https://github.com/BinderTools/binder/releases/latest) · [Docs](docs/) · [Contributing](CONTRIBUTING.md)

</div>

---

Binder is a native desktop app (C++ + WebView + React) that wraps your real shell in a multi-tab, session-restoring terminal, then layers on a code editor, live preview, database inspector, and more. All in one window.

## Features

- **Terminal**: multi-tab sessions (any shell), session restore, Ctrl+click paths and URLs
- **Editor**: GPU-accelerated renderer with tree-sitter syntax highlighting, file explorer, split panes, find/replace, minimap
- **Live Preview**: sandboxed renderer for HTML files and URLs
- **Database**: inline SQLite inspector with privacy mode
- **Version Control**: git status, staging, diff, and branch management
- **Ports**: live view of listening ports with port forwarding
- **Workflows**: YAML-based automation runner with a visual graph view
- **Performance**: real-time CPU, memory, disk, GPU, and network graphs
- **Problems**: code diagnostics scanner with CWE vulnerability detection
- **Apps**: built-in app store for installing first-party and community apps
- **Themes**: dark and light presets plus a full live custom theme editor

### Syntax highlighting

Tree-sitter grammars are compiled directly into the binary for zero-latency highlighting with no runtime downloads. Supported languages: C, C++, C#, CSS, Dockerfile, Go, HTML, Java, JavaScript, JSON, Lua, Markdown, Python, Rust, SCSS, Bash, TOML, TypeScript, TSX, YAML, Zig.

## Install

Download from the [Releases](https://github.com/BinderTools/binder/releases/latest) page.

| Artifact | Platform |
|---|---|
| `Binder-setup-windows.exe` | Windows installer (stable channel) |
| `Binder-setup-dev-windows.exe` | Windows installer (dev channel) |
| `Binder-windows-amd64.exe` | Windows portable |

## Build from Source

**Requirements:** CMake 3.26+, [vcpkg](https://github.com/microsoft/vcpkg), Node.js 18+, Python 3, MSVC (Windows)

```bash
git clone --recurse-submodules https://github.com/BinderTools/binder
cd binder
```

Set `VCPKG_ROOT` to your vcpkg installation, then:

```powershell
./build.ps1
```

Build flags:

```powershell
./build.ps1 -AppOnly    # skip setup installers
./build.ps1 -SetupOnly  # skip the main app
./build.ps1 -Version v1.2.3
```

Output artifacts land in `cpp/build/Release/`.

If you cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

## Architecture

The backend is a C++17 static library (`binder-backend-lib`) that handles terminal I/O, file operations, config, session persistence, tree-sitter parsing, auto-update, and more. The frontend is a React/TypeScript app built with Vite, embedded directly into the host executable as a zip resource on Windows (no `www/` sidecar needed).

Each installable app ships its own C++ DLL loaded on demand by the host — an uninstalled app contributes zero compiled weight or running state. The frontend communicates with the C++ backend over a thin JSON IPC bridge exposed through the WebView.

| Platform | WebView |
|---|---|
| Windows | WebView2 (Edge/Chromium) |
| Linux | WebKit2GTK |
| macOS | WKWebView |

## Plugins

Plugins are single-file ESM bundles installed at runtime from public GitHub repositories. They can add sidebar panels, new tab types, and terminal slash commands.

See [`packages/plugin-sdk`](packages/plugin-sdk) for the SDK, type definitions, and build guide.

## License

[MIT](LICENSE) — Copyright © 2026 Kris Powers
