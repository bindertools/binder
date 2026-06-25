#include "installer.hpp"
#include <webview.h>
#include <nlohmann/json.hpp>
#include <cstdlib>
#include <string>
#include <thread>

#ifdef _WIN32
#include <algorithm>
#include <windows.h>
#include <objbase.h>  // CoInitializeEx
#include <zip.h>
#include <filesystem>
#include <fstream>
#include <sstream>
namespace fs = std::filesystem;

// ── Asset extraction ──────────────────────────────────────────────────────────
static std::string ExtractInstallerAssets() {
    HMODULE hMod = GetModuleHandleW(nullptr);
    HRSRC hRes = FindResourceW(hMod, L"FRONTEND_ZIP", RT_RCDATA);
    if (!hRes) return "";

    HGLOBAL hData  = LoadResource(hMod, hRes);
    const char* data = static_cast<const char*>(LockResource(hData));
    DWORD       size = SizeofResource(hMod, hRes);
    if (!data || size == 0) return "";

    // Hash the WHOLE resource, not just the first 64 bytes — a couple of the
    // embedded files (e.g. favicon.svg) are byte-identical across rebuilds,
    // so a short prefix hash can collide between an old and a new zip and
    // cause the cached-extraction check below to skip extracting fresh
    // content forever, silently serving a stale frontend indefinitely.
    uint32_t hash = 0x811c9dc5u;
    for (DWORD i = 0; i < size; ++i)
        hash = (hash ^ (unsigned char)data[i]) * 0x01000193u;

    char tmp[MAX_PATH];
    GetTempPathA(MAX_PATH, tmp);
    char hashStr[12];
    sprintf_s(hashStr, "%08x", hash);
    std::string tmpPath(tmp);
    for (char& c : tmpPath) if (c == '\\') c = '/';
    while (!tmpPath.empty() && tmpPath.back() == '/') tmpPath.pop_back();
    std::string extractDir = tmpPath + "/binder-inst-" + hashStr;
    std::string marker     = extractDir + "/.extracted";

    if (GetFileAttributesA(marker.c_str()) != INVALID_FILE_ATTRIBUTES)
        return extractDir;

    fs::create_directories(extractDir);
    zip_error_t ze{};
    zip_source_t* src = zip_source_buffer_create(data, size, 0, &ze);
    if (!src) return "";
    zip_t* za = zip_open_from_source(src, ZIP_RDONLY, &ze);
    if (!za) { zip_source_free(src); return ""; }

    zip_int64_t count = zip_get_num_entries(za, 0);
    for (zip_int64_t i = 0; i < count; ++i) {
        const char* name = zip_get_name(za, i, 0);
        if (!name) continue;
        std::string dest = extractDir + "/" + name;
        if (name[strlen(name) - 1] == '/') { fs::create_directories(dest); continue; }
        fs::create_directories(fs::path(dest).parent_path());
        zip_file_t* zf = zip_fopen_index(za, i, 0);
        if (!zf) continue;
        std::ofstream out(dest, std::ios::binary);
        char buf[65536]; zip_int64_t n;
        while ((n = zip_fread(zf, buf, sizeof(buf))) > 0) out.write(buf, n);
        zip_fclose(zf);
    }
    zip_close(za);
    std::ofstream(marker).close();
    return extractDir;
}

// ── Read a file into a string ─────────────────────────────────────────────────
static std::string ReadFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return "";
    return {std::istreambuf_iterator<char>(f), {}};
}

// ── Base64 encode (RFC 4648, no line breaks) ──────────────────────────────────
static std::string Base64Encode(const std::string& s) {
    static constexpr char kAlpha[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((s.size() + 2) / 3) * 4);
    for (size_t i = 0; i < s.size(); i += 3) {
        auto b0 = (uint8_t)s[i];
        auto b1 = i+1 < s.size() ? (uint8_t)s[i+1] : 0;
        auto b2 = i+2 < s.size() ? (uint8_t)s[i+2] : 0;
        uint32_t v = (b0 << 16) | (b1 << 8) | b2;
        out += kAlpha[(v >> 18) & 0x3F];
        out += kAlpha[(v >> 12) & 0x3F];
        out += i+1 < s.size() ? kAlpha[(v >>  6) & 0x3F] : '=';
        out += i+2 < s.size() ? kAlpha[ v        & 0x3F] : '=';
    }
    return out;
}

