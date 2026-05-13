//go:build windows

package main

import (
	"os"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const appUserModelID = "cmdIDE.App"

// COM GUIDs ────────────────────────────────────────────────────────────────────

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

// propVariant for VT_LPWSTR — 16 bytes on 64-bit Windows.
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

func comCall(obj uintptr, slot int, args ...uintptr) uintptr {
	vtbl := *(*[32]uintptr)(unsafe.Pointer(*(*uintptr)(unsafe.Pointer(obj))))
	fn := vtbl[slot]
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
		uintptr(unsafe.Pointer(clsid)),
		0,
		1, // CLSCTX_INPROC_SERVER
		uintptr(unsafe.Pointer(iid)),
		uintptr(unsafe.Pointer(&obj)),
	)
	return obj
}

// initJumpList sets the process AppUserModelID and registers a "New Window"
// task in the Windows taskbar jump list.
func initJumpList() {
	// Set AUMID before the window is created so Windows binds the taskbar
	// button and jump list to this ID.
	aumidW, err := windows.UTF16PtrFromString(appUserModelID)
	if err == nil {
		procSetAppModelID.Call(uintptr(unsafe.Pointer(aumidW)))
		runtime.KeepAlive(aumidW)
	}

	procCoInitEx.Call(0, 2) // COINIT_APARTMENTTHREADED

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

	// Bind this jump list to our AUMID (slot 3 = SetAppID).
	if aumidW != nil {
		comCall(destList, 3, uintptr(unsafe.Pointer(aumidW)))
	}

	// BeginList (slot 4) — discard the returned removed-items array.
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
		comCall(destList, 11) // AbortList
		return
	}
	defer comRelease(objColl)

	link := coCreate(&clsidShellLink, &iidShellLinkW)
	if link == 0 {
		comCall(destList, 11)
		return
	}
	defer comRelease(link)

	comCall(link, 20, uintptr(unsafe.Pointer(exeW))) // SetPath
	comCall(link, 15, 1)                             // SetShowCmd = SW_SHOWNORMAL
	runtime.KeepAlive(exeW)

	// Set the display title via IPropertyStore.
	var propStore uintptr
	comCall(link, 0,
		uintptr(unsafe.Pointer(&iidPropertyStore)),
		uintptr(unsafe.Pointer(&propStore)),
	)
	if propStore != 0 {
		titleW, _ := windows.UTF16PtrFromString("New Window")
		pv := propVariant{vt: 0x1f} // VT_LPWSTR
		pv.ptr = uintptr(unsafe.Pointer(titleW))
		comCall(propStore, 6,
			uintptr(unsafe.Pointer(&pkeyTitle)),
			uintptr(unsafe.Pointer(&pv)),
		)
		comCall(propStore, 7) // Commit
		comRelease(propStore)
		runtime.KeepAlive(titleW)
	}

	comCall(objColl, 5, link)     // AddObject
	comCall(destList, 7, objColl) // AddUserTasks
	comCall(destList, 8)          // CommitList
}
