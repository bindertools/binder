# Phase J — Native Window Features

## Overview

Ports the native window features that Go/Wails provided: the frameless window with custom
drag regions, the GDI splash screen, Windows taskbar jump-list registration, and single-instance
enforcement. After Phase J the C++ host window behaves identically to the Wails window from
the user's perspective.

---

## Git Workflow

**Branch:** `feat/webview-migration` (already created)

Commit after each backbone milestone. Push after this phase: `git push`

---

## Prompt J.1 — Frameless Window and Drag Regions

```
Context: terminal-IDE. The C++ WebView host window currently has a standard OS title bar.
The Wails app uses a frameless window (no title bar) and the frontend renders a custom title
bar with --wails-draggable CSS to make parts of the UI draggable. We need the same behaviour
in the C++ host.

Task: Make the C++ host window frameless and implement draggable regions that match the
frontend's existing CSS-based drag indicators.

Read before coding:
  - app/frontend/src/ — search for "--wails-draggable" and "drag" to find which elements
    use drag styling. Understand which CSS class triggers drag behaviour.
  - app/wails.json — check frameless and other window options set in the Wails config.
  - cpp/host/main.cpp (current state)

Requirements:

1. Frameless window on Windows
   After creating the webview::webview instance, retrieve the HWND:
     HWND hwnd = static_cast<HWND>(wv.get_native_handle(webview::native_handle_kind_t::ui_window));
   Remove the standard title bar and make it frameless:
     SetWindowLongPtr(hwnd, GWL_STYLE, WS_POPUP | WS_VISIBLE | WS_THICKFRAME | WS_MINIMIZEBOX |
                                        WS_MAXIMIZEBOX | WS_SYSMENU | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
   This removes the title bar but keeps the resize border and system menu.
   Call SetWindowPos with SWP_FRAMECHANGED to apply.
   Extend the frame into the client area for the drop shadow:
     MARGINS margins = {1, 1, 1, 1};
     DwmExtendFrameIntoClientArea(hwnd, &margins);

2. Drag regions via WM_NCHITTEST (Windows)
   The frontend marks drag regions with CSS class "drag-region" (or whatever class is used —
   verify by reading the frontend source). We need WM_NCHITTEST to return HTCAPTION when the
   cursor is over a drag region, enabling OS-level window dragging.

   Approach:
   a. The C++ host maintains a list of drag rectangles in screen coordinates.
   b. The frontend notifies C++ of drag rects via a new IPC call:
        window.__cmdide_invoke("window.setDragRects", {rects: [{x,y,w,h},...]} )
      C++ stores these rects. Call this from the frontend whenever the layout changes
      (on mount and on resize events).
   c. Subclass (or SetWindowSubclass) the HWND to intercept WM_NCHITTEST:
        if cursor is in any drag rect → return HTCAPTION
        if cursor is within 8px of any edge → return HTxxx resize values
        else → return HTCLIENT

   Create cpp/host/window_win.hpp and cpp/host/window_win.cpp:
     void MakeFrameless(HWND hwnd);
     void SetDragRects(HWND hwnd, const std::vector<RECT>& rects);
     (Internal WM_NCHITTEST subclass proc)

3. Frameless window on macOS
   On macOS, use the native window handle:
     id nswindow = wv.get_native_handle(webview::native_handle_kind_t::ui_window);
   Objective-C++ code in cpp/host/window_mac.mm:
     void MakeFrameless(void* nswindow) {
       NSWindow* win = (__bridge NSWindow*)nswindow;
       win.styleMask = NSWindowStyleMaskBorderless | NSWindowStyleMaskResizable;
       win.titlebarAppearsTransparent = YES;
       win.titleVisibility = NSWindowTitleHidden;
       win.movableByWindowBackground = YES;  // lets dragging anywhere move the window initially
     }
   For precise drag rects on macOS, implement mouseDownCanMoveWindow via a custom NSView
   subclass, or rely on movableByWindowBackground for the whole window with specific non-drag
   regions set to NS_NOTHITTEST. A simpler approach: use the same IPC rects mechanism and
   handle via a custom mouse-moved event listener in the WebView's NSView.

4. Frameless window on Linux
   On Linux with WebKitGTK, get the GtkWindow:
     GtkWindow* gtk_win = GTK_WINDOW(wv.get_native_handle(webview::native_handle_kind_t::ui_window));
   gtk_window_set_decorated(gtk_win, FALSE);
   For drag: gtk_window_begin_move_drag() called from a button-press-event signal on the
   drag region overlay. Use the same IPC rect mechanism; implement in cpp/host/window_linux.cpp.

5. Handle the window.setDragRects IPC type in cpp/host/dispatch.cpp.
   Add to the dispatch table:
     "window.setDragRects" → parse rects array, convert to RECT/Rect structs, call SetDragRects

6. Minimum window size
   Set minimum size to 800×500:
     wv.set_size(1280, 800, WEBVIEW_HINT_NONE);
     // After getting HWND, also set minimum track size via WM_GETMINMAXINFO

7. Resize handling
   When the WebView window is resized, the WebView content fills automatically.
   Ensure the frontend receives a window resize event so it can update drag rects:
   In the WM_SIZE handler (add to the subclass proc), call:
     emit("window.resize", {width: cx, height: cy})
   The frontend's layout components should call window.setDragRects when they receive this event.

Files to create/modify:
  cpp/host/window_win.cpp and .hpp  (Windows-specific)
  cpp/host/window_mac.mm and .hpp   (macOS-specific, Objective-C++)
  cpp/host/window_linux.cpp and .hpp (Linux-specific)
  cpp/host/CMakeLists.txt — add platform-conditional sources
  cpp/host/dispatch.cpp — add window.setDragRects handler

Verification:
  - Window opens without OS title bar.
  - Dragging over the custom title bar area moves the window.
  - Dragging over the terminal/editor area does NOT move the window.
  - Window can be resized by dragging the edges.
  - Double-click on the title bar area maximises/restores the window.
  - Window has a drop shadow (Windows).

Git commits — commit after each of the following milestones:
  1. Frameless window working (no OS title bar, has drop shadow):
       git commit -m "feat(host): frameless window — remove OS title bar, keep drop shadow"
  2. Drag regions via WM_NCHITTEST — window draggable from custom title bar:
       git commit -m "feat(host): drag regions via WM_NCHITTEST — window draggable from app title bar"
  3. Window resize event emitted to frontend:
       git commit -m "feat(host): emit window.resize event on resize for drag rect updates"
  4. git push:
       git push
```

