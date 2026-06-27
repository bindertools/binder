#pragma once
#include <nlohmann/json.hpp>
#include <string>

class Dispatcher;

// Loads/unloads app backend DLLs at runtime (LoadLibrary/FreeLibrary on
// Windows) based on config.json's installed_apps list, and dispatches IPC
// calls to them -- the native-code equivalent of the frontend's apps/loader.ts
// dynamic-import code splitting.
namespace app_plugin_loader {

// Must be called once before anything else here -- lets the host_api bridge
// (emit_event/config_get/config_set) reach the single live Dispatcher/Config
// instance without the plugin DLLs ever linking config.cpp or dispatch.cpp
// directly (each DLL has its own CRT/static-state instance; sharing those
// singletons by linking would silently create separate copies).
void init(Dispatcher* dispatcher);

// Loads every app in config.json's installed_apps whose DLL exists under
// <exe_dir>/apps/<id>/<id>.dll. Call once at startup, after Config::load().
void load_installed_apps();

// LoadLibrary's <exe_dir>/apps/<id>/<id>.dll and calls its binder_app_init.
// Returns false (and logs) if the DLL is missing or malformed.
bool load_app(const std::string& id);

// Calls the app's binder_app_shutdown and FreeLibrary's its DLL.
void unload_app(const std::string& id);

// Tries binder_app_dispatch on every currently-loaded app. Returns true if
// one of them handled `type` (fills resp), matching the *_ops::dispatch
// convention used by every static handler.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

// FreeLibrary's everything. Call once at host shutdown.
void unload_all();

} // namespace app_plugin_loader