// ── Find first file matching extension in a directory ────────────────────────
static std::string FindFile(const std::string& dir, const std::string& ext) {
    for (auto& entry : fs::directory_iterator(dir)) {
        if (entry.path().extension() == ext)
            return entry.path().string();
    }
    return "";
}

// ── Build self-contained HTML (inline CSS + JS + SVG assets) ─────────────────
// WebView2's AppContainer sandbox blocks loopback HTTP.
// All assets are inlined — CSS as <style>, JS as <script type="module">,
// SVGs as data: URIs patched directly into the JS bundle.
static std::string BuildInlineHtml(const std::string& extractDir) {
    std::string assetsDir = extractDir + "/assets";

    std::string jsPath, cssPath;
    size_t maxSize = 0;
    for (auto& entry : fs::directory_iterator(assetsDir)) {
        if (entry.path().extension() == ".js") {
            size_t sz = static_cast<size_t>(entry.file_size());
            if (sz > maxSize) { maxSize = sz; jsPath = entry.path().string(); }
        } else if (entry.path().extension() == ".css") {
            cssPath = entry.path().string();
        }
    }

    std::string js  = ReadFile(jsPath);
    std::string css = ReadFile(cssPath);

    // Inline SVG assets as data: URIs — absolute paths like /lockup-dark.svg
    // can't load from a data: URI context, so we patch them directly in the JS.
    auto inlineSvg = [&](const std::string& name) {
        std::string path = extractDir + "/" + name;
        std::string content = ReadFile(path);
        if (content.empty()) return;
        std::string dataUri = "data:image/svg+xml;base64," + Base64Encode(content);
        // Replace all occurrences of the absolute path in the JS bundle
        std::string needle = "/" + name;
        size_t pos = 0;
        while ((pos = js.find(needle, pos)) != std::string::npos) {
            js.replace(pos, needle.length(), dataUri);
            pos += dataUri.length();
        }
    };
    inlineSvg("lockup-dark.svg");
    inlineSvg("lockup-light.svg");
    inlineSvg("logo-dark.svg");
    inlineSvg("logo-light.svg");

    std::ostringstream html;
    html << "<!DOCTYPE html><html lang=\"en\"><head>"
         << "<meta charset=\"UTF-8\"/>"
         << "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"/>"
         << "<title>Binder Setup</title>"
         << "<style>" << css << "</style>"
         << "</head><body><div id=\"root\"></div>"
         << "<script type=\"module\">" << js << "</script>"
         << "</body></html>";
    return html.str();
}

// ── Window helpers ─────────────────────────────────────────────────────────────
// The setup window is created hidden (no WS_VISIBLE) and handed to the
// webview::webview constructor so it sets m_owns_window=false — that skips
// webview's internal CreateWindow+ShowWindow, which otherwise briefly shows a
// generic WS_OVERLAPPEDWINDOW (default icon, default position) before this
// code ever gets to style or centre it. The window is only made visible once
// the frontend signals it has painted (installer.ready), via
// InstallerApp::Ready, which also calls SetForegroundWindow so it doesn't end
// up parked on the taskbar without focus.
static LRESULT CALLBACK SetupWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_CLOSE:
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    case WM_ACTIVATE:
        if (LOWORD(wp) != WA_INACTIVE) {
            HWND child = GetWindow(hwnd, GW_CHILD);
            if (child) SetFocus(child);
        }
        break;
    case WM_SIZE: {
        RECT r{};
        GetClientRect(hwnd, &r);
        HWND child = GetWindow(hwnd, GW_CHILD);
        if (child) {
            SetWindowPos(child, nullptr, 0, 0, r.right - r.left, r.bottom - r.top,
                         SWP_NOZORDER | SWP_NOACTIVATE);
        }
        break;
    }
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

