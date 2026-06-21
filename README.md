<div align="center">

# Binder

**A terminal-first desktop IDE for developers who live in the command line.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Wails](https://img.shields.io/badge/Wails-v2-red?logo=go)](https://wails.io)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#platform-support)
[![Build](https://github.com/BinderTools/binder/actions/workflows/code-quality.yml/badge.svg)](https://github.com/BinderTools/binder/actions/workflows/code-quality.yml)
[![Latest Release](https://img.shields.io/github/v/release/BinderTools/binder?label=release)](https://github.com/BinderTools/binder/releases/latest)

[**Download**](https://github.com/BinderTools/binder/releases/latest) · [**Docs**](docs/) · [**Themes**](app/themes/) · [**Plugin SDK**](packages/) · [**Contributing**](CONTRIBUTING.md)

</div>

---

Binder is a native desktop application built with [Wails](https://wails.io), [Go](https://go.dev), and [React](https://react.dev). It wraps your real shell in a multi-tab, session-restoring terminal, then layers on a Monaco-powered editor, live preview, database inspector, plugin system, and more — all in a single window, with no browser involved.

## Features

### Terminal
- Multi-tab shell sessions — PowerShell, Bash, Zsh, CMD, or any shell on the host
- Working directory persists across tabs and across restarts (full session restore)
- Ctrl+click file paths and URLs to open them directly in the editor or browser
- Fullscreen IDE mode: Monaco editor with split-panel view, file tree, and status bar

### Editor
- Monaco-based editor (the same engine powering VS Code)
- Syntax highlighting for 50+ languages with automatic detection
- Split-panel view, word wrap, indent guides, minimap, Ctrl+wheel zoom
- Line/column counter, encoding display, line-ending indicator

### Built-in Commands

| Command | Description |
|---|---|
| `/help` | Show all available commands |
| `/fullscreen` · `/fs` | Open the fullscreen file editor |
| `/preview <file\|url>` | Render a file or URL in a live sandboxed panel |
| `/problems` | Scan the current directory and surface linting and error output |
| `/ports` | Show all ports currently in use on this machine |
| `/performance` | Real-time CPU, memory, disk, GPU, and network graphs |
| `/pack` | Zip the current working directory |
| `/pack --dryrun` | Preview zip contents and estimated sizes without writing |
| `/plugins` | Open the plugin store |

### Plugins
Install official and community plugins from the built-in store (`/plugins`), or load any plugin directly from a public GitHub repository built with the [Binder Plugin SDK](packages/).

### Other Panels
- **Database** — open and inspect SQLite files inline
- **Ports** — live view of listening ports with one-click kill
- **Performance** — real-time system graphs (CPU, memory, disk, GPU, network)
- **Preview** — sandboxed renderer for files and URLs

### Themes
10 built-in themes with a live custom theme editor. Themes are SCSS-based and live in [their own repository](app/themes/) — community themes are welcome via pull request.

| Key | Style |
|-----|-------|
| `minimal` | Apple iOS/macOS dark, muted grays |
| `dark` | VS Code dark default |
| `blackout` | Pure black, high contrast |
| `dim-green` | Retro phosphor green terminal |
| `dim-blue` | Cool blue monochrome terminal |
| `neon-night` | Cyberpunk — deep purple with neon accents |
| `solarized` | Classic Solarized Dark |
| `nord` | Arctic blue palette |
| `coffee` | Warm espresso browns and amber |
| `gruvbox` | Retro groove — warm oranges and greens |

### Configuration
- Full theme editor — customize every color, save and export as JSON
- Settings for font size, zoom level, scroll speed, word wrap, indent guides, minimap
- Git branch display in the terminal prompt
- Soft-close protection against accidentally discarding unsaved work
- Config stored in the OS user config directory under `Binder/`

---

## Install

Download the latest release from the [Releases](https://github.com/BinderTools/binder/releases/latest) page.

| Artifact | Description |
|---|---|
| `Binder-setup.exe` | Windows setup |
| `Binder.exe` | Portable Windows build — unzip and run, no install required |
| `Binder-macos.zip` | macOS universal binary |
| `Binder-linux` | Linux binary (amd64) |

On first launch, the app creates its config and session files at:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\Binder\` |
| macOS | `~/Library/Application Support/Binder/` |
| Linux | `~/.config/Binder/` |

---

## Build from Source

**Requirements:** Go 1.21+, Node.js 18+, [Wails v2 CLI](https://wails.io/docs/gettingstarted/installation)

```bash
# Install the Wails CLI (one-time setup)
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Clone with all submodules
git clone --recurse-submodules https://github.com/BinderTools/binder
cd binder/app

# Development server with hot reload
wails dev

# Production build
wails build
```

To produce all release artifacts (Windows):

```powershell
# From the repo root
./build.ps1
```

### Submodules

This repo uses git submodules for the shell backends and themes. If you cloned without `--recurse-submodules`, initialize them with:

```bash
git submodule update --init --recursive
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Wails v2](https://wails.io) (Go + WebView2 / WKWebView) |
| Backend | Go |
| Frontend | React + TypeScript + Vite |
| Editor | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| Terminal | xterm.js — [BinderTools/terminal](app/terminal/) |
| Themes | SCSS — [BinderTools/binder-themes](app/themes/) |
| Database | modernc SQLite (pure Go, no CGO) |
| Styling | CSS custom properties with runtime theme switching |

---

## Platform Support

| Platform | Architecture | Status |
|----------|-------------|--------|
| Windows 10/11 | x64 | ✅ Fully supported |
| macOS 12+ | Apple Silicon (arm64) | ✅ Fully supported |
| macOS 12+ | Intel (amd64) | ✅ Fully supported |
| Linux | x64 | ✅ Supported (requires WebKitGTK) |

---

## Repository Structure

```
binder/
├── app/                  # Main Wails application (Go + React)
│   ├── frontend/         # React + TypeScript frontend
│   ├── themes/           # SCSS theme system (git submodule)
│   ├── terminal/         # xterm.js terminal backend (git submodule)
│   ├── powershell/       # PowerShell shell backend (git submodule)
│   ├── bash/             # Bash shell backend (git submodule)
│   └── zsh/              # Zsh shell backend (git submodule)
├── setup/                # Setup application
├── packages/
│   └── plugin-sdk/       # Plugin SDK for community plugin authors
├── docs/                 # Documentation
├── scripts/              # Build and utility scripts
└── build.ps1             # Full release build script
```

---

## Contributing

Contributions are welcome — bug fixes, new features, themes, and documentation improvements.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Key points:

- Open an issue before starting any large feature to align on approach
- Follow the existing code style (gofmt for Go, project ESLint config for TypeScript)
- All PRs require a passing CI build

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

---

## License

[MIT](LICENSE) — Copyright © 2026 Kris Powers
