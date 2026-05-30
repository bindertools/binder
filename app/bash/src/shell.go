//go:build !windows

package bash

import (
	"os/exec"
	"strings"
)

// DefaultShell is the bash executable name.
const DefaultShell = "bash"

// Command returns an exec.Cmd that runs parts through bash.
func Command(parts []string) *exec.Cmd {
	return exec.Command("bash", "-c", strings.Join(parts, " "))
}

// BuildShellCmd returns a bash-backed exec.Cmd for external command execution.
func BuildShellCmd(parts []string) *exec.Cmd {
	return Command(parts)
}
