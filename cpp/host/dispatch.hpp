#pragma once
#include <nlohmann/json.hpp>
#include <webview.h>
#include <string>

// ── Dispatcher ────────────────────────────────────────────────────────────────
// Handles all IPC calls arriving from the frontend via __cmdide_invoke.
// In Phase H.3, this is a stub that responds to "ping" and returns
// "not yet implemented" for everything else.
// Full implementation arrives in Phase I.3.
class Dispatcher {
public:
    explicit Dispatcher(webview::webview& wv);

    // Called from the __cmdide_invoke bind callback (may be any thread).
    // seq   — webview's internal promise sequence ID (for wv_.resolve)
    // type  — IPC message type string (e.g. "ping", "terminal.start")
    // args  — JSON-encoded arguments string
    void dispatch(const std::string& seq,
                  const std::string& type,
                  const std::string& args);

    // Push an event to the frontend (C++ → JS).
    // Schedules wv_.eval on the main thread — safe to call from any thread.
    void emit(const std::string& event, const nlohmann::json& data);

private:
    webview::webview& wv_;
};
