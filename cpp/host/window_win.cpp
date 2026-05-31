#ifdef _WIN32
#include "window_win.hpp"
#include <dwmapi.h>
#include <windowsx.h>  // GET_X_LPARAM, GET_Y_LPARAM
#include <mutex>
#include <vector>

// Per-HWND drag rect storage (single window app — one entry is enough)
static std::vector<RECT>    g_drag_rects;
static std::mutex           g_drag_mutex;
static HWND                 g_hwnd_subclassed = nullptr;
static WNDPROC              g_orig_wndproc    = nullptr;

// Convert DPI-aware client point to screen coordinates for hit-testing
static bool PointInRect(int px, int py, const RECT& r) {
    return px >= r.left && px < r.right && py >= r.top && py < r.bottom;
}

// Custom WndProc handling WM_NCHITTEST and WM_GETMINMAXINFO
static LRESULT CALLBACK FramelessWndProc(HWND hwnd, UINT msg,
                                         WPARAM wp, LPARAM lp) {
    if (msg == WM_NCHITTEST) {
        // Screen coordinates of cursor
        int sx = GET_X_LPARAM(lp);
        int sy = GET_Y_LPARAM(lp);

        // Get window rect for edge detection
        RECT wr{};
        GetWindowRect(hwnd, &wr);
        constexpr int kEdge = 8;

        // Check resize edges first (higher priority than drag)
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

        // Check drag regions (HTCAPTION enables OS window dragging)
        {
            std::lock_guard<std::mutex> lk(g_drag_mutex);
            for (const auto& r : g_drag_rects) {
                if (PointInRect(sx, sy, r)) return HTCAPTION;
            }
        }
        return HTCLIENT;
    }

    if (msg == WM_GETMINMAXINFO) {
        auto* mmi = reinterpret_cast<MINMAXINFO*>(lp);
        mmi->ptMinTrackSize.x = 800;
        mmi->ptMinTrackSize.y = 500;
    }

    return CallWindowProcW(g_orig_wndproc, hwnd, msg, wp, lp);
}

void MakeFrameless(HWND hwnd) {
    // Remove title bar but keep resize handles and system menu
    LONG style = WS_POPUP | WS_VISIBLE | WS_THICKFRAME |
                 WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU |
                 WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
    SetWindowLongPtrW(hwnd, GWL_STYLE, style);
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);

    // Extend the DWM frame into the client area to restore the drop shadow
    MARGINS margins = {1, 1, 1, 1};
    DwmExtendFrameIntoClientArea(hwnd, &margins);

    // Subclass the window to intercept WM_NCHITTEST
    g_hwnd_subclassed = hwnd;
    g_orig_wndproc = reinterpret_cast<WNDPROC>(
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC,
                          reinterpret_cast<LONG_PTR>(FramelessWndProc)));
}

void SetDragRects(HWND /*hwnd*/, const std::vector<DragRect>& rects) {
    std::lock_guard<std::mutex> lk(g_drag_mutex);
    g_drag_rects.clear();
    g_drag_rects.reserve(rects.size());
    for (const auto& r : rects) {
        g_drag_rects.push_back({r.x, r.y, r.x + r.w, r.y + r.h});
    }
}

#endif // _WIN32
