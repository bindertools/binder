# cmdIDE

A desktop terminal IDE built with Wails, Go, React, and TypeScript. Combines a multi-tab terminal, file editor, live preview, performance monitoring, port management, and a plugin system in a single native window.

---

## Features

### Terminal
- Multi-tab shell sessions with working directory persistence across restarts
- Supports every shell and CLI tool installed on the host — PowerShell, Command Prompt, Bash, Zsh, custom CLIs, language runtimes, all of it
- Session restore on reopen

### Editor
- Monaco-based editor with syntax highlighting and language detection
- Split-screen support

### Built-in Commands
| Command | Description |
|---|---|
| `/problems` | Scans the current directory and opens a structured problems tab |
| `/preview` | Opens a live preview tab for a file or URL |
| `/ports` | Shows all ports currently in use on the machine |
| `/perf` | Opens a performance tab — CPU, memory, disk, GPU, and network |
| `/pack` | Zips the current directory |
| `/pack --dryrun` | Previews what would be included in the zip, with raw and compressed size estimates |
| `/plugins` | Opens the plugin store |
| `/db` | Opens a database inspection tab for SQLite files |
| `/git` | Opens the Git Insights panel (requires Git plugin) |
| `/note` / `/notepad` | Opens the Notepad plugin tab |
| `/claude` | Opens the Claude AI plugin tab |

### Plugins
The plugin store (`/plugins`) lets you install official and community-built plugins. Official plugins ship as part of the app:

- **Git Insights** — a GitHub Desktop-style git panel for staging, committing, pushing, and branch management
- **Notepad** — persistent in-app notes with a sidebar list and full-height editor
- **Claude AI** — chat with Claude directly inside the IDE, with one-click "Run in terminal" for code suggestions

Community plugins can be installed from any public GitHub repository built with the CMD IDE Plugin SDK.

### Other Tabs
- **Preview** — renders files and URLs in a sandboxed panel
- **Ports** — live view of what's listening on which ports
- **Performance** — real-time CPU, memory, disk, GPU, and network graphs
- **Database** — SQLite file inspection

### Configuration
- Theme editor with full color customization and persistence
- Settings for font size, zoom, scroll speed, text wrap, and shell behavior
- Config stored in the user config directory under `cmdIDE/`

---

## Install

Download the latest release from the [Releases](../../releases) page.

| Artifact | Use case |
|---|---|
| `cmdIDE-installer.exe` | Standard install for end users |
| `cmdIDE.exe` | Portable build, no install step required |

On first run the app creates its config and session files in your user config directory under `cmdIDE/`.

---

## Build from Source

**Requirements:** Go 1.21+, Node.js 18+, Wails v2

```bash
# Install Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Clone and build
git clone https://github.com/cmdide/terminal-IDE
cd terminal-IDE/app
wails build
```

For a development server with hot reload:

```bash
cd app
wails dev
```

---

## Tech Stack

- **Shell:** [Wails v2](https://wails.io) (Go + WebView2)
- **Backend:** Go
- **Frontend:** React + TypeScript + Vite
- **Editor:** Monaco Editor
- **Styling:** CSS variables with runtime theme switching

---

## Platform Support

| Platform | Status |
|---|---|
| Windows | Supported |
| macOS | Planned |
| Linux | Planned |

---

## License

MIT
