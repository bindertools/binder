package main

import (
	"bufio"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// PortInfo describes a single active network port.
type PortInfo struct {
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
	PID      int    `json:"pid"`
	Process  string `json:"process"`
	Address  string `json:"address"`
	State    string `json:"state"`
}

// netstatCmd and platformKillPIDs are set by platform init() functions.
var netstatCmd func() *exec.Cmd
var platformKillPIDs func(pids []int, port string) (string, error)

// getActivePorts returns the list of currently listening / established ports.
func getActivePorts() []PortInfo {
	if netstatCmd == nil {
		return nil
	}
	cmd := netstatCmd()
	noWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	return parseNetstatLines(string(out))
}

// killPortProcess kills all processes listening on the given port string.
func killPortProcess(portStr string) (string, error) {
	port, err := strconv.Atoi(strings.TrimSpace(portStr))
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("invalid port: %s", portStr)
	}
	ports := getActivePorts()
	var pids []int
	seen := map[int]bool{}
	for _, p := range ports {
		if p.Port == port && !seen[p.PID] && p.PID > 0 {
			pids = append(pids, p.PID)
			seen[p.PID] = true
		}
	}
	if len(pids) == 0 {
		return fmt.Sprintf("no process found on port %d", port), nil
	}
	if platformKillPIDs == nil {
		return "", fmt.Errorf("kill not supported on this platform")
	}
	return platformKillPIDs(pids, portStr)
}

// portFromAddr extracts the numeric port from an address like "0.0.0.0:8080" or ":::8080".
func portFromAddr(addr string) int {
	// Strip IPv6 brackets: [::1]:8080 → ::1:8080
	addr = strings.TrimPrefix(addr, "[")
	addr = strings.TrimSuffix(addr, "]")

	// Find the last colon (port always follows the final colon)
	idx := strings.LastIndex(addr, ":")
	if idx < 0 {
		return 0
	}
	p, err := strconv.Atoi(addr[idx+1:])
	if err != nil {
		return 0
	}
	return p
}

// parseNetstatLines converts raw netstat output into PortInfo slices.
// Handles both Windows (`netstat -ano`) and Unix (`netstat -tulnp`) formats.
func parseNetstatLines(output string) []PortInfo {
	var results []PortInfo
	seen := map[string]bool{}

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "Proto") || strings.HasPrefix(line, "Active") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		proto := strings.ToLower(fields[0])
		if proto != "tcp" && proto != "tcp6" && proto != "udp" && proto != "udp6" {
			continue
		}

		localAddr := fields[1]
		port := portFromAddr(localAddr)
		if port == 0 {
			continue
		}

		// Deduplicate (same proto+port+pid combination)
		var state string
		var pid int
		var process string

		if len(fields) >= 5 {
			// Windows: Proto  LocalAddr  ForeignAddr  State  PID
			state = fields[3]
			pid, _ = strconv.Atoi(fields[4])
		} else if len(fields) == 4 {
			// Could be Windows UDP (no state): Proto  LocalAddr  ForeignAddr  PID
			pid, _ = strconv.Atoi(fields[3])
		}

		// Unix: Proto  RecvQ  SendQ  LocalAddr  ForeignAddr  State  PID/Program
		if len(fields) >= 7 && (fields[0] == "tcp" || fields[0] == "tcp6" || fields[0] == "udp" || fields[0] == "udp6") {
			// Check if 2nd/3rd fields are numeric (Unix recv/send queues)
			if _, err := strconv.Atoi(fields[1]); err == nil {
				localAddr = fields[3]
				port = portFromAddr(localAddr)
				if port == 0 {
					continue
				}
				if len(fields) >= 6 {
					state = fields[5]
				}
				if len(fields) >= 7 {
					pidStr := strings.SplitN(fields[6], "/", 2)
					pid, _ = strconv.Atoi(pidStr[0])
					if len(pidStr) > 1 {
						process = pidStr[1]
					}
				}
			}
		}

		key := fmt.Sprintf("%s:%d:%d", proto, port, pid)
		if seen[key] {
			continue
		}
		seen[key] = true

		// Normalise state
		switch strings.ToUpper(state) {
		case "LISTENING", "LISTEN":
			state = "LISTEN"
		case "ESTABLISHED":
			state = "ESTABLISHED"
		case "TIME_WAIT":
			state = "TIME_WAIT"
		case "CLOSE_WAIT":
			state = "CLOSE_WAIT"
		case "":
			// UDP has no state
		}

		results = append(results, PortInfo{
			Protocol: proto,
			Port:     port,
			PID:      pid,
			Process:  process,
			Address:  localAddr,
			State:    state,
		})
	}
	return results
}
