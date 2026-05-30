//go:build !windows

package powershell

import (
	"os"
	"os/exec"
)

// BuildShellCmd auto-detects the best available shell on macOS/Linux.
// Priority: zsh → bash → sh.
func BuildShellCmd(line string) *exec.Cmd {
	return BuildShellCmdWithPref(line, "")
}

// BuildShellCmdWithPref selects a shell by name ("zsh", "bash", "sh") and
// falls back to auto-detection when pref is empty or the shell is not found.
// line is the raw command string and is passed directly to the shell's -c flag.
func BuildShellCmdWithPref(line string, pref string) *exec.Cmd {
	if pref != "" {
		if path := findShell(pref); path != "" {
			return exec.Command(path, "-c", line)
		}
	}
	return autoShellCmd(line)
}

func autoShellCmd(line string) *exec.Cmd {
	for _, name := range []string{"zsh", "bash", "sh"} {
		if path := findShell(name); path != "" {
			return exec.Command(path, "-c", line)
		}
	}
	return exec.Command("sh", "-c", line)
}

// findShell returns the first existing path for the named shell.
func findShell(name string) string {
	candidates := []string{
		"/bin/" + name,
		"/usr/bin/" + name,
		"/usr/local/bin/" + name,
		"/opt/homebrew/bin/" + name, // Apple Silicon Homebrew
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}