### Effects
- `cpp/host/window_win.cpp/hpp`: Windows frameless + drag region implementation
- `cpp/host/window_mac.mm/hpp`: macOS frameless window
- `cpp/host/window_linux.cpp/hpp`: Linux frameless window
- `cpp/host/dispatch.cpp`: `window.setDragRects` and `window.resize` handlers
- `cpp/host/CMakeLists.txt`: platform-conditional sources

---

## Prompt J.2 — Splash Screen

```
Context: terminal-IDE. The Wails app shows a native Win32 GDI splash window while the WebView
loads (app/splash_windows.go, 422 lines). We need the same behaviour in the C++ host.

Task: Port the splash screen from Go to C++.

Read before coding:
  - app/splash_windows.go (REQUIRED — read all 422 lines to understand the GDI drawing code,
    PNG loading, message loop, and how it's closed when Wails signals ready)
  - app/frontend/src/ — find where the Wails domReady equivalent is triggered. The frontend
    must call window.__cmdide_invoke("app.ready") when it is ready to display.

Requirements:

1. cpp/host/splash_windows.cpp and cpp/host/splash_windows.hpp (Windows only)
   Port the existing Go GDI splash screen to C++.
   The splash screen implementation must:
     a. Load the splash PNG from an embedded resource (not a file on disk).
        The PNG is currently at app/frontend/src/assets/ or similar location — find it.
        Add it as a Windows RC resource in cpp/host/resources.rc.
     b. Create a borderless, topmost, centered popup window using CreateWindowEx with
        WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_POPUP.
     c. Handle WM_PAINT: decode the PNG using a Windows API (GDI+ Gdiplus::Image or
        LoadImage with WIC), draw centered on a solid background matching #0d0d0f.
     d. Show the splash in a background thread before wv.run() starts.
        Use std::thread to run the splash message loop.
     e. Expose Close() to terminate the splash: PostMessage(hwnd, WM_CLOSE, 0, 0).

   class SplashScreen {
   public:
     void Show();    // Creates window and starts message loop in a background thread
     void Close();   // Posts WM_CLOSE to the splash window
   };

2. cpp/host/main.cpp — integration
   - Instantiate SplashScreen before wv.run().
   - Call splash.Show() to display the splash.
   - Register the "app.ready" IPC handler in dispatch.cpp — when the frontend calls it,
     close the splash: dispatcher.GetSplash().Close().
   - Time out the splash after 10 seconds regardless (in case the frontend never calls it).

3. app/frontend/src/main.tsx — signal ready
   After React has mounted and the initial render is complete, call:
     if (isWebViewHost()) {
       invoke("app.ready").catch(() => {})
     }
   This replaces the Wails domReady callback.

4. Non-Windows platforms: no splash needed (WebKitGTK and WKWebView load quickly).
   Use #ifdef _WIN32 guards around all splash code.

5. Resources file cpp/host/resources.rc:
   #include <windows.h>
   IDI_APPICON ICON "icon.ico"
   IDB_SPLASH   RCDATA "splash.png"
   Add the .rc file to the CMakeLists.txt target.
   Ensure icon.ico and splash.png are copied to the host build directory or referenced
   with the correct relative path.

Git commits — commit after each of the following milestones:
  1. Splash PNG loaded from RC resource and displayed as GDI window:
       git commit -m "feat(host): port splash screen to C++ GDI — loads PNG from RC resource"
  2. Splash closes when frontend calls app.ready or after 10s timeout:
       git commit -m "feat(host): close splash on app.ready IPC call or 10s timeout"
  3. Frontend signals app.ready after React mounts:
       git commit -m "refactor(frontend): signal app.ready to C++ host after initial render"
  4. git push:
       git push
```

