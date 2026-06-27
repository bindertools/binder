// Native backend for the Database app. Thin C-ABI wrapper around
// database_ops::dispatch (cpp/src/database.cpp, extracted out of
// Dispatcher::dispatch_worker -- it wasn't even its own module before this)
// -- LoadLibrary'd by the host only when this app is installed (see
// cpp/host/app_plugin_loader.cpp).
#include "../../src/app_plugin_abi.h"
#include "../../src/database.hpp"

#include <nlohmann/json.hpp>
#include <cstdlib>
#include <cstring>

using json = nlohmann::json;

extern "C" {

BINDER_APP_EXPORT void binder_app_init(const BinderHostApi*) {}

BINDER_APP_EXPORT char* binder_app_alloc(size_t n) {
    return static_cast<char*>(std::malloc(n));
}

BINDER_APP_EXPORT void binder_app_free(char* p) {
    std::free(p);
}

BINDER_APP_EXPORT int binder_app_dispatch(const char* type, const char* args_json_utf8,
                                          const char* req_id, char** out_json) {
    *out_json = nullptr;
    json msg;
    try {
        msg = args_json_utf8 && *args_json_utf8 ? json::parse(args_json_utf8) : json::object();
    } catch (const json::parse_error&) {
        return 0;
    }

    json resp;
    if (!database_ops::dispatch(type, msg, req_id ? req_id : "", resp)) return 0;

    std::string s = resp.dump();
    char* buf = binder_app_alloc(s.size() + 1);
    if (buf) std::memcpy(buf, s.c_str(), s.size() + 1);
    *out_json = buf;
    return 1;
}

BINDER_APP_EXPORT void binder_app_shutdown(void) {}

} // extern "C"
