//go:build windows

package main

import (
	_ "embed"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ─── Splash window + banner dimensions ───────────────────────────────────────

const (
	splashW = 340
	splashH = 145

	// Banner is drawn at 300×100, keeping the 720:240 (3:1) source ratio.
	bannerW = 300
	bannerH = 100
	bannerY = 12 // top padding
)

// Embedded banner PNG (720×240 dark lockup, generated from lockup-dark.svg).
//
//go:embed build/windows/splash_banner.png
var _splashBanner []byte

// ─── Win32 constants ─────────────────────────────────────────────────────────

const (
	_WS_POPUP          = 0x80000000
	_WS_VISIBLE        = 0x10000000
	_WM_DESTROY        = 0x0002
	_WM_CLOSE          = 0x0010
	_WM_PAINT          = 0x000F
	_WM_TIMER          = 0x0113
	_WM_ERASEBKGND     = 0x0014
	_WM_NCHITTEST      = 0x0084
	_HTCAPTION         = 2
	_SW_SHOW           = 5
	_TRANSPARENT       = 1
	_DT_CENTER         = 0x00000001
	_DT_VCENTER        = 0x00000004
	_DT_SINGLELINE     = 0x00000020
	_FW_NORMAL         = 400
	_DEFAULT_CHARSET   = 1
	_CLEARTYPE_QUALITY = 5
	_VARIABLE_PITCH    = 2
	_FF_SWISS          = 0x20
	_DWMWA_CORNER_PREF = 33
	_DWMWCP_ROUND      = 2

	// GDI+ interpolation: HighQualityBicubic = 7
	_InterpolationModeHighQualityBicubic = 7
)

// ─── Lazy DLL / proc handles ─────────────────────────────────────────────────

var (
	_user32   = windows.NewLazySystemDLL("user32.dll")
	_gdi32    = windows.NewLazySystemDLL("gdi32.dll")
	_kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	_dwmapi   = windows.NewLazySystemDLL("dwmapi.dll")
	_gdiplus  = windows.NewLazySystemDLL("gdiplus.dll")

	// user32
	_procRegisterClassExW    = _user32.NewProc("RegisterClassExW")
	_procCreateWindowExW     = _user32.NewProc("CreateWindowExW")
	_procShowWindow          = _user32.NewProc("ShowWindow")
	_procDefWindowProcW      = _user32.NewProc("DefWindowProcW")
	_procGetMessageW         = _user32.NewProc("GetMessageW")
	_procTranslateMessage    = _user32.NewProc("TranslateMessage")
	_procDispatchMessageW    = _user32.NewProc("DispatchMessageW")
	_procPostQuitMessage     = _user32.NewProc("PostQuitMessage")
	_procBeginPaint          = _user32.NewProc("BeginPaint")
	_procEndPaint            = _user32.NewProc("EndPaint")
	_procGetSystemMetrics    = _user32.NewProc("GetSystemMetrics")
	_procSetTimer            = _user32.NewProc("SetTimer")
	_procKillTimer           = _user32.NewProc("KillTimer")
	_procPostMessageW        = _user32.NewProc("PostMessageW")
	_procInvalidateRect      = _user32.NewProc("InvalidateRect")
	_procFillRect            = _user32.NewProc("FillRect")
	_procDrawTextW           = _user32.NewProc("DrawTextW")
	_procSetForegroundWindow = _user32.NewProc("SetForegroundWindow")
	_procBringWindowToTop    = _user32.NewProc("BringWindowToTop")
	_procFindWindowW         = _user32.NewProc("FindWindowW")

	// gdi32
	_procSetBkMode        = _gdi32.NewProc("SetBkMode")
	_procSetTextColor     = _gdi32.NewProc("SetTextColor")
	_procCreateSolidBrush = _gdi32.NewProc("CreateSolidBrush")
	_procDeleteObject     = _gdi32.NewProc("DeleteObject")
	_procSelectObject     = _gdi32.NewProc("SelectObject")
	_procCreateFontW      = _gdi32.NewProc("CreateFontW")

	// kernel32
	_procGetModuleHandleW = _kernel32.NewProc("GetModuleHandleW")

	// dwmapi
	_procDwmSetWindowAttribute = _dwmapi.NewProc("DwmSetWindowAttribute")

	// gdiplus
	_procGdiplusStartup           = _gdiplus.NewProc("GdiplusStartup")
	_procGdiplusShutdown          = _gdiplus.NewProc("GdiplusShutdown")
	_procGdipLoadImageFromFile    = _gdiplus.NewProc("GdipLoadImageFromFile")
	_procGdipCreateFromHDC        = _gdiplus.NewProc("GdipCreateFromHDC")
	_procGdipDrawImageRectI       = _gdiplus.NewProc("GdipDrawImageRectI")
	_procGdipSetInterpolationMode = _gdiplus.NewProc("GdipSetInterpolationMode")
	_procGdipDeleteGraphics       = _gdiplus.NewProc("GdipDeleteGraphics")
	_procGdipDisposeImage         = _gdiplus.NewProc("GdipDisposeImage")
)

// ─── Win32 struct definitions ────────────────────────────────────────────────

// _WNDCLASSEXW matches WNDCLASSEXW on 64-bit Windows (80 bytes).
type _WNDCLASSEXW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

// _RECT matches Win32 RECT (16 bytes).
type _RECT struct {
	left, top, right, bottom int32
}

// _MSG matches Win32 MSG on 64-bit Windows (48 bytes).
type _MSG struct {
	hwnd     uintptr
	message  uint32
	_pad     [4]byte
	wParam   uintptr
	lParam   uintptr
	time     uint32
	ptX      int32
	ptY      int32
	lPrivate uint32
}

// _GdiplusStartupInput matches GdiplusStartupInput on 64-bit Windows (24 bytes).
type _GdiplusStartupInput struct {
	GdiplusVersion           uint32
	_pad                     [4]byte
	DebugEventCallback       uintptr
	SuppressBackgroundThread int32
	SuppressExternalCodecs   int32
}

// ─── State ────────────────────────────────────────────────────────────────────

var (
	_splashHWND     atomic.Uintptr
	_splashTick     atomic.Int32
	_splashCallback uintptr // package-level: prevents GC collection
	_splashBitmap   uintptr // GpBitmap* created once, used on every WM_PAINT
)

func init() {
	_splashCallback = windows.NewCallback(func(hwnd, msg, wParam, lParam uintptr) uintptr {
		switch uint32(msg) {
		case _WM_PAINT:
			_drawSplash(hwnd)
			return 0
		case _WM_ERASEBKGND:
			return 1
		case _WM_TIMER:
			_splashTick.Add(1)
			_procInvalidateRect.Call(hwnd, 0, 0)
			return 0
		case _WM_NCHITTEST:
			return _HTCAPTION
		case _WM_DESTROY:
			_procKillTimer.Call(hwnd, 1)
			_procPostQuitMessage.Call(0)
			return 0
		}
		ret, _, _ := _procDefWindowProcW.Call(hwnd, msg, wParam, lParam)
		return ret
	})
}

// ─── Painting helpers ─────────────────────────────────────────────────────────

// _colorRef converts 0xRRGGBB to Win32 COLORREF (0x00BBGGRR).
func _colorRef(rrggbb uint32) uintptr {
	r := (rrggbb >> 16) & 0xFF
	g := (rrggbb >> 8) & 0xFF
	b := rrggbb & 0xFF
	return uintptr(b<<16 | g<<8 | r)
}

func _fillRect(hdc uintptr, l, t, r, b int32, color uint32) {
	br, _, _ := _procCreateSolidBrush.Call(_colorRef(color))
	rc := _RECT{l, t, r, b}
	_procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), br)
	_procDeleteObject.Call(br)
}

