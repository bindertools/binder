#include "assets.hpp"
#include "dispatch.hpp"
#include "window_win.hpp"
#include "splash_windows.hpp"
#include "jumplist_windows.hpp"
#include "singleinstance.hpp"
#include "resource.h"
#include <webview.h>
#include <windows.h>
#include <nlohmann/json.hpp>
#include <cstdlib>
#include <string>

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

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    bool debug = false;
#ifdef _DEBUG
    debug = true;
#endif

#ifdef _WIN32
    // Single-instance: bring existing window to front and exit if already running
    if (!AcquireSingleInstance()) return 0;

    SplashScreen splash;
    splash.Show();
#endif

    webview::webview wv(debug, nullptr);
    wv.set_title("cmdIDE");
    wv.set_size(1280, 800, WEBVIEW_HINT_NONE);

#ifdef _WIN32
    // Make frameless + set taskbar icon after webview constructor (HWND is valid)
    auto hwnd_res = wv.window();
    if (hwnd_res.ok()) {
        HWND hwnd = static_cast<HWND>(hwnd_res.value());
        MakeFrameless(hwnd);

        // Set app icon in taskbar and Alt+Tab
        HICON hIcon = LoadIconW(GetModuleHandleW(nullptr),
                                MAKEINTRESOURCEW(IDI_APPICON));
        if (hIcon) {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG,   reinterpret_cast<LPARAM>(hIcon));
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(hIcon));
        }
    }
#endif

    // Instantiate dispatcher — full backend wiring
    Dispatcher dispatcher(wv);

#ifdef _WIN32
    // Register jump list (taskbar right-click entries)
    RegisterJumpList();
#endif

    // Pass splash pointer so app.ready IPC can close it
    dispatcher.SetSplash(
#ifdef _WIN32
        &splash
#else
        nullptr
#endif
    );

    // Register the IPC entry point BEFORE wv.run()
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

    // Inject Wails compatibility proxy via init script (runs before page scripts)
    wv.init(kWailsProxy);

    const char* dev_env = std::getenv("CMDIDE_DEV");
    std::string url = (dev_env && std::string(dev_env) == "1")
        ? GetDevUrl()
        : GetFrontendUrl(wv);

    wv.navigate(url);
    wv.run();
    return 0;
}
