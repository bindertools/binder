//go:build windows

package main

import (
	"syscall"
	"time"
)

// hostUptime returns the duration the machine has been running by calling the
// Windows kernel32 GetTickCount64 API (milliseconds since last boot).
func hostUptime() time.Duration {
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetTickCount64")
	r1, _, _ := proc.Call()
	return time.Duration(r1) * time.Millisecond
}
