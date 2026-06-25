#include "app_plugin_loader.hpp"
#include "dispatch.hpp"
#include "../src/app_plugin_abi.h"
#include "../src/config.hpp"

#include <spdlog/spdlog.h>
#include <cstring>
#include <filesystem>
#include <map>
#include <mutex>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace app_plugin_loader {

namespace {

#ifdef _WIN32
struct LoadedApp {
    HMODULE             handle = nullptr;
    BinderAppDispatchFn dispatch_fn = nullptr;
    BinderAppFreeFn     free_fn = nullptr;
    BinderAppShutdownFn shutdown_fn = nullptr;
};
#else
struct LoadedApp {};
#endif

std::map<std::string, LoadedApp> g_loaded;
std::mutex                       g_mu;
Dispatcher*                      g_dispatcher = nullptr;

// ── host_api callbacks, exposed to plugin DLLs ────────────────────────────────

char* host_alloc_impl(size_t n) {
    return static_cast<char*>(std::malloc(n));
}

void host_free_impl(char* p) {
    std::free(p);
}

char* config_get_impl(const char* key) {
    json value = Config::instance().get().value(key, json(nullptr));
    std::string s = value.dump();
    char* buf = host_alloc_impl(s.size() + 1);
    if (buf) std::memcpy(buf, s.c_str(), s.size() + 1);
    return buf;
}

void config_set_impl(const char* key, const char* json_value_utf8) {
    try {
        Config::instance().set(key, json::parse(json_value_utf8));
    } catch (const json::parse_error& e) {
        spdlog::warn("app_plugin_loader: config_set parse error: {}", e.what());
    }
}

void emit_event_impl(const char* event_json_utf8) {
    if (!g_dispatcher) return;
    try {
        json parsed = json::parse(event_json_utf8);
        g_dispatcher->emit(parsed.value("event", std::string{}), parsed.value("data", json(nullptr)));
    } catch (const json::parse_error& e) {
        spdlog::warn("app_plugin_loader: emit_event parse error: {}", e.what());
    }
}

const BinderHostApi g_host_api = {
    emit_event_impl,
    config_get_impl,
    config_set_impl,
    host_alloc_impl,
    host_free_impl,
};

#ifdef _WIN32
std::wstring to_wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

fs::path exe_dir() {
    wchar_t buf[MAX_PATH] = {};
    GetModuleFileNameW(nullptr, buf, MAX_PATH);
    return fs::path(buf).parent_path();
}
#endif

} // namespace

void init(Dispatcher* dispatcher) {
    g_dispatcher = dispatcher;
}

bool load_app(const std::string& id) {
#ifdef _WIN32
    std::lock_guard<std::mutex> lk(g_mu);
    if (g_loaded.count(id)) return true; // already loaded

    fs::path dll_path = exe_dir() / "apps" / id / (id + ".dll");
    if (!fs::exists(dll_path)) {
        spdlog::warn("app_plugin_loader: no backend DLL for app '{}' at {}", id, dll_path.string());
        return false;
    }

    HMODULE h = LoadLibraryW(to_wide(dll_path.string()).c_str());
    if (!h) {
        spdlog::error("app_plugin_loader: LoadLibrary failed for app '{}' (err {})", id, GetLastError());
        return false;
    }

    auto init_fn     = reinterpret_cast<BinderAppInitFn>(GetProcAddress(h, "binder_app_init"));
    auto dispatch_fn = reinterpret_cast<BinderAppDispatchFn>(GetProcAddress(h, "binder_app_dispatch"));
    auto free_fn     = reinterpret_cast<BinderAppFreeFn>(GetProcAddress(h, "binder_app_free"));
    auto shutdown_fn = reinterpret_cast<BinderAppShutdownFn>(GetProcAddress(h, "binder_app_shutdown"));

    if (!init_fn || !dispatch_fn || !free_fn || !shutdown_fn) {
        spdlog::error("app_plugin_loader: app '{}' DLL missing required exports", id);
        FreeLibrary(h);
        return false;
    }

    init_fn(&g_host_api);

    LoadedApp app;
    app.handle      = h;
    app.dispatch_fn = dispatch_fn;
    app.free_fn     = free_fn;
    app.shutdown_fn = shutdown_fn;
    g_loaded[id] = app;
    spdlog::info("app_plugin_loader: loaded backend for app '{}'", id);
    return true;
#else
    (void)id;
    return false; // native app backends are Windows-only for now
#endif
}

void unload_app(const std::string& id) {
#ifdef _WIN32
    std::lock_guard<std::mutex> lk(g_mu);
    auto it = g_loaded.find(id);
    if (it == g_loaded.end()) return;
    it->second.shutdown_fn();
    FreeLibrary(it->second.handle);
    g_loaded.erase(it);
    spdlog::info("app_plugin_loader: unloaded backend for app '{}'", id);
#else
    (void)id;
#endif
}

void load_installed_apps() {
    json installed = Config::instance().get().value("installed_apps", json::array());
    for (auto& idVal : installed) {
        if (idVal.is_string()) load_app(idVal.get<std::string>());
    }
}

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
#ifdef _WIN32
    std::lock_guard<std::mutex> lk(g_mu);
    std::string args = msg.dump();
    for (auto& [appId, app] : g_loaded) {
        char* out = nullptr;
        int handled = app.dispatch_fn(type.c_str(), args.c_str(), &out);
        if (handled) {
            if (out) {
                try { resp = json::parse(out); } catch (...) { resp = json::object(); }
                app.free_fn(out);
            } else {
                resp = json::object();
            }
            (void)id;
            return true;
        }
        if (out) app.free_fn(out);
    }
    return false;
#else
    (void)type; (void)msg; (void)id; (void)resp;
    return false;
#endif
}

void unload_all() {
#ifdef _WIN32
    std::lock_guard<std::mutex> lk(g_mu);
    for (auto& [appId, app] : g_loaded) {
        app.shutdown_fn();
        FreeLibrary(app.handle);
    }
    g_loaded.clear();
#endif
}

} // namespace app_plugin_loader
