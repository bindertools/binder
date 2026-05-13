//go:build windows

package main

import (
	"bufio"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	term "terminal-ide/terminal"
)

var (
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMem   = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetSysTimes = kernel32.NewProc("GetSystemTimes")
	procGetDiskFree = kernel32.NewProc("GetDiskFreeSpaceExW")
)

type memStatusEx struct {
	dwLength                uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

func winMemStats() (used, total uint64, percent float64) {
	var ms memStatusEx
	ms.dwLength = uint32(unsafe.Sizeof(ms))
	procGlobalMem.Call(uintptr(unsafe.Pointer(&ms)))
	total = ms.ullTotalPhys
	avail := ms.ullAvailPhys
	used = total - avail
	percent = float64(ms.dwMemoryLoad)
	return
}

var (
	lastIdleTime   int64
	lastKernelTime int64
	lastUserTime   int64
)

func winCPUPercent() float64 {
	var idle, kernel, user syscall.Filetime
	r, _, _ := procGetSysTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	if r == 0 {
		return 0
	}
	i := int64(idle.HighDateTime)<<32 | int64(idle.LowDateTime)
	k := int64(kernel.HighDateTime)<<32 | int64(kernel.LowDateTime)
	u := int64(user.HighDateTime)<<32 | int64(user.LowDateTime)

	di := i - lastIdleTime
	dk := k - lastKernelTime
	du := u - lastUserTime
	lastIdleTime, lastKernelTime, lastUserTime = i, k, u

	total := dk + du
	if total <= 0 {
		return 0
	}
	busy := total - di
	if busy < 0 {
		busy = 0
	}
	pct := float64(busy) * 100.0 / float64(total)
	if pct > 100 {
		pct = 100
	}
	return pct
}

func winDiskStats() (used, total uint64, percent float64) {
	var freeBytes, totalBytes, totalFreeBytes uint64
	path, _ := syscall.UTF16PtrFromString(`C:\`)
	procGetDiskFree.Call(
		uintptr(unsafe.Pointer(path)),
		uintptr(unsafe.Pointer(&freeBytes)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	used = totalBytes - totalFreeBytes
	total = totalBytes
	if total > 0 {
		percent = float64(used) * 100.0 / float64(total)
	}
	return
}

func winNetStats() (sent, recv uint64) {
	cmd := exec.Command("netstat", "-e")
	term.NoWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return
	}
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, "Bytes") {
			fields := strings.Fields(line)
			if len(fields) >= 3 {
				recv, _ = strconv.ParseUint(fields[1], 10, 64)
				sent, _ = strconv.ParseUint(fields[2], 10, 64)
			}
			break
		}
	}
	return
}

func winGPUStats() (percent float64, name string, available bool) {
	cmd := exec.Command("nvidia-smi", "--query-gpu=utilization.gpu,name", "--format=csv,noheader")
	term.NoWindow(cmd)
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
				return
			}
		}
	}
	cmd2 := exec.Command("wmic", "path", "Win32_VideoController", "get", "Name", "/value")
	term.NoWindow(cmd2)
	if out2, err2 := cmd2.Output(); err2 == nil {
		for _, l := range strings.Split(string(out2), "\n") {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "Name=") && len(l) > 5 {
				name = strings.TrimPrefix(l, "Name=")
				break
			}
		}
	}
	return
}

func init() {
	// Warm up CPU counters
	var idle, kernel, user syscall.Filetime
	procGetSysTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	lastIdleTime = int64(idle.HighDateTime)<<32 | int64(idle.LowDateTime)
	lastKernelTime = int64(kernel.HighDateTime)<<32 | int64(kernel.LowDateTime)
	lastUserTime = int64(user.HighDateTime)<<32 | int64(user.LowDateTime)

	platformCollectPerf = func() PerfData {
		memUsed, memTotal, memPct := winMemStats()
		diskUsed, diskTotal, diskPct := winDiskStats()
		netSent, netRecv := winNetStats()
		gpuPct, gpuName, gpuAvail := winGPUStats()
		return PerfData{
			CPUPercent:   winCPUPercent(),
			MemUsed:      memUsed,
			MemTotal:     memTotal,
			MemPercent:   memPct,
			DiskUsed:     diskUsed,
			DiskTotal:    diskTotal,
			DiskPercent:  diskPct,
			NetBytesSent: netSent,
			NetBytesRecv: netRecv,
			GPUPercent:   gpuPct,
			GPUName:      gpuName,
			GPUAvailable: gpuAvail,
		}
	}
}
