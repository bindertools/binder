//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"strings"

	goruntime "runtime"
)

func init() {
	netstatCmd = func() *exec.Cmd {
		if goruntime.GOOS == "darwin" {
			return exec.Command("netstat", "-an", "-p", "tcp")
		}
		return exec.Command("netstat", "-tulnp")
	}
	platformKillPIDs = func(pids []int, port string) (string, error) {
		var msgs []string
		for _, pid := range pids {
			cmd := exec.Command("kill", "-9", fmt.Sprintf("%d", pid))
			out, err := cmd.CombinedOutput()
			if err != nil {
				msgs = append(msgs, fmt.Sprintf("PID %d: %s", pid, strings.TrimSpace(string(out))))
			} else {
				msgs = append(msgs, fmt.Sprintf("killed PID %d", pid))
			}
		}
		return strings.Join(msgs, "; "), nil
	}
}
