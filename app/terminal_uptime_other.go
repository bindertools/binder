//go:build !windows

package main

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// hostUptime returns the duration the machine has been running.
// On Linux it reads /proc/uptime; on macOS it parses sysctl kern.boottime.
func hostUptime() time.Duration {
	// Linux: /proc/uptime contains "<total_seconds> <idle_seconds>"
	if data, err := os.ReadFile("/proc/uptime"); err == nil {
		if fields := strings.Fields(string(data)); len(fields) > 0 {
			if secs, err := strconv.ParseFloat(fields[0], 64); err == nil {
				return time.Duration(secs * float64(time.Second))
			}
		}
	}

	// macOS / BSD: sysctl -n kern.boottime → "{ sec = 1710000000, usec = 0 }"
	if out, err := exec.Command("sysctl", "-n", "kern.boottime").Output(); err == nil {
		s := string(out)
		if idx := strings.Index(s, "sec = "); idx >= 0 {
			rest := s[idx+6:]
			end := strings.IndexAny(rest, ", }")
			if end < 0 {
				end = len(rest)
			}
			if sec, err := strconv.ParseInt(strings.TrimSpace(rest[:end]), 10, 64); err == nil {
				return time.Since(time.Unix(sec, 0))
			}
		}
	}

	return 0
}
