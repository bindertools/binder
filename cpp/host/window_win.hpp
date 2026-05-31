#pragma once
#ifdef _WIN32
#include <windows.h>
#include <vector>

struct DragRect { int x, y, w, h; };

// Remove title bar, add drop shadow, enable frameless resize.
// Call immediately after the webview::webview constructor returns (HWND is valid).
void MakeFrameless(HWND hwnd);

// Update the list of drag regions (screen coordinates).
// WM_NCHITTEST returns HTCAPTION when the cursor is inside any rect.
// Thread-safe; safe to call from any thread.
void SetDragRects(HWND hwnd, const std::vector<DragRect>& rects);

#endif // _WIN32
