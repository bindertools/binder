//go:build !windows

package main

import (
	"bufio"
	"os/exec"
	"strconv"
	"strings"

	goruntime "runtime"
)

func unixGPUStats() (percent float64, name string, available bool) {
	cmd := exec.Command("nvidia-smi", "--query-gpu=utilization.gpu,name", "--format=csv,noheader")
	out, err := cmd.Output()
	if err == nil {
		line := strings.TrimSpace(string(out))
		parts := strings.SplitN(line, ",", 2)
		if len(parts) == 2 {
			pStr := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(parts[0]), " %"))
			if v, e := strconv.ParseFloat(pStr, 64); e == nil {
				percent = v
				name = strings.TrimSpace(parts[1])
				available = true
			}
		}
	}
	return
}

func linuxPerfData() PerfData {
	var data PerfData
	gpuPct, gpuName, gpuAvail := unixGPUStats()
	data.GPUPercent, data.GPUName, data.GPUAvailable = gpuPct, gpuName, gpuAvail

	// Memory from /proc/meminfo
	if out, err := exec.Command("cat", "/proc/meminfo").Output(); err == nil {
		scanner := bufio.NewScanner(strings.NewReader(string(out)))
		kv := map[string]uint64{}
		for scanner.Scan() {
			parts := strings.Fields(scanner.Text())
			if len(parts) >= 2 {
				key := strings.TrimSuffix(parts[0], ":")
				val, _ := strconv.ParseUint(parts[1], 10, 64)
				kv[key] = val * 1024 // kB → bytes
			}
		}
		total := kv["MemTotal"]
		avail := kv["MemAvailable"]
		if avail == 0 {
			avail = kv["MemFree"] + kv["Buffers"] + kv["Cached"]
		}
		data.MemTotal = total
		data.MemUsed = total - avail
		if total > 0 {
			data.MemPercent = float64(data.MemUsed) * 100 / float64(total)
		}
	}

	// CPU from /proc/stat (one-shot — caller loops at 1s so delta is meaningful)
	if out, err := exec.Command("cat", "/proc/stat").Output(); err == nil {
		scanner := bufio.NewScanner(strings.NewReader(string(out)))
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "cpu ") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 5 {
				break
			}
			var vals [10]uint64
			for i := 1; i < len(fields) && i <= 10; i++ {
				vals[i-1], _ = strconv.ParseUint(fields[i], 10, 64)
			}
			idle := vals[3] + vals[4]
			total := uint64(0)
			for _, v := range vals {
				total += v
			}
			if total > 0 {
				data.CPUPercent = (1 - float64(idle)/float64(total)) * 100
			}
			break
		}
	}

	// Disk via df on /
	if out, err := exec.Command("df", "-B1", "/").Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		if len(lines) >= 2 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 4 {
				data.DiskTotal, _ = strconv.ParseUint(fields[1], 10, 64)
				data.DiskUsed, _ = strconv.ParseUint(fields[2], 10, 64)
				if data.DiskTotal > 0 {
					data.DiskPercent = float64(data.DiskUsed) * 100 / float64(data.DiskTotal)
				}
			}
		}
	}

	// Network from /proc/net/dev
	if out, err := exec.Command("cat", "/proc/net/dev").Output(); err == nil {
		scanner := bufio.NewScanner(strings.NewReader(string(out)))
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if strings.HasPrefix(line, "lo:") || !strings.Contains(line, ":") {
				continue
			}
			parts := strings.SplitN(line, ":", 2)
			if len(parts) != 2 {
				continue
			}
			fields := strings.Fields(parts[1])
			if len(fields) >= 9 {
				recv, _ := strconv.ParseUint(fields[0], 10, 64)
				sent, _ := strconv.ParseUint(fields[8], 10, 64)
				data.NetBytesRecv += recv
				data.NetBytesSent += sent
			}
		}
	}
	return data
}

func darwinPerfData() PerfData {
	var data PerfData
	gpuPct, gpuName, gpuAvail := unixGPUStats()
	data.GPUPercent, data.GPUName, data.GPUAvailable = gpuPct, gpuName, gpuAvail

	// Memory
	if out, err := exec.Command("sysctl", "-n", "hw.memsize").Output(); err == nil {
		total, _ := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
		data.MemTotal = total
	}
	if out, err := exec.Command("vm_stat").Output(); err == nil {
		kv := map[string]uint64{}
		pageSize := uint64(4096)
		scanner := bufio.NewScanner(strings.NewReader(string(out)))
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "page size of") {
				fields := strings.Fields(line)
				for i, f := range fields {
					if f == "size" && i+2 < len(fields) {
						pageSize, _ = strconv.ParseUint(fields[i+2], 10, 64)
					}
				}
				continue
			}
			parts := strings.SplitN(line, ":", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.TrimSpace(parts[0])
			val, _ := strconv.ParseUint(strings.Trim(strings.TrimSpace(parts[1]), "."), 10, 64)
			kv[key] = val * pageSize
		}
		free := kv["Pages free"] + kv["Pages speculative"]
		data.MemUsed = data.MemTotal - free
		if data.MemTotal > 0 {
			data.MemPercent = float64(data.MemUsed) * 100 / float64(data.MemTotal)
		}
	}

	// CPU via top (one sample)
	if out, err := exec.Command("top", "-l", "1", "-n", "0", "-s", "0").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, "CPU usage") {
				// "CPU usage: 8.75% user, 10.49% sys, 80.74% idle"
				parts := strings.Fields(line)
				for i, p := range parts {
					if p == "idle," || p == "idle" {
						if i > 0 {
							idleStr := strings.TrimSuffix(parts[i-1], "%")
							idle, _ := strconv.ParseFloat(idleStr, 64)
							data.CPUPercent = 100 - idle
						}
					}
				}
				break
			}
		}
	}

	// Disk via df
	if out, err := exec.Command("df", "-k", "/").Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		if len(lines) >= 2 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 4 {
				total, _ := strconv.ParseUint(fields[1], 10, 64)
				used, _ := strconv.ParseUint(fields[2], 10, 64)
				data.DiskTotal = total * 1024
				data.DiskUsed = used * 1024
				if data.DiskTotal > 0 {
					data.DiskPercent = float64(data.DiskUsed) * 100 / float64(data.DiskTotal)
				}
			}
		}
	}

	// Network via netstat -ib
	if out, err := exec.Command("netstat", "-ib").Output(); err == nil {
		scanner := bufio.NewScanner(strings.NewReader(string(out)))
		first := true
		for scanner.Scan() {
			if first { first = false; continue } // skip header
			fields := strings.Fields(scanner.Text())
			if len(fields) >= 10 {
				iface := fields[0]
				if strings.HasPrefix(iface, "lo") {
					continue
				}
				recv, _ := strconv.ParseUint(fields[6], 10, 64)
				sent, _ := strconv.ParseUint(fields[9], 10, 64)
				data.NetBytesRecv += recv
				data.NetBytesSent += sent
			}
		}
	}
	return data
}

func init() {
	platformCollectPerf = func() PerfData {
		if goruntime.GOOS == "darwin" {
			return darwinPerfData()
		}
		return linuxPerfData()
	}
}