func _drawTextCentered(hdc uintptr, text string, rc _RECT, ptSize, weight uintptr, color uint32) {
	fName, _ := windows.UTF16PtrFromString("Segoe UI")
	font, _, _ := _procCreateFontW.Call(
		ptSize, 0, 0, 0,
		weight, 0, 0, 0,
		_DEFAULT_CHARSET, 0, 0,
		_CLEARTYPE_QUALITY,
		_VARIABLE_PITCH|_FF_SWISS,
		uintptr(unsafe.Pointer(fName)),
	)
	runtime.KeepAlive(fName)

	old, _, _ := _procSelectObject.Call(hdc, font)
	_procSetBkMode.Call(hdc, _TRANSPARENT)
	_procSetTextColor.Call(hdc, _colorRef(color))

	t16, _ := windows.UTF16PtrFromString(text)
	_procDrawTextW.Call(
		hdc,
		uintptr(unsafe.Pointer(t16)),
		^uintptr(0), // -1 → null-terminated
		uintptr(unsafe.Pointer(&rc)),
		_DT_CENTER|_DT_VCENTER|_DT_SINGLELINE,
	)
	runtime.KeepAlive(t16)

	_procSelectObject.Call(hdc, old)
	_procDeleteObject.Call(font)
}

func _drawBanner(hdc uintptr) {
	if _splashBitmap == 0 {
		return
	}
	var graphics uintptr
	_procGdipCreateFromHDC.Call(hdc, uintptr(unsafe.Pointer(&graphics)))
	if graphics == 0 {
		return
	}
	defer _procGdipDeleteGraphics.Call(graphics)

	_procGdipSetInterpolationMode.Call(graphics, _InterpolationModeHighQualityBicubic)

	x := int32((splashW - bannerW) / 2)
	_procGdipDrawImageRectI.Call(
		graphics, _splashBitmap,
		uintptr(x), uintptr(bannerY),
		uintptr(bannerW), uintptr(bannerH),
	)
}

