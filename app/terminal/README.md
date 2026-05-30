# terminal

Go package that provides terminal bridging utilities for [cmdIDE](https://github.com/Command-IDE/cmdIDE). Handles platform-specific concerns such as suppressing console windows on Windows and resolving the default working directory for new terminal sessions.

## Import

```go
import term "github.com/Command-IDE/terminal"
```

## API

### `NoWindow(cmd *exec.Cmd)`

Suppresses the console window that Windows would otherwise flash when spawning a background child process (`CREATE_NO_WINDOW = 0x08000000`). No-op on macOS and Linux.

### `DefaultDir(configDefault string) string`

Returns the best starting directory for a new terminal session. Checks (in order):

1. The user-supplied `configDefault` path (if non-empty and exists)
2. The Documents folder (Windows: from the registry; macOS/Linux: `~/Documents`)
3. The user's home directory

## Build tags

| File | Tag | Purpose |
|------|-----|---------|
| `exec_windows.go` | `windows` | `CREATE_NO_WINDOW` syscall |
| `exec_other.go` | `!windows` | no-op stub |
| `defaultdir_windows.go` | `windows` | Registry-based Documents lookup |
| `defaultdir_other.go` | `!windows` | POSIX Documents lookup |

## Dependencies

- [`golang.org/x/sys`](https://pkg.go.dev/golang.org/x/sys) — Windows registry access for the Documents folder path

## Used by

This package is a sub-module of [cmdIDE](https://github.com/Command-IDE/cmdIDE) and is consumed via a `replace` directive in the host app's `go.mod` during development.

## License

MIT
