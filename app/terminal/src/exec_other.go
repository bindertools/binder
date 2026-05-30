//go:build !windows

package terminal

import "os/exec"

// NoWindow is a no-op on macOS and Linux — console window suppression is a
// Windows-only concern.
func NoWindow(_ *exec.Cmd) {}
