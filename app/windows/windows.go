//go:build windows

// Package windows provides all Windows-specific platform functionality for
// cmdIDE: performance data collection via Windows APIs, port enumeration via
// netstat, process termination via taskkill, and taskbar jump-list setup via COM.
package windows

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// noWindow suppresses the console window flash when spawning background processes.
func noWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
}

// ── Performance ───────────────────────────────────────────────────────────────

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

func memStats() (used, total uint64, percent float64) {
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

func cpuPercent() float64 {
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

func diskStats() (used, total uint64, percent float64) {
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

func netStats() (sent, recv uint64) {
	cmd := exec.Command("netstat", "-e")
	noWindow(cmd)
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

func gpuStats() (percent float64, name string, available bool) {
	cmd := exec.Command("nvidia-smi", "--query-gpu=utilization.gpu,name", "--format=csv,noheader")
	noWindow(cmd)
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
	noWindow(cmd2)
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

// PerfSnapshot is a point-in-time performance snapshot collected via Windows APIs.
type PerfSnapshot struct {
	CPUPercent   float64
	MemUsed      uint64
	MemTotal     uint64
	MemPercent   float64
	DiskUsed     uint64
	DiskTotal    uint64
	DiskPercent  float64
	NetBytesSent uint64
	NetBytesRecv uint64
	GPUPercent   float64
	GPUName      string
	GPUAvailable bool
}

// CollectPerf returns a full performance snapshot using Windows APIs.
func CollectPerf() PerfSnapshot {
	memUsed, memTotal, memPct := memStats()
	diskUsed, diskTotal, diskPct := diskStats()
	netSent, netRecv := netStats()
	gpuPct, gpuName, gpuAvail := gpuStats()
	return PerfSnapshot{
		CPUPercent:   cpuPercent(),
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

// ── Ports ─────────────────────────────────────────────────────────────────────

// NetstatCmd returns the command used to enumerate active ports on Windows.
func NetstatCmd() *exec.Cmd {
	return exec.Command("netstat", "-ano")
}

// KillPIDs terminates the given PIDs using taskkill /F.
func KillPIDs(pids []int, port string) (string, error) {
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

// ── Jump List ─────────────────────────────────────────────────────────────────

const appUserModelID = "cmdIDE.App"

var (
	clsidDestinationList = windows.GUID{
		Data1: 0x77f10cf0, Data2: 0x3db5, Data3: 0x4966,
		Data4: [8]byte{0xb5, 0x20, 0xb7, 0xc5, 0x4f, 0xd3, 0x5e, 0xd6},
	}
	iidCustomDestinationList = windows.GUID{
		Data1: 0x6332debf, Data2: 0x87b5, Data3: 0x4670,
		Data4: [8]byte{0x90, 0xc0, 0x5e, 0x57, 0xb4, 0x08, 0xa4, 0x9e},
	}
	clsidShellLink = windows.GUID{
		Data1: 0x00021401, Data2: 0x0000, Data3: 0x0000,
		Data4: [8]byte{0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46},
	}
	iidShellLinkW = windows.GUID{
		Data1: 0x000214f9, Data2: 0x0000, Data3: 0x0000,
		Data4: [8]byte{0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46},
	}
	iidPropertyStore = windows.GUID{
		Data1: 0x886d8eeb, Data2: 0x8cf2, Data3: 0x4446,
		Data4: [8]byte{0x8d, 0x02, 0xcd, 0xba, 0x1d, 0xbd, 0xcf, 0x99},
	}
	clsidEnumerableObjectCollection = windows.GUID{
		Data1: 0x2d3468c1, Data2: 0x36a7, Data3: 0x43b6,
		Data4: [8]byte{0xac, 0x24, 0xd3, 0xf0, 0x2f, 0xd9, 0x60, 0x7a},
	}
	iidObjectCollection = windows.GUID{
		Data1: 0x5632b1a4, Data2: 0xe38a, Data3: 0x400a,
		Data4: [8]byte{0x84, 0x4d, 0x49, 0x40, 0x75, 0x74, 0x56, 0xfd},
	}
	iidObjectArray = windows.GUID{
		Data1: 0x92ca9dcd, Data2: 0x5622, Data3: 0x4bba,
		Data4: [8]byte{0xa8, 0x05, 0x5e, 0x9f, 0x54, 0x1b, 0xd8, 0xc9},
	}
	pkeyTitle = propKey{
		FMTID: windows.GUID{
			Data1: 0xf29f85e0, Data2: 0x4ff9, Data3: 0x1068,
			Data4: [8]byte{0xab, 0x91, 0x08, 0x00, 0x2b, 0x27, 0xb3, 0xd9},
		},
		PID: 2,
	}
)

type propKey struct {
	FMTID windows.GUID
	PID   uint32
}

type propVariant struct {
	vt  uint16
	_   [6]byte
	ptr uintptr
}

var (
	ole32             = windows.NewLazySystemDLL("ole32.dll")
	shell32           = windows.NewLazySystemDLL("shell32.dll")
	procCoInitEx      = ole32.NewProc("CoInitializeEx")
	procCoCreateInst  = ole32.NewProc("CoCreateInstance")
	procSetAppModelID = shell32.NewProc("SetCurrentProcessExplicitAppUserModelID")
)

// comIface mirrors the COM interface memory layout: a pointer to a vtable.
type comIface struct{ vtbl *[32]uintptr }

func comCall(obj uintptr, slot int, args ...uintptr) uintptr {
	// Route through &obj (*uintptr → unsafe.Pointer) to avoid a direct
	// uintptr→unsafe.Pointer conversion that go vet flags as unsafe.
	fn := (*comIface)(unsafe.Pointer(*(**uintptr)(unsafe.Pointer(&obj)))).vtbl[slot]
	all := make([]uintptr, len(args)+1)
	all[0] = obj
	copy(all[1:], args)
	r, _, _ := syscall.SyscallN(fn, all...)
	return r
}

func comRelease(obj uintptr) {
	if obj != 0 {
		comCall(obj, 2)
	}
}

func coCreate(clsid, iid *windows.GUID) uintptr {
	var obj uintptr
	procCoCreateInst.Call(
		uintptr(unsafe.Pointer(clsid)), 0, 1,
		uintptr(unsafe.Pointer(iid)),
		uintptr(unsafe.Pointer(&obj)),
	)
	return obj
}

// InitJumpList sets the process AppUserModelID and registers a "New Window"
// entry in the Windows taskbar jump list.
func InitJumpList() {
	aumidW, err := windows.UTF16PtrFromString(appUserModelID)
	if err == nil {
		procSetAppModelID.Call(uintptr(unsafe.Pointer(aumidW)))
		runtime.KeepAlive(aumidW)
	}
	procCoInitEx.Call(0, 2)

	exe, err := os.Executable()
	if err != nil {
		return
	}
	exeW, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return
	}

	destList := coCreate(&clsidDestinationList, &iidCustomDestinationList)
	if destList == 0 {
		return
	}
	defer comRelease(destList)

	if aumidW != nil {
		comCall(destList, 3, uintptr(unsafe.Pointer(aumidW)))
	}

	var maxSlots uint32
	var removedArr uintptr
	comCall(destList, 4,
		uintptr(unsafe.Pointer(&maxSlots)),
		uintptr(unsafe.Pointer(&iidObjectArray)),
		uintptr(unsafe.Pointer(&removedArr)),
	)
	comRelease(removedArr)

	objColl := coCreate(&clsidEnumerableObjectCollection, &iidObjectCollection)
	if objColl == 0 {
		comCall(destList, 11)
		return
	}
	defer comRelease(objColl)

	link := coCreate(&clsidShellLink, &iidShellLinkW)
	if link == 0 {
		comCall(destList, 11)
		return
	}
	defer comRelease(link)

	comCall(link, 20, uintptr(unsafe.Pointer(exeW)))
	comCall(link, 15, 1)
	runtime.KeepAlive(exeW)

	var propStore uintptr
	comCall(link, 0,
		uintptr(unsafe.Pointer(&iidPropertyStore)),
		uintptr(unsafe.Pointer(&propStore)),
	)
	if propStore != 0 {
		titleW, _ := windows.UTF16PtrFromString("New Window")
		pv := propVariant{vt: 0x1f}
		pv.ptr = uintptr(unsafe.Pointer(titleW))
		comCall(propStore, 6,
			uintptr(unsafe.Pointer(&pkeyTitle)),
			uintptr(unsafe.Pointer(&pv)),
		)
		comCall(propStore, 7)
		comRelease(propStore)
		runtime.KeepAlive(titleW)
	}

	comCall(objColl, 5, link)
	comCall(destList, 7, objColl)
	comCall(destList, 8)
}

// ── init ──────────────────────────────────────────────────────────────────────

func init() {
	var idle, kernel, user syscall.Filetime
	procGetSysTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	lastIdleTime = int64(idle.HighDateTime)<<32 | int64(idle.LowDateTime)
	lastKernelTime = int64(kernel.HighDateTime)<<32 | int64(kernel.LowDateTime)
	lastUserTime = int64(user.HighDateTime)<<32 | int64(user.LowDateTime)
}