static HWND CreateSetupWindow(int w, int h) {
    HINSTANCE hInst = GetModuleHandleW(nullptr);

    static bool registered = false;
    if (!registered) {
        WNDCLASSEXW wc{};
        wc.cbSize        = sizeof(wc);
        wc.lpfnWndProc   = SetupWndProc;
        wc.hInstance     = hInst;
        wc.lpszClassName = L"BinderSetup";
        wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
        wc.hCursor       = LoadCursorW(nullptr, IDC_ARROW);
        wc.hIcon         = LoadIconW(hInst, MAKEINTRESOURCEW(100));
        RegisterClassExW(&wc);
        registered = true;
    }

    int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
    int x  = (sw - w) / 2, y = (sh - h) / 2;

    // No WS_VISIBLE — stays hidden until InstallerApp::Ready shows it.
    return CreateWindowExW(
        WS_EX_APPWINDOW,
        L"BinderSetup", L"Binder Setup",
        WS_POPUP | WS_SYSMENU | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        x, y, w, h,
        nullptr, nullptr, hInst, nullptr);
}

#else
static std::string ExtractInstallerAssets() { return ""; }
static std::string BuildInlineHtml(const std::string&) { return "<html><body>Setup</body></html>"; }
static void* CreateSetupWindow(int, int) { return nullptr; }
#endif

static constexpr const char* kWailsProxy = R"js(
// ── IPC invoke helper ──────────────────────────────────────────────────────────
// The wails-shim.ts fails to load from data: URI context (dynamic import of a
// relative chunk URL fails). We replicate its functionality here in the init
// script, which runs reliably via WebView2's AddScriptToExecuteOnDocumentCreated.
function __ipcInvoke(type, args) {
  if (!window.__binder_invoke) return Promise.reject(new Error('IPC not available'));
  var reqId = Math.random().toString(36).slice(2);
  return window.__binder_invoke(type, JSON.stringify(args || {}), reqId)
    .then(function(result) {
      // webview/webview automatically JSON.parses the resolve value,
      // so result is already a JS object: {ok: bool, data: ...}
      if (!result.ok) throw new Error(result.error);
      return result.data;
    });
}

