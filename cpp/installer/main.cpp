#include "installer.hpp"
#include <webview.h>
#include <nlohmann/json.hpp>
#include <cstdlib>
#include <string>
#include <thread>

#ifdef _WIN32
#include <algorithm>
#include <windows.h>
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

    uint32_t hash = 0x811c9dc5u;
    for (DWORD i = 0; i < std::min(size, (DWORD)64); ++i)
        hash = (hash ^ (unsigned char)data[i]) * 0x01000193u;

    char tmp[MAX_PATH];
    GetTempPathA(MAX_PATH, tmp);
    char hashStr[12];
    sprintf_s(hashStr, "%08x", hash);
    std::string tmpPath(tmp);
    for (char& c : tmpPath) if (c == '\\') c = '/';
    while (!tmpPath.empty() && tmpPath.back() == '/') tmpPath.pop_back();
    std::string extractDir = tmpPath + "/cmdide-inst-" + hashStr;
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
         << "<title>cmdIDE Installer</title>"
         << "<style>" << css << "</style>"
         << "</head><body><div id=\"root\"></div>"
         << "<script type=\"module\">" << js << "</script>"
         << "</body></html>";
    return html.str();
}

// ── Window helpers ─────────────────────────────────────────────────────────────
static void MakeFrameless(HWND hwnd, int w, int h) {
    // Hide during transformation so the title-bar window never flashes
    ShowWindow(hwnd, SW_HIDE);
    SetWindowLongPtrW(hwnd, GWL_STYLE,
                      WS_POPUP | WS_SYSMENU | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
    int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
    SetWindowPos(hwnd, nullptr,
                 (sw - w) / 2, (sh - h) / 2, w, h,
                 SWP_NOZORDER | SWP_FRAMECHANGED);
    HICON hIcon = LoadIconW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(100));
    if (hIcon) {
        SendMessageW(hwnd, WM_SETICON, ICON_BIG,   reinterpret_cast<LPARAM>(hIcon));
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(hIcon));
    }
    // Show only after styling is complete — zero flash
    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);
}

#else
static std::string ExtractInstallerAssets() { return ""; }
static std::string BuildInlineHtml(const std::string&) { return "<html><body>Installer</body></html>"; }
static void MakeFrameless(void*, int, int) {}
#endif

static constexpr const char* kWailsProxy = R"js(
// ── IPC invoke helper ──────────────────────────────────────────────────────────
// The wails-shim.ts fails to load from data: URI context (dynamic import of a
// relative chunk URL fails). We replicate its functionality here in the init
// script, which runs reliably via WebView2's AddScriptToExecuteOnDocumentCreated.
function __ipcInvoke(type, args) {
  if (!window.__cmdide_invoke) return Promise.reject(new Error('IPC not available'));
  var reqId = Math.random().toString(36).slice(2);
  return window.__cmdide_invoke(type, JSON.stringify(args || {}), reqId)
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
    }
  }
};
// Stub window.runtime so EventsOn/EventsOff calls don't throw.
// The wails-shim will patch these properly if it loads; otherwise
// these no-ops prevent React from crashing in useEffect.
if (!window.runtime) {
  // Provide stubs for all Wails runtime functions used by the installer.
  // EventsOn → EventsOnMultiple → window.runtime.EventsOnMultiple (must exist!)
  window.__cmdide_events = {};
  window.runtime = {
    EventsOnMultiple: function(e, cb, max) {
      (window.__cmdide_events[e] = window.__cmdide_events[e] || []).push({cb: cb, max: max, count: 0});
      return function() { delete window.__cmdide_events[e]; };
    },
    EventsOn:   function(e, cb) { return window.runtime.EventsOnMultiple(e, cb, -1); },
    EventsOnce: function(e, cb) { return window.runtime.EventsOnMultiple(e, cb, 1); },
    EventsOff:  function(e) { delete window.__cmdide_events[e]; },
    EventsOffAll: function() { window.__cmdide_events = {}; },
    EventsEmit: function() {},
    LogPrint: function() {}, LogTrace: function() {}, LogDebug: function() {},
    LogInfo: function() {}, LogWarning: function() {}, LogError: function() {}, LogFatal: function() {},
    WindowSetTitle: function() {}, WindowReload: function() {}, WindowReloadApp: function() {},
    WindowSetAlwaysOnTop: function() {}, WindowCenter: function() {},
    WindowFullscreen: function() {}, WindowUnfullscreen: function() {},
    WindowSetSize: function() {}, WindowGetSize: function() { return Promise.resolve({w:460,h:330}); },
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
// Patch __cmdide_emit to fire into EventsOnMultiple-registered listeners.
// C++ calls: window.__cmdide_emit('event', arg1, arg2, ...)
// The callback receives the same positional args: callback(arg1, arg2, ...)
// e.g. install:progress -> callback(pct, msg)
//      installer:error  -> callback(errorMsg)
window.__cmdide_emit = function(event) {
  try {
    var args = Array.prototype.slice.call(arguments, 1);
    var entries = (window.__cmdide_events || {})[event] || [];
    var keep = [];
    entries.forEach(function(entry) {
      try { entry.cb.apply(null, args); } catch(e) {}
      entry.count++;
      if (entry.max < 0 || entry.count < entry.max) keep.push(entry);
    });
    window.__cmdide_events[event] = keep;
  } catch(e) {}
};
)js";

struct BindCtx { webview::webview* wv; InstallerApp* app; };

#ifdef _WIN32
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
#else
int main(int, char**) {
#endif
    std::string root = ExtractInstallerAssets();
    std::string html = root.empty()
        ? "<html><body style='background:#111;color:white;font-family:sans-serif;padding:20px'><h2>Installer Error: Could not extract assets</h2></body></html>"
        : BuildInlineHtml(root);

    webview::webview wv(false, nullptr);  // debug=false for release
    wv.set_title("cmdIDE Installer");
    wv.set_size(460, 330, WEBVIEW_HINT_FIXED);

#ifdef _WIN32
    {
        auto hwnd_res = wv.window();
        if (hwnd_res.ok())
            MakeFrameless(static_cast<HWND>(hwnd_res.value()), 460, 330);
    }
#endif

    InstallerApp app(wv);
    BindCtx ctx{&wv, &app};

    wv.bind("__cmdide_invoke",
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
                    if      (type == "installer.getReleases")   app->GetReleases(seq);
                    else if (type == "installer.getChannel")    app->GetChannel(seq);
                    else if (type == "installer.getInstallDir") app->GetInstallDir(seq);
                    else if (type == "installer.install")
                        app->Install(seq, args.value("version", std::string{}),
                                     args.value("createDesktop", false));
                    else if (type == "installer.launch") app->LaunchAndClose(seq);
                    else if (type == "installer.close")  app->CloseInstaller(seq);
                    else {
                        nlohmann::json r = {{"ok", false}, {"error", "not implemented: " + type}};
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
}