func _drawSplash(hwnd uintptr) {
	var ps [72]byte
	hdc, _, _ := _procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps[0])))
	if hdc == 0 {
		return
	}
	defer _procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps[0])))

	// Background
	_fillRect(hdc, 0, 0, splashW, splashH, 0x0D0D0D)

	// 1-pixel border
	_fillRect(hdc, 0, 0, splashW, 1, 0x2A2A2A)
	_fillRect(hdc, 0, splashH-1, splashW, splashH, 0x2A2A2A)
	_fillRect(hdc, 0, 0, 1, splashH, 0x2A2A2A)
	_fillRect(hdc, splashW-1, 0, splashW, splashH, 0x2A2A2A)

	// Banner image (GDI+ rendered PNG)
	_drawBanner(hdc)

	// Animated loading indicator below the banner
	tick := int(_splashTick.Load())
	dots := [4]string{"", ".", "..", "..."}[tick%4]
	subRC := _RECT{0, bannerY + bannerH + 4, splashW, splashH - 4}
	_drawTextCentered(hdc, "Loading"+dots, subRC, 12, _FW_NORMAL, 0x555555)
}

// ─── Public API ───────────────────────────────────────────────────────────────

// showSplash creates and displays a native Win32 borderless splash window.
// Returns once the window is visible. Message loop runs on a locked OS thread.
func showSplash() {
	ready := make(chan struct{})
	go func() {
		runtime.LockOSThread()

		// ── GDI+ init ────────────────────────────────────────────────────────
		var gdipToken uintptr
		startupInput := _GdiplusStartupInput{GdiplusVersion: 1}
		_procGdiplusStartup.Call(
			uintptr(unsafe.Pointer(&gdipToken)),
			uintptr(unsafe.Pointer(&startupInput)),
			0,
		)

		// Pre-load the banner bitmap via a temp file so WM_PAINT doesn't
		// re-decode on every frame. Using GdipLoadImageFromFile avoids the
		// IStream/COM pattern that go vet flags as unsafe pointer misuse.
		if len(_splashBanner) > 0 {
			tmp := filepath.Join(os.TempDir(), "cmdide_splash_banner.png")
			if os.WriteFile(tmp, _splashBanner, 0600) == nil {
				pngPath, _ := windows.UTF16PtrFromString(tmp)
				_procGdipLoadImageFromFile.Call(
					uintptr(unsafe.Pointer(pngPath)),
					uintptr(unsafe.Pointer(&_splashBitmap)),
				)
				runtime.KeepAlive(pngPath)
				os.Remove(tmp)
			}
		}

		// ── Window creation ──────────────────────────────────────────────────
		hInst, _, _ := _procGetModuleHandleW.Call(0)

		clsName, _ := windows.UTF16PtrFromString("_CmdIDESplash")
		winTitle, _ := windows.UTF16PtrFromString("Command IDE")

		wcx := _WNDCLASSEXW{
			lpfnWndProc:   _splashCallback,
			hInstance:     hInst,
			lpszClassName: clsName,
		}
		wcx.cbSize = uint32(unsafe.Sizeof(wcx))
		_procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wcx)))
		runtime.KeepAlive(clsName)

		sw, _, _ := _procGetSystemMetrics.Call(0) // SM_CXSCREEN
		sh, _, _ := _procGetSystemMetrics.Call(1) // SM_CYSCREEN
		x := (int(sw) - splashW) / 2
		y := (int(sh) - splashH) / 2

		hwnd, _, _ := _procCreateWindowExW.Call(
			0,
			uintptr(unsafe.Pointer(clsName)),
			uintptr(unsafe.Pointer(winTitle)),
			_WS_POPUP|_WS_VISIBLE,
			uintptr(x), uintptr(y), splashW, splashH,
			0, 0, hInst, 0,
		)
		runtime.KeepAlive(clsName)
		runtime.KeepAlive(winTitle)

		if hwnd == 0 {
			if gdipToken != 0 {
				_procGdiplusShutdown.Call(gdipToken)
			}
			close(ready)
			return
		}

		_splashHWND.Store(hwnd)

		// Rounded corners (Windows 11+, silently ignored on older).
		cornerPref := uint32(_DWMWCP_ROUND)
		_procDwmSetWindowAttribute.Call(
			hwnd, _DWMWA_CORNER_PREF,
			uintptr(unsafe.Pointer(&cornerPref)),
			uintptr(unsafe.Sizeof(cornerPref)),
		)

		_procShowWindow.Call(hwnd, _SW_SHOW)
		_procSetTimer.Call(hwnd, 1, 450, 0) // 450 ms animation tick

		close(ready)

		// ── Message loop ─────────────────────────────────────────────────────
		msg := new(_MSG)
		for {
			r, _, _ := _procGetMessageW.Call(uintptr(unsafe.Pointer(msg)), 0, 0, 0)
			if r == 0 || int32(r) == -1 {
				break
			}
			_procTranslateMessage.Call(uintptr(unsafe.Pointer(msg)))
			_procDispatchMessageW.Call(uintptr(unsafe.Pointer(msg)))
		}

		// ── Cleanup ──────────────────────────────────────────────────────────
		_splashHWND.Store(0)
		if _splashBitmap != 0 {
			_procGdipDisposeImage.Call(_splashBitmap)
			_splashBitmap = 0
		}
		if gdipToken != 0 {
			_procGdiplusShutdown.Call(gdipToken)
		}
	}()
	<-ready
}

// bringToFront focuses the main Wails window. Must be called BEFORE closeSplash
// so that our process still holds the foreground lock (via the splash window)
// and Windows allows the SetForegroundWindow call to succeed.
func bringToFront() {
	title, _ := windows.UTF16PtrFromString("cmdIDE")
	hwnd, _, _ := _procFindWindowW.Call(0, uintptr(unsafe.Pointer(title)))
	runtime.KeepAlive(title)
	if hwnd != 0 {
		_procSetForegroundWindow.Call(hwnd)
		_procBringWindowToTop.Call(hwnd)
	}
}

// closeSplash posts WM_CLOSE to the splash window. Thread-safe.
func closeSplash() {
	hwnd := _splashHWND.Load()
	if hwnd != 0 {
		_procPostMessageW.Call(hwnd, _WM_CLOSE, 0, 0)
	}
}
