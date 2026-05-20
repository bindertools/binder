# Changelog

All notable changes to cmdIDE are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- 10 built-in themes: Minimal, Dark, Blackout, Dim Green, Dim Blue, Neon Night, Solarized, Nord, Coffee, Gruvbox
- SCSS-based theme system with `data-theme` attribute switching — themes live in their own repository ([`app/themes/`](app/themes/))
- Community theme support: themes contributed via pull request are compiled into the app at build time
- Fullscreen IDE mode with split-panel Monaco editor, file tree, and status bar
- Tab bar in fullscreen IDE: preview (unpinned) tabs, pinned-on-edit behavior, drag-and-drop between panels
- Right-click context menu on fullscreen tabs: Close, Close All, Close Others, Close Left/Right, Move to Panel
- Multi-select tabs with Ctrl+click and Shift+click
- Status bar: line/column, total lines, encoding, line endings, tab size, zoom level
- Ctrl+wheel zoom in the fullscreen editor
- Config options wired into fullscreen UI: indent guides, minimap, word wrap, default zoom
- `/fullscreen` and `/fs` commands added to terminal autocomplete and `/help` output
- `file_word_wrap` and `terminal_word_wrap` settings exposed in the Settings panel
- Sub-package architecture: `session`, `plugins`, `config`, `search` extracted from the main package into proper Go sub-packages
- `.wailsignore` to exclude non-essential files (READMEs, go.mod files from submodules, plugin SDK source) from the Wails build watcher and packaging

### Changed
- Build script (`build.ps1`) rewritten with retry logic for OneDrive file locking, pre-clean step, and hard failure on stale binaries
- Go package structure reorganized: `app/database/`, `app/perf/`, `app/ports/`, `app/problems/`, `app/pack/`, `app/session/`, `app/config/`, `app/search/`, `app/plugins/` are now proper sub-packages

---

## [0.1.0] — Initial Release

### Added
- Multi-tab terminal with session restore across restarts
- Monaco-based editor with syntax highlighting for 50+ languages
- Built-in commands: `/problems`, `/preview`, `/ports`, `/performance`, `/pack`, `/plugins`, `/help`
- Plugin store with support for community plugins loaded from GitHub repositories
- SQLite database inspector
- Real-time performance monitoring (CPU, memory, disk, GPU, network)
- Port manager with one-click kill
- Live preview panel for files and URLs
- Full theme editor with color customization and JSON export/import
- Git branch display in terminal prompt
- Soft-close protection for unsaved files
- Config persistence under the OS user config directory
- Windows, macOS, and Linux support via Wails v2
- Automated CI: code quality, security review (CodeQL), and cross-platform release builds

---

[Unreleased]: https://github.com/Command-IDE/terminal-IDE/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Command-IDE/terminal-IDE/releases/tag/v0.1.0
