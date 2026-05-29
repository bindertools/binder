//go:build windows

package main

import (
	"os/exec"
	"strconv"

	term "github.com/Command-IDE/terminal/src"
)

// killTree forcefully terminates pid and all its descendant processes on
// Windows. taskkill /F (force) /T (include tree) is the standard approach
// and works without a console or Job Object attachment.
func killTree(pid int) {
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
	term.NoWindow(cmd)
	_ = cmd.Run()
}
