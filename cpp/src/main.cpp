#include "ipc.hpp"
#include "terminal.hpp"
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <spdlog/sinks/basic_file_sink.h>

#include <atomic>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

static constexpr const char* kVersion = "1.0.0";

// ─── Thread-safe IPC writer ───────────────────────────────────────────────────
// Terminal reader threads call ipc_write concurrently with the main read loop.
// The write mutex serialises all WriteFile calls through the pipe.

static IpcPipe*   g_ipc      = nullptr;
static std::mutex g_write_mu;

static bool ipc_write(const json& msg) {
    std::lock_guard<std::mutex> lk(g_write_mu);
    if (!g_ipc) return false;
    return g_ipc->write_line(msg.dump());
}

// ─── Entry point ─────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    // Log to %TEMP%\cmdide-backend.log
    {
        char tmp[MAX_PATH];
        GetTempPathA(MAX_PATH, tmp);
        std::string log_path = std::string(tmp) + "cmdide-backend.log";
        try {
            auto logger = spdlog::basic_logger_mt("cmdide", log_path, /*truncate=*/true);
            spdlog::set_default_logger(logger);
            spdlog::set_level(spdlog::level::debug);
            spdlog::flush_on(spdlog::level::info);
        } catch (const spdlog::spdlog_ex& ex) {
            std::cerr << "Log init failed: " << ex.what() << "\n";
        }
    }

    if (argc < 2) {
        spdlog::error("Usage: cmdide-backend <pipe-path>");
        return 1;
    }

    const std::string pipe_path = argv[1];
    spdlog::info("v{} starting; pipe={}", kVersion, pipe_path);

    IpcPipe ipc;
    bool connected = false;
    for (int i = 0; i < 20; ++i) {
        if (ipc.connect(pipe_path)) { connected = true; break; }
        Sleep(50);
    }
    if (!connected) {
        spdlog::error("Failed to connect to named pipe after 20 retries");
        return 1;
    }
    spdlog::info("Connected to named pipe");

    g_ipc = &ipc;

    // ─── Terminal registry ────────────────────────────────────────────────────
    std::unordered_map<std::string, std::unique_ptr<Terminal>> terminals;
    std::mutex terminals_mu;

    auto on_output = [&](const std::string& id, const std::string& b64) {
        ipc_write({{"type", "terminal.output"}, {"id", id}, {"data", b64}});
    };

    auto on_exit = [&](const std::string& id, int code) {
        spdlog::info("[{}] terminal.exit code={}", id, code);
        ipc_write({{"type", "terminal.exit"}, {"id", id}, {"code", code}});
        // Do NOT erase here — reader thread cannot join itself.
        // Go sends terminal.stop to clean up after receiving terminal.exit.
    };

    // ─── Message dispatch loop ────────────────────────────────────────────────
    std::string line;
    while (ipc.read_line(line)) {
        if (line.empty()) continue;
        try {
            auto msg       = json::parse(line);
            const auto type = msg.value("type", std::string{});
            const auto id   = msg.value("id",   std::string{});

            if (type == "ping") {
                ipc_write({{"type", "pong"}, {"id", id}});

            } else if (type == "shutdown") {
                spdlog::info("Received shutdown");
                break;

            } else if (type == "debug.version") {
                ipc_write({{"type", "debug.version.resp"},
                            {"id", id},
                            {"version", kVersion}});

            } else if (type == "terminal.start") {
                const auto shell = msg.value("shell", std::string{});
                const auto cwd   = msg.value("cwd",   std::string{});
                int cols = msg.value("cols", 80);
                int rows = msg.value("rows", 24);

                auto t  = std::make_unique<Terminal>(id, on_output, on_exit);
                bool ok = t->Start(shell, cwd, cols, rows);
                {
                    std::lock_guard<std::mutex> lk(terminals_mu);
                    if (ok) terminals[id] = std::move(t);
                }
                ipc_write({{"type", "terminal.start.resp"}, {"id", id}, {"ok", ok}});

            } else if (type == "terminal.input") {
                const auto data = msg.value("data", std::string{});
                std::lock_guard<std::mutex> lk(terminals_mu);
                auto it = terminals.find(id);
                if (it != terminals.end()) it->second->Write(data);

            } else if (type == "terminal.resize") {
                int cols = msg.value("cols", 80);
                int rows = msg.value("rows", 24);
                std::lock_guard<std::mutex> lk(terminals_mu);
                auto it = terminals.find(id);
                if (it != terminals.end()) it->second->Resize(cols, rows);

            } else if (type == "terminal.interrupt") {
                std::lock_guard<std::mutex> lk(terminals_mu);
                auto it = terminals.find(id);
                if (it != terminals.end()) it->second->Interrupt();

            } else if (type == "terminal.stop") {
                std::unique_ptr<Terminal> t;
                {
                    std::lock_guard<std::mutex> lk(terminals_mu);
                    auto it = terminals.find(id);
                    if (it != terminals.end()) {
                        t = std::move(it->second);
                        terminals.erase(it);
                    }
                }
                // Stop() blocks (joins reader thread) — call outside lock.
                if (t) t->Stop();

            } else {
                spdlog::debug("Unknown message type: {}", type);
            }

        } catch (const json::parse_error& e) {
            spdlog::error("JSON parse error: {}", e.what());
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────
    g_ipc = nullptr;

    // Move terminals out before stopping so on_exit's terminals.erase is a no-op.
    std::vector<std::unique_ptr<Terminal>> to_stop;
    {
        std::lock_guard<std::mutex> lk(terminals_mu);
        for (auto& kv : terminals) to_stop.push_back(std::move(kv.second));
        terminals.clear();
    }
    to_stop.clear(); // Stop() called in destructor, outside terminals_mu

    spdlog::info("Exiting cleanly");
    return 0;
}
