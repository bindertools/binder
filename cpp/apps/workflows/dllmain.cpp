// Native backend for the Workflows app. Wraps workflows_ops::dispatch
// (list/read/checkRunner) plus workflow_runner::run_workflow/stop_workflow
// (run/stop), which the host used to call directly from Dispatcher so it
// could capture `this->emit` -- here the runner's streamed output/step/done
// events go through host_api->emit_event instead. LoadLibrary'd by the host
// only when this app is installed (see cpp/host/app_plugin_loader.cpp).
#include "../../src/app_plugin_abi.h"
#include "../../src/workflows.hpp"
#include "../../src/workflow_runner.hpp"

#include <nlohmann/json.hpp>
#include <cstdlib>
#include <cstring>

using json = nlohmann::json;

namespace {
const BinderHostApi* g_host = nullptr;

void emit_to_host(const std::string& event, const json& data) {
    if (!g_host) return;
    json envelope = {{"event", event}, {"data", data}};
    std::string s = envelope.dump();
    g_host->emit_event(s.c_str());
}
} // namespace

extern "C" {

BINDER_APP_EXPORT void binder_app_init(const BinderHostApi* host_api) {
    g_host = host_api;
}

BINDER_APP_EXPORT char* binder_app_alloc(size_t n) {
    return static_cast<char*>(std::malloc(n));
}

BINDER_APP_EXPORT void binder_app_free(char* p) {
    std::free(p);
}

BINDER_APP_EXPORT int binder_app_dispatch(const char* type, const char* args_json_utf8,
                                          const char* req_id, char** out_json) {
    *out_json = nullptr;
    json args;
    try {
        args = args_json_utf8 && *args_json_utf8 ? json::parse(args_json_utf8) : json::object();
    } catch (const json::parse_error&) {
        return 0;
    }

    std::string type_s(type);

    // These two are handled directly (matching the old Dispatcher-method
    // special case) since run_workflow needs an emit callback, not a JSON
    // reply -- everything else goes through the regular dispatch() convention.
    if (type_s == "workflows.run") {
        std::string path  = args.value("path",  std::string{});
        std::string file  = args.value("file",  std::string{});
        std::string runId = args.value("runId", std::string{});
        workflow_runner::run_workflow(path, file, runId, emit_to_host);
        *out_json = binder_app_alloc(3);
        if (*out_json) std::memcpy(*out_json, "{}", 3);
        return 1;
    }
    if (type_s == "workflows.stop") {
        workflow_runner::stop_workflow(args.value("runId", std::string{}));
        *out_json = binder_app_alloc(3);
        if (*out_json) std::memcpy(*out_json, "{}", 3);
        return 1;
    }

    json resp;
    if (!workflows_ops::dispatch(type_s, args, req_id ? req_id : "", resp)) return 0;

    std::string s = resp.dump();
    char* buf = binder_app_alloc(s.size() + 1);
    if (buf) std::memcpy(buf, s.c_str(), s.size() + 1);
    *out_json = buf;
    return 1;
}

BINDER_APP_EXPORT void binder_app_shutdown(void) {
    g_host = nullptr;
}

} // extern "C"