// ── Patch window.go.main.App.* to call the C++ InstallerApp via IPC ───────────
// This replaces what wails-shim.ts would normally do.
window.go = {
  main: {
    App: {
      GetReleases:    function() { return __ipcInvoke('installer.getReleases', {}); },
      GetChannel:     function() { return __ipcInvoke('installer.getChannel', {}); },
      GetInstallDir:  function() { return __ipcInvoke('installer.getInstallDir', {}); },
      Install:        function(v, d) { return __ipcInvoke('installer.install', {version: v, createDesktop: d}); },
      LaunchAndClose: function() { return __ipcInvoke('installer.launch', {}); },
      CloseInstaller: function() { return __ipcInvoke('installer.close', {}); },
      Ready:          function() { return __ipcInvoke('installer.ready', {}); },
    }
  }
};
// Stub window.runtime so EventsOn/EventsOff calls don't throw.
// The wails-shim will patch these properly if it loads; otherwise
// these no-ops prevent React from crashing in useEffect.
if (!window.runtime) {
  // Provide stubs for all Wails runtime functions used by the installer.
  // EventsOn → EventsOnMultiple → window.runtime.EventsOnMultiple (must exist!)
  window.__binder_events = {};
  window.runtime = {
    EventsOnMultiple: function(e, cb, max) {
      (window.__binder_events[e] = window.__binder_events[e] || []).push({cb: cb, max: max, count: 0});
      return function() { delete window.__binder_events[e]; };
    },
    EventsOn:   function(e, cb) { return window.runtime.EventsOnMultiple(e, cb, -1); },
    EventsOnce: function(e, cb) { return window.runtime.EventsOnMultiple(e, cb, 1); },
    EventsOff:  function(e) { delete window.__binder_events[e]; },
    EventsOffAll: function() { window.__binder_events = {}; },
    EventsEmit: function() {},
    LogPrint: function() {}, LogTrace: function() {}, LogDebug: function() {},
    LogInfo: function() {}, LogWarning: function() {}, LogError: function() {}, LogFatal: function() {},
    WindowSetTitle: function() {}, WindowReload: function() {}, WindowReloadApp: function() {},
    WindowSetAlwaysOnTop: function() {}, WindowCenter: function() {},
    WindowFullscreen: function() {}, WindowUnfullscreen: function() {},
    WindowSetSize: function() {}, WindowGetSize: function() { return Promise.resolve({w:640,h:520}); },
    WindowSetMaxSize: function() {}, WindowSetMinSize: function() {}, WindowSetPosition: function() {},
    WindowGetPosition: function() { return Promise.resolve({x:0,y:0}); },
    WindowIsFullscreen: function() { return Promise.resolve(false); },
    WindowIsMaximised: function() { return Promise.resolve(false); },
    WindowIsMinimised: function() { return Promise.resolve(false); },
    WindowMaximise: function() {}, WindowUnmaximise: function() {},
    WindowToggleMaximise: function() {}, WindowMinimise: function() {}, WindowUnminimise: function() {},
    BrowserOpenURL: function() {}, ScreenGetAll: function() { return Promise.resolve([]); },
    Environment: function() { return Promise.resolve({platform:'windows',arch:'amd64',buildType:'production'}); },
    Quit: function() {},
    WindowSetSystemDefaultTheme: function() {}, WindowSetLightTheme: function() {}, WindowSetDarkTheme: function() {},
  };
}
// Patch __binder_emit to fire into EventsOnMultiple-registered listeners.
// C++ calls: window.__binder_emit('event', arg1, arg2, ...)
// The callback receives the same positional args: callback(arg1, arg2, ...)
// e.g. install:progress -> callback(pct, msg)
//      installer:error  -> callback(errorMsg)
window.__binder_emit = function(event) {
  try {
    var args = Array.prototype.slice.call(arguments, 1);
    var entries = (window.__binder_events || {})[event] || [];
    var keep = [];
    entries.forEach(function(entry) {
      try { entry.cb.apply(null, args); } catch(e) {}
      entry.count++;
      if (entry.max < 0 || entry.count < entry.max) keep.push(entry);
    });
    window.__binder_events[event] = keep;
  } catch(e) {}
};
)js";

struct BindCtx { webview::webview* wv; InstallerApp* app; };

