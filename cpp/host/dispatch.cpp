#include "dispatch.hpp"
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

using json = nlohmann::json;

Dispatcher::Dispatcher(webview::webview& wv) : wv_(wv) {}

void Dispatcher::dispatch(const std::string& seq,
                          const std::string& type,
                          const std::string& args) {
    spdlog::info("IPC dispatch: type={} args={}", type, args);

    json result;
    if (type == "ping") {
        result = {{"ok", true}, {"data", "pong"}};
    } else {
        result = {{"ok", false}, {"error", "not yet implemented: " + type}};
    }

    // wv_.resolve is thread-safe in webview/webview — can call from any thread.
    wv_.resolve(seq, 0, result.dump());
}

void Dispatcher::emit(const std::string& event, const json& data) {
    std::string js = "if(window.__cmdide_emit){window.__cmdide_emit('" +
                     event + "'," + data.dump() + ")}";
    wv_.dispatch([this, js] { wv_.eval(js); });
}
