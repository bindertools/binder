#include "installer.hpp"
#include <webview.h>
#include <nlohmann/json.hpp>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <thread>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <dwmapi.h>
#endif

static std::string GetFrontendUrl() {
#ifdef _WIN32
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    std::filesystem::path dir = std::filesystem::path(path).parent_path();
    std::string idx = dir.string() + "\\www\\index.html";
    return "file:///" + idx;
#else
    return "file:///tmp/cmdide-installer/www/index.html";
#endif
}

static constexpr const char* kWailsProxy = R"js(
window.go = window.go || new Proxy({}, {
  get: (_,k) => new Proxy(function(){}, {
    get: (_,k2) => new Proxy(function(){}, {
      get: (_,k3) => () => Promise.reject('Wails not available in C++ installer')
    })
  })
});
)js";

struct BindCtx {
    webview::webview* wv;
    InstallerApp*     app;
};

#ifdef _WIN32
static void MakeInstallerFrameless(HWND hwnd) {
    SetWindowLongPtrW(hwnd, GWL_STYLE,
                      WS_POPUP | WS_VISIBLE | WS_SYSMENU | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
    MARGINS m = {1, 1, 1, 1};
    DwmExtendFrameIntoClientArea(hwnd, &m);
}
static void CenterWindow(HWND hwnd, int w, int h) {
    int sw = GetSystemMetrics(SM_CXSCREEN);
    int sh = GetSystemMetrics(SM_CYSCREEN);
    SetWindowPos(hwnd, nullptr, (sw - w) / 2, (sh - h) / 2, w, h,
                 SWP_NOZORDER | SWP_NOACTIVATE);
}
#endif

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    webview::webview wv(false, nullptr);
    wv.set_title("cmdIDE Installer");
    wv.set_size(460, 330, WEBVIEW_HINT_FIXED);

#ifdef _WIN32
    auto hwnd_res = wv.window();
    if (hwnd_res.ok()) {
        HWND hwnd = static_cast<HWND>(hwnd_res.value());
        MakeInstallerFrameless(hwnd);
        CenterWindow(hwnd, 460, 330);
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
                auto args_str = arr[1].get<std::string>();
                auto args = nlohmann::json::parse(args_str.empty() ? "{}" : args_str);

                std::thread([ctx, seq, type, args]() {
                    auto* wv  = ctx->wv;
                    auto* app = ctx->app;
                    if (type == "installer.getReleases") {
                        app->GetReleases(seq);
                    } else if (type == "installer.getChannel") {
                        app->GetChannel(seq);
                    } else if (type == "installer.getInstallDir") {
                        app->GetInstallDir(seq);
                    } else if (type == "installer.install") {
                        app->Install(seq,
                            args.value("version", std::string{}),
                            args.value("createDesktop", false),
                            args.value("installPlugins", false));
                    } else if (type == "installer.launch") {
                        app->LaunchAndClose(seq);
                    } else if (type == "installer.close") {
                        app->CloseInstaller(seq);
                    } else {
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
    wv.navigate(GetFrontendUrl());
    wv.run();
    return 0;
}
