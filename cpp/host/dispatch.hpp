#pragma once
#include "../src/terminal.hpp"
#include <nlohmann/json.hpp>
#include <webview.h>

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

#ifdef _WIN32
#include "splash_windows.hpp"
#else
// Forward declaration for non-Windows
class SplashScreen;
#endif

// ── Dispatcher ────────────────────────────────────────────────────────────────
// Routes all __cmdide_invoke calls to backend modules.
// Terminal output events are pushed to the frontend via emit().
class Dispatcher {
public:
    explicit Dispatcher(webview::webview& wv);
    ~Dispatcher();

    // Pass the splash screen pointer so app.ready can close it.
    void SetSplash(SplashScreen* splash) { splash_ = splash; }

    // Called from the __cmdide_invoke bind callback (any thread).
    void dispatch(const std::string& seq,
                  const std::string& type,
                  const std::string& args);

    // Push a C++ → JS event (thread-safe).
    void emit(const std::string& event, const nlohmann::json& data);

private:
    // Actual dispatch logic, runs on a worker thread.
    void dispatch_worker(const std::string& seq,
                         const std::string& type,
                         const nlohmann::json& args);

    // Convert an old-style response JSON to new IPC envelope.
    nlohmann::json old_to_new(const std::string& type,
                              const nlohmann::json& args,
                              const std::string& req_id);

    // Resolve seq with success payload.
    void resolve_ok(const std::string& seq, const nlohmann::json& data);
    // Resolve seq with error.
    void resolve_err(const std::string& seq, const std::string& error);

    webview::webview& wv_;
    SplashScreen*     splash_ = nullptr;

    // Active terminal sessions
    std::unordered_map<std::string, std::unique_ptr<Terminal>> terminals_;
    std::mutex terminals_mu_;
};