#ifdef _WIN32
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
#else
int main(int, char**) {
#endif
  try {
    std::string root = ExtractInstallerAssets();
    std::string html = root.empty()
        ? "<html><body style='background:#111;color:white;font-family:sans-serif;padding:20px'><h2>Setup Error: Could not extract assets</h2></body></html>"
        : BuildInlineHtml(root);

    constexpr int kW = 640, kH = 520;

#ifdef _WIN32
    // Passing our own HWND below sets webview's m_owns_window=false, which
    // skips webview's internal CoInitializeEx + DPI-awareness calls (they're
    // gated behind `if (m_owns_window)` in win32_edge_engine's constructor).
    // Without this, WebView2's COM-based environment/controller creation
    // fails and the installer never opens. Must happen before window creation.
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (HMODULE u32 = GetModuleHandleW(L"user32.dll")) {
        using FnCtx   = BOOL(WINAPI*)(DPI_AWARENESS_CONTEXT);
        using FnAware = BOOL(WINAPI*)();
        if (auto fn = reinterpret_cast<FnCtx>(GetProcAddress(u32, "SetProcessDpiAwarenessContext")))
            fn(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        else if (auto fn2 = reinterpret_cast<FnAware>(GetProcAddress(u32, "SetProcessDPIAware")))
            fn2();
    }

    HWND setup_hwnd = CreateSetupWindow(kW, kH);
    if (!setup_hwnd) return 1;
#endif

    webview::webview wv(false,  // debug=false for release
#ifdef _WIN32
        setup_hwnd
#else
        nullptr
#endif
    );
    wv.set_title("Binder Setup");

#ifdef _WIN32
    // webview never calls set_size when m_owns_window=false, so the
    // webview_widget child exists but is sized 0x0 — resize it to our
    // already-correctly-sized hidden window's client area.
    {
        RECT r{};
        GetClientRect(setup_hwnd, &r);
        HWND widget = GetWindow(setup_hwnd, GW_CHILD);
        if (widget) MoveWindow(widget, 0, 0, r.right - r.left, r.bottom - r.top, FALSE);
    }
#else
    wv.set_size(kW, kH, WEBVIEW_HINT_FIXED);
#endif

    InstallerApp app(wv);
    BindCtx ctx{&wv, &app};

    wv.bind("__binder_invoke",
        [](const std::string& seq, const std::string& req, void* arg) {
            auto* ctx = static_cast<BindCtx*>(arg);
            try {
                auto arr  = nlohmann::json::parse(req);
                auto type = arr[0].get<std::string>();
                auto args = nlohmann::json::parse(
                    arr[1].get<std::string>().empty() ? "{}" : arr[1].get<std::string>());

                std::thread([ctx, seq, type, args]() {
                    auto* wv  = ctx->wv;
                    auto* app = ctx->app;
                    try {
                        if      (type == "installer.getReleases")   app->GetReleases(seq);
                        else if (type == "installer.getChannel")    app->GetChannel(seq);
                        else if (type == "installer.getInstallDir") app->GetInstallDir(seq);
                        else if (type == "installer.install")
                            app->Install(seq, args.value("version", std::string{}),
                                         args.value("createDesktop", false),
                                         args.value("seedApps", std::vector<std::string>{}));
                        else if (type == "installer.launch") app->LaunchAndClose(seq);
                        else if (type == "installer.close")  app->CloseInstaller(seq);
                        else if (type == "installer.ready")  app->Ready(seq);
                        else {
                            nlohmann::json r = {{"ok", false}, {"error", "not implemented: " + type}};
                            wv->resolve(seq, 0, r.dump());
                        }
                    } catch (const std::exception& e) {
                        // An exception escaping a detached thread's entry
                        // function calls std::terminate() -> abort(), which
                        // kills the whole process (observed as exception
                        // 0xc0000409 / fail-fast). Must not let that happen.
                        nlohmann::json r = {{"ok", false}, {"error", e.what()}};
                        wv->resolve(seq, 0, r.dump());
                    } catch (...) {
                        nlohmann::json r = {{"ok", false}, {"error", "unknown error in " + type}};
                        wv->resolve(seq, 0, r.dump());
                    }
                }).detach();
            } catch (const std::exception& e) {
                nlohmann::json r = {{"ok", false}, {"error", e.what()}};
                ctx->wv->resolve(seq, 0, r.dump());
            }
        },
        &ctx);

    wv.init(kWailsProxy);
    wv.navigate("data:text/html;base64," + Base64Encode(html));
    wv.run();
    return 0;
  } catch (const std::exception& e) {
    // Without this, an exception here (e.g. WebView2 runtime missing) calls
    // std::terminate() -> abort() and the installer vanishes with no trace
    // other than an Application Error event log entry (exception 0xc0000409).
#ifdef _WIN32
    std::wstring wmsg(e.what(), e.what() + strlen(e.what()));
    MessageBoxW(nullptr, wmsg.c_str(), L"Binder Setup - Error", MB_OK | MB_ICONERROR);
#endif
    return 1;
  } catch (...) {
#ifdef _WIN32
    MessageBoxW(nullptr, L"Unknown error during startup", L"Binder Setup - Error", MB_OK | MB_ICONERROR);
#endif
    return 1;
  }
}
