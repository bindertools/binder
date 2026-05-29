//go:build !windows

package main

import (
	"os"
	"syscall"
)

// killTree sends SIGTERM to the process group containing pid, which kills
// the shell and all its child processes on macOS and Linux.
func killTree(pid int) {
	// Negative PID targets the entire process group.
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	// Belt-and-suspenders: also signal the process directly.
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Signal(syscall.SIGTERM)
	}
}