### Effects
- `cpp/host/splash_windows.cpp/hpp`: splash screen (Windows only)
- `cpp/host/resources.rc`: app icon + splash PNG as RC resources
- `cpp/host/dispatch.cpp`: `app.ready` handler
- `app/frontend/src/main.tsx`: `invoke("app.ready")` after React mounts

---

## Prompt J.3 — Jump List, Single Instance, and App Icon

```
Context: terminal-IDE. The Wails app has:
  - Windows taskbar jump-list registration (app/jumplist_windows.go)
  - App icon shown in taskbar/dock
  - Single-instance enforcement (Wails provides this via a mutex internally)
We need to port these to the C++ host.

Task: Port jump-list registration, enforce single-instance, and embed the app icon.

Read before coding:
  - app/jumplist_windows.go (REQUIRED — read the full file to understand what jump-list entries
    are registered and what COM APIs are called)
  - cpp/host/resources.rc (from J.2 — add icon if not already there)
  - cpp/host/main.cpp (current state)

Requirements:

1. Single-instance enforcement (all platforms)
   Create cpp/host/singleinstance.hpp:

   Windows:
     class SingleInstanceLock {
     public:
       bool Acquire(const std::wstring& mutex_name);
         Creates a named mutex "Global\\cmdIDE-<hash-of-exe-path>".
         Returns true if this is the first instance.
         Returns false if another instance already holds it.
       void Release();
     private:
       HANDLE mutex_ = nullptr;
     };

   macOS/Linux:
     Use a lockfile at $XDG_RUNTIME_DIR/cmdide.lock (Linux) or
     /tmp/cmdide-<username>.lock (macOS).
     Write the current PID. Return false if the file exists and the PID is still running.

   In cpp/host/main.cpp:
     SingleInstanceLock lock;
     if (!lock.Acquire(L"Global\\cmdIDE")) {
       // Another instance is running — bring it to the front and exit
       // Windows: BroadcastSystemMessage or find the window by class name and SetForegroundWindow
       // macOS: NSRunningApplication, activateWithOptions
       // Linux: wmctrl or X11 focus
       return 0;
     }

2. Jump-list registration (Windows only)
   Create cpp/host/jumplist_windows.cpp and cpp/host/jumplist_windows.hpp:
   Port the Go code from app/jumplist_windows.go directly to C++.
   The Go code calls win.InitJumpList() from the golang.org/x/sys/windows package.
   In C++, use the Windows COM ICustomDestinationList API:

     void RegisterJumpList(HWND hwnd, const std::wstring& appModelId) {
       CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
       ICustomDestinationList* pList = nullptr;
       CoCreateInstance(CLSID_DestinationList, nullptr, CLSCTX_INPROC_SERVER,
                        IID_PPV_ARGS(&pList));
       // ... configure jump list entries matching what Go's InitJumpList registered
       pList->CommitList();
       pList->Release();
     }

   Read app/jumplist_windows.go to find out exactly what entries are registered (new window,
   recent files, etc.) and replicate them in C++.

3. App icon (Windows)
   The icon.ico is already embedded in resources.rc from J.2.
   Register the window class icon:
     HICON hIcon = LoadIcon(GetModuleHandle(nullptr), MAKEINTRESOURCE(IDI_APPICON));
     SendMessage(hwnd, WM_SETICON, ICON_BIG, (LPARAM)hIcon);
     SendMessage(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)hIcon);

4. App icon (macOS)
   Set via Info.plist — included in the .app bundle (Phase M.2).
   In the C++ host binary, no extra code needed.

5. App icon (Linux)
   Set via .desktop file (Phase M.2).
   In the C++ host, load the icon file and set via gtk_window_set_icon():
     cpp/host/window_linux.cpp — add icon loading after window creation.

6. window.* IPC handlers for minimise/maximise (stub from I.3)
   Implement these now:
     "window.minimise"       → ShowWindow(hwnd, SW_MINIMIZE) / [nswindow miniaturize] / gtk_window_iconify
     "window.maximise"       → ShowWindow(hwnd, SW_MAXIMIZE) / [nswindow zoom] / gtk_window_maximize
     "window.unmaximise"     → ShowWindow(hwnd, SW_RESTORE)
     "window.toggleMaximise" → if IsZoomed(hwnd) → SW_RESTORE else SW_MAXIMIZE
     "window.isMaximised"    → IsZoomed(hwnd) ? true : false
     "window.isMinimised"    → IsIconic(hwnd) ? true : false

Files to create/modify:
  cpp/host/singleinstance.hpp
  cpp/host/jumplist_windows.cpp and .hpp
  cpp/host/main.cpp — single-instance check at startup, jump-list init after window created
  cpp/host/window_win.cpp — icon setting, window management handlers
  cpp/host/dispatch.cpp — implement window.minimise etc.

Verification:
  - Launching the app twice: second instance brings the first to the front and exits.
  - Right-clicking the taskbar icon shows jump-list entries matching the Wails app.
  - The app icon appears in the taskbar, Alt+Tab switcher, and title bar (if shown).
  - Minimise/maximise buttons in the custom title bar work correctly.

Git commits — commit after each of the following milestones:
  1. Single-instance enforcement — second launch brings first window to front:
       git commit -m "feat(host): single-instance lock — second launch focuses existing window"
  2. Jump-list registered — entries visible on right-click of taskbar:
       git commit -m "feat(host): port Windows jump-list registration to C++ COM API"
  3. Window management IPC handlers implemented (minimise, maximise, etc.):
       git commit -m "feat(host): implement window minimise/maximise IPC handlers"
  4. git push:
       git push
```

### Effects
- `cpp/host/singleinstance.hpp`: cross-platform single-instance lock
- `cpp/host/jumplist_windows.cpp/hpp`: Windows COM jump-list (ported from Go)
- `cpp/host/main.cpp`: single-instance check + jump-list init on startup
- `cpp/host/dispatch.cpp`: window management handlers fully implemented

---

## Phase J Checklist

- [ ] C++ host window has no OS title bar; custom app title bar is visible and functional
- [ ] Window is draggable from the custom title bar area only
- [ ] Window resizes correctly from all edges and corners
- [ ] Splash screen appears on cold start and closes when the UI loads (Windows)
- [ ] Second app launch focuses the first window and exits immediately
- [ ] Right-clicking the taskbar icon shows the jump list (Windows)
- [ ] App icon appears in taskbar, Alt+Tab, and dock (all platforms)
- [ ] Minimise/maximise buttons in the custom title bar work
- [ ] `git log --oneline` shows one commit per milestone
- [ ] Branch pushed: `git push`
