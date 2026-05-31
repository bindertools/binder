#include "installer.hpp"
#include <webview.h>
#include <nlohmann/json.hpp>
#include <cstdlib>
#include <string>
#include <thread>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <algorithm>
#include <windows.h>
#include <dwmapi.h>
#include <zip.h>
#include <filesystem>
#include <fstream>
namespace fs = std::filesystem;

// Extract the embedded FRONTEND_ZIP resource to a temp directory.
// Returns the extraction root path.
static std::string ExtractInstallerAssets() {
    HMODULE hMod = GetModuleHandleW(nullptr);
    HRSRC hRes = FindResourceW(hMod, L"FRONTEND_ZIP", RT_RCDATA);
    if (!hRes) {
        // Fallback to www/ sidecar (dev builds without RC embedding)
        wchar_t exe[MAX_PATH];
        GetModuleFileNameW(nullptr, exe, MAX_PATH);
        return fs::path(exe).parent_path().string() + "\\www";
    }

    HGLOBAL hData  = LoadResource(hMod, hRes);
    const char* data = static_cast<const char*>(LockResource(hData));
    DWORD       size = SizeofResource(hMod, hRes);

    uint32_t hash = 0x811c9dc5u;
    for (DWORD i = 0; i < std::min(size, (DWORD)64); ++i)
        hash = (hash ^ (unsigned char)data[i]) * 0x01000193u;

    char tmp[MAX_PATH];
    GetTempPathA(MAX_PATH, tmp);
    char hashStr[12];
    sprintf_s(hashStr, "%08x", hash);
    std::string extractDir = std::string(tmp) + "cmdide-inst-" + hashStr;
    std::string marker = extractDir + "\\.extracted";

    if (GetFileAttributesA(marker.c_str()) != INVALID_FILE_ATTRIBUTES)
        return extractDir;

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

static std::string GetInstallerUrl(const std::string& root) {
    return "file:///" + root + "/index.html";
}

static void MakeInstallerFrameless(HWND hwnd) {
    SetWindowLongPtrW(hwnd, GWL_STYLE,
                      WS_POPUP | WS_VISIBLE | WS_SYSMENU | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
    MARGINS m = {1, 1, 1, 1};
    DwmExtendFrameIntoClientArea(hwnd, &m);
}
static void CenterWindow(HWND hwnd, int w, int h) {
    int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
    SetWindowPos(hwnd, nullptr, (sw - w) / 2, (sh - h) / 2, w, h,
                 SWP_NOZORDER | SWP_NOACTIVATE);
}
#else
static std::string ExtractInstallerAssets() { return ""; }
static std::string GetInstallerUrl(const std::string&) { return "about:blank"; }
#endif

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
                    if      (type == "installer.getReleases")  app->GetReleases(seq);
                    else if (type == "installer.getChannel")   app->GetChannel(seq);
                    else if (type == "installer.getInstallDir") app->GetInstallDir(seq);
                    else if (type == "installer.install")
                        app->Install(seq, args.value("version", std::string{}),
                                     args.value("createDesktop", false),
                                     args.value("installPlugins", false));
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
    wv.navigate(GetInstallerUrl(root));
    wv.run();
    return 0;
}
