#include "installer.hpp"
#include <webview.h>
#include <nlohmann/json.hpp>
#include <cstdlib>
#include <string>
#include <thread>

#ifdef _WIN32
#include <algorithm>
#include <windows.h>
#include <dwmapi.h>
#include <zip.h>
#include <filesystem>
#include <fstream>
#include <WebView2.h>
namespace fs = std::filesystem;

// ── Asset extraction ──────────────────────────────────────────────────────────
static std::string ExtractInstallerAssets() {
    HMODULE hMod = GetModuleHandleW(nullptr);
    HRSRC hRes = FindResourceW(hMod, L"FRONTEND_ZIP", RT_RCDATA);
    if (!hRes) {
        // Dev/fallback: look for www/ next to the exe
        wchar_t exe[MAX_PATH];
        GetModuleFileNameW(nullptr, exe, MAX_PATH);
        std::string dir = fs::path(exe).parent_path().string();
        for (char& c : dir) if (c == '\\') c = '/';
        return dir + "/www";
    }

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
        return extractDir;  // already extracted

    fs::create_directories(extractDir);
    zip_error_t ze{};
    zip_source_t* src = zip_source_buffer_create(data, size, 0, &ze);
    if (!src) return extractDir;
    zip_t* za = zip_open_from_source(src, ZIP_RDONLY, &ze);
    if (!za) { zip_source_free(src); return extractDir; }

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

// ── Virtual host setup (avoids file:// CORS restrictions) ─────────────────────
// Returns "https://installer.local/index.html" on success,
// or a plain file:// URL as fallback.
static std::string SetupInstallerUrl(webview::webview& wv, const std::string& root) {
    auto ctrl_res = wv.browser_controller();
    if (ctrl_res.ok()) {
        auto* ctrl = static_cast<ICoreWebView2Controller*>(ctrl_res.value());
        ICoreWebView2* wv2 = nullptr;
        if (SUCCEEDED(ctrl->get_CoreWebView2(&wv2)) && wv2) {
            ICoreWebView2_3* wv2_3 = nullptr;
            if (SUCCEEDED(wv2->QueryInterface(IID_PPV_ARGS(&wv2_3))) && wv2_3) {
                std::wstring wroot(root.begin(), root.end());
                wv2_3->SetVirtualHostNameToFolderMapping(
                    L"installer.local", wroot.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                wv2_3->Release();
                wv2->Release();
                return "https://installer.local/index.html";
            }
            wv2->Release();
        }
    }
    // Fallback: file:// with normalised forward slashes
    std::string url = "file:///";
    for (char c : root) url += (c == '\\') ? '/' : c;
    if (url.back() != '/') url += '/';
    return url + "index.html";
}

// ── Window helpers ─────────────────────────────────────────────────────────────
static void MakeInstallerFrameless(HWND hwnd) {
    // Hide during style changes to avoid the flash of a window with OS decorations
    ShowWindow(hwnd, SW_HIDE);
    SetWindowLongPtrW(hwnd, GWL_STYLE,
                      WS_POPUP | WS_VISIBLE | WS_SYSMENU | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
    MARGINS m = {1, 1, 1, 1};
    DwmExtendFrameIntoClientArea(hwnd, &m);
    // Re-show after styling applied — no more flash
    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);
}
static void CenterWindow(HWND hwnd, int w, int h) {
    int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
    SetWindowPos(hwnd, nullptr, (sw - w) / 2, (sh - h) / 2, w, h,
                 SWP_NOZORDER | SWP_NOACTIVATE);
}

#else // non-Windows stubs
static std::string ExtractInstallerAssets()                             { return ""; }
static std::string SetupInstallerUrl(webview::webview&, const std::string&) { return "about:blank"; }
#endif // _WIN32

static constexpr const char* kWailsProxy = R"js(
window.go = window.go || new Proxy({}, {
  get: (_,k) => new Proxy(function(){}, {
    get: (_,k2) => new Proxy(function(){}, {
      get: (_,k3) => () => Promise.reject('Wails not available in C++ installer')
    })
  })
});
)js";

struct BindCtx { webview::webview* wv; InstallerApp* app; };

#ifdef _WIN32
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
#else
int main(int, char**) {
#endif
    std::string root = ExtractInstallerAssets();

    webview::webview wv(false, nullptr);
    wv.set_title("cmdIDE Installer");
    wv.set_size(460, 330, WEBVIEW_HINT_FIXED);

#ifdef _WIN32
    auto hwnd_res = wv.window();
    if (hwnd_res.ok()) {
        HWND hwnd = static_cast<HWND>(hwnd_res.value());
        MakeInstallerFrameless(hwnd);
        CenterWindow(hwnd, 460, 330);
        // Set the taskbar / Alt+Tab icon
        HICON hIcon = LoadIconW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(100));
        if (hIcon) {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG,   reinterpret_cast<LPARAM>(hIcon));
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(hIcon));
        }
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

#ifdef _WIN32
    // Use virtual host mapping to avoid file:// CORS restrictions
    std::string url = SetupInstallerUrl(wv, root);
#else
    std::string url = root.empty() ? "about:blank" : "file://" + root + "/index.html";
#endif

    wv.navigate(url);
    wv.run();
    return 0;
}
