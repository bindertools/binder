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

Binder is a native desktop app (Go + Wails + React) that wraps your real shell in a multi-tab, session-restoring terminal, then layers on a code editor, live preview, database inspector, and more — all in one window.

## Features

- **Terminal** — multi-tab sessions (PowerShell, Bash, Zsh, CMD), session restore, Ctrl+click paths/URLs
- **Editor** — GPU-accelerated with tree-sitter syntax highlighting, split-panel view, find/replace, minimap
- **Preview** — sandboxed renderer for HTML files and URLs
- **Database** — inline SQLite inspector
- **Ports** — live view of listening ports with one-click kill
- **Performance** — real-time CPU, memory, disk, GPU, and network graphs
- **Plugins** — install from the built-in store (`/plugins`) or load any public GitHub repo built with the [Plugin SDK](packages/)
- **Themes** — 10 built-in themes plus a live custom theme editor

## Install

Download from the [Releases](https://github.com/BinderTools/binder/releases/latest) page.

| Artifact | Platform |
|---|---|
| `Binder-setup.exe` | Windows (installer) |
| `Binder.exe` | Windows (portable) |
| `Binder-macos.zip` | macOS universal |
| `Binder-linux` | Linux amd64 |

## Build from Source

**Requirements:** Go 1.21+, Node.js 18+, [Wails v2](https://wails.io/docs/gettingstarted/installation)

```bash
git clone --recurse-submodules https://github.com/BinderTools/binder
cd binder/app
wails dev    # dev server with hot reload
wails build  # production build
```

To produce all release artifacts (Windows):

```powershell
./build.ps1
```

If you cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

## License

[MIT](LICENSE) — Copyright © 2026 Kris Powers
