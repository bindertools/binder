# zsh

Go package that provides zsh shell command execution for [cmdIDE](https://github.com/Command-IDE/cmdIDE) on macOS and Linux.

## Import

```go
import zshpkg "github.com/Command-IDE/zsh/src"
```

## API

### `BuildShellCmd(parts []string) *exec.Cmd`

Returns an `*exec.Cmd` that runs the joined parts through `zsh -c`.

### `Command(parts []string) *exec.Cmd`

Alias for `BuildShellCmd`.

### `DefaultShell`

String constant `"zsh"`.

## Build tags

This package is excluded from Windows builds via `//go:build !windows`.

## Used by

This package is a sub-module of [cmdIDE](https://github.com/Command-IDE/cmdIDE). On macOS and Linux the host app selects between zsh, bash, and sh based on user config and shell availability.

## License

MIT
