#pragma once
#include <webview.h>
#include <string>
#include <cstdlib>

#ifdef _WIN32
#include <windows.h>
#include <WebView2.h>
#include <filesystem>
namespace fs = std::filesystem;

// Returns the directory containing the running executable.
inline std::string GetExeDir() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    return fs::path(path).parent_path().string();
}
#else
#include <filesystem>
#include <unistd.h>
namespace fs = std::filesystem;

inline std::string GetExeDir() {
    char path[4096] = {};
    ssize_t n = readlink("/proc/self/exe", path, sizeof(path) - 1);
    if (n > 0) return fs::path(path).parent_path().string();
    return fs::current_path().string();
}
#endif

// ── GetDevUrl ─────────────────────────────────────────────────────────────────
inline std::string GetDevUrl() {
    return "http://localhost:5173";
}

// ── GetFrontendUrl ────────────────────────────────────────────────────────────
// On Windows: maps the www/ directory to a virtual hostname so the frontend
// loads as "https://app.local/index.html" (avoids file:// CORS restrictions).
// On other platforms: returns a file:// URL.
//
// Must be called AFTER the webview::webview constructor returns, since WebView2
// is initialized synchronously by the constructor.
#ifdef _WIN32
inline std::string GetFrontendUrl(webview::webview& wv) {
    std::string exe_dir = GetExeDir();
    std::string www_dir = exe_dir + "\\www";

    // Try to set up virtual host mapping for HTTPS-like access
    auto ctrl_res = wv.browser_controller();
    if (ctrl_res.ok()) {
        auto* controller = static_cast<ICoreWebView2Controller*>(ctrl_res.value());
        ICoreWebView2* wv2 = nullptr;
        if (SUCCEEDED(controller->get_CoreWebView2(&wv2)) && wv2) {
            ICoreWebView2_3* wv2_3 = nullptr;
            if (SUCCEEDED(wv2->QueryInterface(IID_PPV_ARGS(&wv2_3))) && wv2_3) {
                std::wstring wdir(www_dir.begin(), www_dir.end());
                wv2_3->SetVirtualHostNameToFolderMapping(
                    L"app.local", wdir.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW
                );
                wv2_3->Release();
                wv2->Release();
                return "https://app.local/index.html";
            }
            wv2->Release();
        }
    }
    // Fallback to file:// if virtual host setup failed
    return "file:///" + www_dir + "/index.html";
}
#else
inline std::string GetFrontendUrl(webview::webview& /*wv*/) {
    return "file://" + GetExeDir() + "/www/index.html";
}
#endif
