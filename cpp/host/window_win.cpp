#ifdef _WIN32
#include "window_win.hpp"
#include <dwmapi.h>
#include <windowsx.h>
#include <mutex>
#include <vector>

static std::vector<RECT>    g_drag_rects;
static std::mutex           g_drag_mutex;
static WNDPROC              g_orig_wndproc = nullptr;

static bool PointInRect(int px, int py, const RECT& r) {
    return px >= r.left && px < r.right && py >= r.top && py < r.bottom;
}

static LRESULT CALLBACK FramelessWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {

    // ── Remove non-client area entirely ─────────────────────────────────────────
    // Without this, DefWindowProc subtracts SM_CXSIZEFRAME (~8 px) from all
    // four edges as non-client area.  That creates the side/top gaps and the
    // white DWM strip that painted over them.  Returning 0 makes client == window
    // rect.  When maximised, Windows positions the window bx/by pixels off-screen
    // so the invisible resize border is hidden; compensating here brings the
    // client back to the work area.
    if (msg == WM_NCCALCSIZE && wp) {
        auto* p = reinterpret_cast<NCCALCSIZE_PARAMS*>(lp);
        if (IsZoomed(hwnd)) {
            // SM_CXPADDEDBORDER may be absent in older SDK headers (value = 92)
#ifndef SM_CXPADDEDBORDER
#define SM_CXPADDEDBORDER 92
#endif
            int pad = GetSystemMetrics(SM_CXPADDEDBORDER); // same for x and y
            int bx  = GetSystemMetrics(SM_CXSIZEFRAME) + pad;
            int by  = GetSystemMetrics(SM_CYSIZEFRAME) + pad;
            p->rgrc[0].left   += bx;
            p->rgrc[0].top    += by;
            p->rgrc[0].right  -= bx;
            p->rgrc[0].bottom -= by;
        }
        return 0;
    }

    // ── Resize edges (skip when maximised — can't resize a maximised window) ────
    if (msg == WM_NCHITTEST) {
        if (IsZoomed(hwnd)) return HTCLIENT;

        int sx = GET_X_LPARAM(lp);
        int sy = GET_Y_LPARAM(lp);
        RECT wr{};
        GetWindowRect(hwnd, &wr);
        constexpr int kEdge = 8;

        bool top    = sy <= wr.top    + kEdge;
        bool bottom = sy >= wr.bottom - kEdge;
        bool left   = sx <= wr.left   + kEdge;
        bool right  = sx >= wr.right  - kEdge;

        if (top    && left)  return HTTOPLEFT;
        if (top    && right) return HTTOPRIGHT;
        if (bottom && left)  return HTBOTTOMLEFT;
        if (bottom && right) return HTBOTTOMRIGHT;
        if (top)             return HTTOP;
        if (bottom)          return HTBOTTOM;
        if (left)            return HTLEFT;
        if (right)           return HTRIGHT;

        return HTCLIENT;
    }

    // ── Resize the webview widget child to fill client area ──────────────────────
    if (msg == WM_SIZE) {
        RECT r{};
        GetClientRect(hwnd, &r);
        HWND child = GetWindow(hwnd, GW_CHILD);
        if (child) {
            SetWindowPos(child, nullptr,
                         0, 0, r.right - r.left, r.bottom - r.top,
                         SWP_NOZORDER | SWP_NOACTIVATE);
        }
        // fall through
    }

    // ── Keyboard focus ───────────────────────────────────────────────────────────
    if (msg == WM_ACTIVATE) {
        if (LOWORD(wp) != WA_INACTIVE) {
            HWND child = GetWindow(hwnd, GW_CHILD);
            if (child) SetFocus(child);
        }
        return CallWindowProcW(g_orig_wndproc, hwnd, msg, wp, lp);
    }

    // ── Window size constraints ──────────────────────────────────────────────────
    // ptMaxPosition/ptMaxSize must extend the window bx/by pixels BEYOND the
    // work area so the invisible WS_THICKFRAME resize borders go off-screen.
    // WM_NCCALCSIZE (IsZoomed branch) then trims bx/by back from each edge and
    // the client area lands exactly on the work area — taskbar stays visible.
    // Setting ptMaxSize to just the work area width/height would make WM_NCCALCSIZE
    // over-trim, leaving a bx/by-wide NC gap that DWM paints white.
    if (msg == WM_GETMINMAXINFO) {
        auto* mmi = reinterpret_cast<MINMAXINFO*>(lp);
        mmi->ptMinTrackSize.x = 800;
        mmi->ptMinTrackSize.y = 500;

        HMONITOR hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        MONITORINFO mi{ sizeof(mi) };
        if (GetMonitorInfoW(hmon, &mi)) {
            int pad = GetSystemMetrics(SM_CXPADDEDBORDER);
            int bx  = GetSystemMetrics(SM_CXSIZEFRAME) + pad;
            int by  = GetSystemMetrics(SM_CYSIZEFRAME) + pad;
            const RECT& wa = mi.rcWork;
            mmi->ptMaxPosition.x = (wa.left - mi.rcMonitor.left) - bx;
            mmi->ptMaxPosition.y = (wa.top  - mi.rcMonitor.top)  - by;
            mmi->ptMaxSize.x     = (wa.right  - wa.left) + 2 * bx;
            mmi->ptMaxSize.y     = (wa.bottom - wa.top)  + 2 * by;
        }
    }

    return CallWindowProcW(g_orig_wndproc, hwnd, msg, wp, lp);
}

