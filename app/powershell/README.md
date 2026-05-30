# powershell

Go package that provides cross-platform shell command execution for [cmdIDE](https://github.com/Command-IDE/cmdIDE). On Windows it routes commands through PowerShell; on macOS and Linux it falls back to `sh`.

## Import

```go
import ps "github.com/Command-IDE/powershell"
```

## API

### `BuildShellCmd(parts []string) *exec.Cmd`

Returns an `*exec.Cmd` that runs the joined parts as a shell command using the platform-appropriate shell.

- **Windows** — `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command <cmd>`
- **macOS / Linux** — `sh -c <cmd>`

### `Command(parts []string) *exec.Cmd` *(Windows only)*

Returns a PowerShell-backed `*exec.Cmd`. Use `BuildShellCmd` for cross-platform code.

### `DefaultShell` *(Windows only)*

String constant `"powershell.exe"` — the executable used for interactive sessions on Windows.

## Build tags

| File | Tag | Purpose |
|------|-----|---------|
| `shell.go` | `windows` | PowerShell implementation |
| `shell_other.go` | `!windows` | POSIX `sh` fallback |

## Used by

This package is a sub-module of [cmdIDE](https://github.com/Command-IDE/cmdIDE) and is consumed via a `replace` directive in the host app's `go.mod` during development.

## License

MIT
