//go:build windows

package terminal

import (
	"os/exec"
	"syscall"
)

// NoWindow suppresses the console window that Windows would otherwise flash
// when spawning a child process (CREATE_NO_WINDOW = 0x08000000).
func NoWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
}
