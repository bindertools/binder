#pragma once
#ifdef _WIN32
#include <windows.h>
#include <vector>

struct DragRect { int x, y, w, h; };

// Create the main application window (hidden, frameless style, never shown
// by the caller).  Pass the returned HWND directly to the webview::webview
// constructor so that m_owns_window=false — this skips webview's own
// ShowWindow+UpdateWindow, preventing the OS-decorated flash during the
// synchronous WebView2 initialisation pump (~1-3 s).
//
// The window is shown only when the frontend fires app.ready (dispatch.cpp).
HWND CreateMainWindow(int width, int height);

// Apply frameless styling (WS_POPUP|WS_THICKFRAME, DWM shadow) and subclass
// the WndProc so resize edges and widget sizing work.
// Call after the webview::webview constructor has returned.
void MakeFrameless(HWND hwnd);

// Update the list of drag regions (screen coordinates).
// Thread-safe; kept for API compatibility (drag is now handled via JS/IPC).
void SetDragRects(HWND hwnd, const std::vector<DragRect>& rects);

#endif // _WIN32
