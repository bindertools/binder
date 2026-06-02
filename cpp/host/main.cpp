#include "assets.hpp"
#include "dispatch.hpp"
#include <webview.h>
#include <nlohmann/json.hpp>
#include <cstdlib>
#include <string>

#ifdef _WIN32
#include "window_win.hpp"
#include "splash_windows.hpp"
#include "jumplist_windows.hpp"
#include "singleinstance.hpp"
#include "resource.h"
#include <windows.h>
#include <objbase.h>  // CoInitializeEx
#endif

// Suppress Wails window.go errors; the TypeScript shim replaces this properly.
static constexpr const char* kWailsProxy = R"js(
window.go = window.go || new Proxy({}, {
  get: function(_, k) {
    return new Proxy(function(){}, {
      get: function(_, k2) {
        return new Proxy(function(){}, {
          get: function(_, k3) {
            return function() {
              return Promise.reject('Wails not available in C++ host');
            };
          }
        });
      }
    });
  }
});
)js";

#ifdef _WIN32
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
#else
int main(int, char**) {
#endif
    bool debug = false;
#ifdef _DEBUG
    debug = true;
#endif

#ifdef _WIN32
    if (!AcquireSingleInstance()) return 0;
    SplashScreen splash;
    splash.Show();

    // ── COM + DPI — must happen before webview construction ──────────────────────
    // When we pass our own HWND (m_owns_window=false), webview skips its own
    // CoInitializeEx and enable_dpi_awareness calls, so we do them here.
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (HMODULE u32 = GetModuleHandleW(L"user32.dll")) {
        using FnCtx  = BOOL(WINAPI*)(DPI_AWARENESS_CONTEXT);
        using FnAware = BOOL(WINAPI*)();
        if (auto fn = reinterpret_cast<FnCtx>(GetProcAddress(u32, "SetProcessDpiAwarenessContext")))
            fn(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        else if (auto fn2 = reinterpret_cast<FnAware>(GetProcAddress(u32, "SetProcessDPIAware")))
            fn2();
    }

    // ── Pre-create the main window BEFORE the webview constructor ────────────────
    // Passing our HWND sets m_owns_window=false, which skips the
    // ShowWindow+UpdateWindow calls webview would otherwise make during the
    // ~2-3 s synchronous WebView2 init pump.  Window stays hidden until
    // app.ready fires and dispatch.cpp calls ShowWindow(SW_SHOW).
    constexpr int kInitW = 1280, kInitH = 800;
    HWND main_hwnd = CreateMainWindow(kInitW, kInitH);
    if (!main_hwnd) return 1;
#endif

    // Pass main_hwnd on Windows (m_owns_window=false → no ShowWindow in ctor).
    // Pass nullptr on other platforms (webview creates its own window).
    webview::webview wv(debug,
#ifdef _WIN32
        main_hwnd
#else
        nullptr
#endif
    );
    wv.set_title("cmdIDE");

#ifdef _WIN32
    // After the constructor the webview_widget child exists but has size 0×0
    // (webview never calls set_size when m_owns_window=false).  Resize it now
    // so WebView2 gets correct bounds when it calls resize_webview() later.
    {
        RECT r{};
        GetClientRect(main_hwnd, &r);
        HWND widget = GetWindow(main_hwnd, GW_CHILD);
        if (widget) MoveWindow(widget, 0, 0, r.right - r.left, r.bottom - r.top, FALSE);
    }

    // Apply frameless styling and subclass the WndProc.
    // FramelessWndProc handles: WM_NCHITTEST (resize edges), WM_SIZE (resize
    // the webview_widget child), WM_ACTIVATE (focus the widget).
    MakeFrameless(main_hwnd);

    // App icon
    HICON hIcon = LoadIconW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_APPICON));
    if (hIcon) {
        SendMessageW(main_hwnd, WM_SETICON, ICON_BIG,   reinterpret_cast<LPARAM>(hIcon));
        SendMessageW(main_hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(hIcon));
    }
#else
    wv.set_size(1280, 800, WEBVIEW_HINT_NONE);
#endif

    Dispatcher dispatcher(wv);

#ifdef _WIN32
    RegisterJumpList();
    dispatcher.SetSplash(&splash);
#else
    dispatcher.SetSplash(nullptr);
#endif

    wv.bind("__cmdide_invoke",
        [](const std::string& seq, const std::string& req, void* arg) {
            auto* d = static_cast<Dispatcher*>(arg);
            try {
                auto arr  = nlohmann::json::parse(req);
                auto type = arr[0].get<std::string>();
                auto args = arr[1].get<std::string>();
                d->dispatch(seq, type, args);
            } catch (const std::exception& e) {
                nlohmann::json err = {{"ok", false}, {"error", std::string("parse error: ") + e.what()}};
                d->dispatch(seq, "__error", err.dump());
            }
        },
        &dispatcher);

    wv.init(kWailsProxy);

    // Native window drag: JS mousedown on --wails-draggable:drag elements calls
    // window.startDrag IPC → PostMessage WM_SYSCOMMAND SC_MOVE → OS drag loop.
    wv.init(R"js(
document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  var el = e.target;
  while (el && el !== document.documentElement) {
    var drag = el.style ? el.style.getPropertyValue('--wails-draggable').trim() : '';
    if (!drag) {
      try { drag = window.getComputedStyle(el).getPropertyValue('--wails-draggable').trim(); } catch(err) {}
    }
    if (drag === 'no-drag') return;
    if (drag === 'drag') {
      if (window.__cmdide_invoke) {
        e.preventDefault();
        window.__cmdide_invoke('window.startDrag', '{}', Math.random().toString(36).slice(2));
      }
      return;
    }
    el = el.parentElement;
  }
});
)js");

    const char* dev_env = std::getenv("CMDIDE_DEV");
    std::string url;
    if (dev_env && std::string(dev_env) == "1") {
        url = GetDevUrl();
    } else {
        std::string root = ExtractAssets();
        url = GetFrontendUrl(wv, root);
    }

    wv.navigate(url);
    wv.run();
    return 0;
}
