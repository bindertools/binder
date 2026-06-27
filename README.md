<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/binder-repo.png">
  <img src=".github/assets/binder-wide-light.png" alt="Binder" width="100%">
</picture>

**Native desktop app combining terminal, code editor, and dev tools in one window.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/BinderTools/binder/actions/workflows/code-quality.yml/badge.svg)](https://github.com/BinderTools/binder/actions/workflows/code-quality.yml)
[![Latest Release](https://img.shields.io/github/v/release/BinderTools/binder?label=release)](https://github.com/BinderTools/binder/releases/latest)

[Download](https://github.com/BinderTools/binder/releases/latest) · [Docs](docs/) · [Contributing](CONTRIBUTING.md)

</div>

---

Binder is a native desktop app (C++ + WebView + React) built for developers who want their terminal, editor, and tooling all in one place without the weight of an Electron app.

## Core features

- **Terminal**: multi-tab sessions (any shell), session restore, Ctrl+click paths and URLs
- **Code editor**: GPU-accelerated, tree-sitter syntax highlighting, file explorer, split panes, find/replace, minimap
- **Performance**: real-time CPU, memory, disk, GPU, and network graphs
- **Problems**: code diagnostics scanner with CWE vulnerability detection
- **Themes**: dark and light presets, full live custom theme editor and keybinding customization

## Apps

Binder has an in-app store for installing and uninstalling tools as needed. All current apps are built and maintained by BinderTools, with community-built apps also available.

| App | Description |
|---|---|
| **Version Control** | Stage, commit, branch, and review diffs |
| **Database** | Browse and query `.db`/`.sqlite` files in the current project |
| **Live Preview** | Preview `.md`/`.html` files and forwarded URLs without leaving the app |
| **Ports & Endpoints** | Inspect open ports, manage port forwards, and track HTTP endpoints |
| **Workflows** | Define, run, and monitor multi-step automation workflows |
| **Notepad** | Persistent in-app note-taking |

### Syntax highlighting

Tree-sitter grammars are compiled into the binary. Supported: Bash, C, C++, C#, CSS, Dockerfile, Go, HTML, Java, JavaScript, JSON, Lua, Markdown, Python, Rust, SCSS, TOML, TypeScript, TSX, YAML, Zig.

## Install

Download from the [Releases](https://github.com/BinderTools/binder/releases/latest) page.

| Artifact | Platform |
|---|---|
| `Binder-setup-windows.exe` | Windows installer (stable) |
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

Flags:

```powershell
./build.ps1 -AppOnly     # skip setup installers
./build.ps1 -SetupOnly   # skip the main app
./build.ps1 -Version v1.2.3
```

Output goes to `cpp/build/Release/`. If you cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

## License

[MIT](LICENSE) — Copyright © 2026 Kris Powers
