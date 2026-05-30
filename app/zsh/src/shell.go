//go:build !windows

package zsh

import (
	"os/exec"
	"strings"
)

// DefaultShell is the zsh executable name.
const DefaultShell = "zsh"

// Command returns an exec.Cmd that runs parts through zsh.
func Command(parts []string) *exec.Cmd {
	return exec.Command("zsh", "-c", strings.Join(parts, " "))
}

// BuildShellCmd returns a zsh-backed exec.Cmd for external command execution.
func BuildShellCmd(parts []string) *exec.Cmd {
	return Command(parts)
}
