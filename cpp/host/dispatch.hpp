#pragma once
#include "../src/terminal.hpp"
#include <nlohmann/json.hpp>
#include <webview.h>

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <map>

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

    // Pass the splash screen pointer so app.ready can close it (Windows only).
#ifdef _WIN32
    void SetSplash(SplashScreen* splash) { splash_ = splash; }
#else
    void SetSplash(SplashScreen* /*splash*/) {}
#endif

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
#ifdef _WIN32
    SplashScreen*     splash_ = nullptr;
#endif

    // ── Terminal helpers ──────────────────────────────────────────────────────
    void emit_prompt(const std::string& id, const std::string& cwd, int exitCode);
    int run_command(const std::string& id,
                     const std::string& cmd,
                     const std::string& cwd);
    static std::string get_git_branch(const std::string& dir);
    static std::string format_cwd(const std::string& cwd, bool minimal);

    // ConPTY sessions (used for interactive programs in PTY mode)
    std::unordered_map<std::string, std::unique_ptr<Terminal>> terminals_;
    std::mutex terminals_mu_;

    // Command-execution sessions (default terminal mode)
    struct TerminalSession { std::string cwd; std::string alignment = "default"; };
    std::map<std::string, TerminalSession> term_sessions_;
    std::mutex sessions_mu_;
};