// ── CreateMainWindow ──────────────────────────────────────────────────────────
// Creates the top-level window with frameless style but does NOT call
// ShowWindow.  Passing this HWND to webview::webview sets m_owns_window=false
// which skips the ShowWindow+UpdateWindow calls that used to expose an
// OS-decorated empty window for the entire ~1-3 s WebView2 init period.

HWND CreateMainWindow(int width, int height) {
    HINSTANCE hInst = GetModuleHandleW(nullptr);

    static bool registered = false;
    if (!registered) {
        WNDCLASSEXW wc{};
        wc.cbSize        = sizeof(wc);
        wc.lpfnWndProc   = DefWindowProcW;   // will be subclassed by MakeFrameless
        wc.hInstance     = hInst;
        wc.lpszClassName = L"cmdIDEMain";
        // Black background so no white flash if WM_ERASEBKGND fires before content
        wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
        wc.hCursor       = LoadCursorW(nullptr, IDC_ARROW);
        RegisterClassExW(&wc);
        registered = true;
    }

    // Centre on primary monitor
    int sw = GetSystemMetrics(SM_CXSCREEN);
    int sh = GetSystemMetrics(SM_CYSCREEN);
    int x  = (sw - width)  / 2;
    int y  = (sh - height) / 2;

    // NOTE: No WS_VISIBLE — the window must remain hidden until app.ready.
    HWND hwnd = CreateWindowExW(
        WS_EX_APPWINDOW,
        L"cmdIDEMain",
        L"cmdIDE",
        WS_POPUP | WS_THICKFRAME |
            WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU |
            WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        x, y, width, height,
        nullptr, nullptr, hInst, nullptr
    );

    return hwnd;
}

// ── MakeFrameless ─────────────────────────────────────────────────────────────
// Applies DWM shadow and subclasses the WndProc.  Call after the
// webview::webview constructor has returned so that the webview_widget child
// already exists (needed by the WM_SIZE handler that resizes it).

void MakeFrameless(HWND hwnd) {
    // Re-apply frameless style (webview's set_size may have altered GWL_STYLE).
    LONG style = WS_POPUP | WS_THICKFRAME |
                 WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU |
                 WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
    SetWindowLongPtrW(hwnd, GWL_STYLE, style);

    // DWM drop shadow via 1-px frame inset
    MARGINS margins = {1, 1, 1, 1};
    DwmExtendFrameIntoClientArea(hwnd, &margins);

    // Suppress the Windows 11 white border colour (DWMWA_BORDER_COLOR = 34).
#ifndef DWMWA_BORDER_COLOR
#define DWMWA_BORDER_COLOR 34
#endif
    const DWORD kColorNone = 0xFFFFFFFE; // DWMWA_COLOR_NONE
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &kColorNone, sizeof(kColorNone));

    // Subclass first so WM_NCCALCSIZE is routed through our handler from the start.
    g_orig_wndproc = reinterpret_cast<WNDPROC>(
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC,
                          reinterpret_cast<LONG_PTR>(FramelessWndProc)));

    // SWP_FRAMECHANGED triggers WM_NCCALCSIZE — now routed through our handler
    // so the client area is set correctly (no NC borders) from this point on.
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
}

void SetDragRects(HWND /*hwnd*/, const std::vector<DragRect>& rects) {
    // Kept for API compatibility — drag is handled entirely in JS/IPC.
    std::lock_guard<std::mutex> lk(g_drag_mutex);
    g_drag_rects.clear();
    (void)rects;
}

#endif // _WIN32
