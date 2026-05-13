//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

func init() {
	netstatCmd = func() *exec.Cmd {
		return exec.Command("netstat", "-ano")
	}
	platformKillPIDs = func(pids []int, port string) (string, error) {
		var msgs []string
		for _, pid := range pids {
			cmd := exec.Command("taskkill", "/PID", fmt.Sprintf("%d", pid), "/F")
			noWindow(cmd)
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
