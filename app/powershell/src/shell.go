//go:build windows

package powershell

import (
	"os/exec"
)

// DefaultShell is the executable used for interactive command execution on Windows.
const DefaultShell = "powershell.exe"

// Command returns an exec.Cmd that runs the raw command line through PowerShell.
// The line is passed as-is; PowerShell handles all quoting and tokenisation.
// -NoProfile skips user startup scripts for a clean environment.
// -ExecutionPolicy Bypass allows local scripts (e.g. .\build.ps1) without
// requiring a permanent machine-level policy change.
func Command(line string) *exec.Cmd {
	return exec.Command("powershell.exe",
		"-NoProfile", "-ExecutionPolicy", "Bypass",
		"-Command", line)
}

// BuildShellCmd returns the PowerShell-backed exec.Cmd for external command
// execution on Windows.
func BuildShellCmd(line string) *exec.Cmd {
	return Command(line)
}

// BuildShellCmdWithPref is the Windows implementation — pref is ignored since
// PowerShell is always used on Windows.
func BuildShellCmdWithPref(line string, _ string) *exec.Cmd {
	return Command(line)
}
