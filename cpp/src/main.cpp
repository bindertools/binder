#include "ipc.hpp"
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <spdlog/sinks/basic_file_sink.h>
#include <iostream>
#include <string>

using json = nlohmann::json;

int main(int argc, char* argv[]) {
    char tmp_dir[MAX_PATH];
    GetTempPathA(MAX_PATH, tmp_dir);
    std::string log_path = std::string(tmp_dir) + "cmdide-backend.log";

    try {
        auto logger = spdlog::basic_logger_mt("cmdide", log_path, true);
        spdlog::set_default_logger(logger);
        spdlog::set_level(spdlog::level::debug);
        spdlog::flush_on(spdlog::level::info);
    } catch (const spdlog::spdlog_ex& ex) {
        std::cerr << "Log init failed: " << ex.what() << "\n";
    }

    if (argc < 2) {
        spdlog::error("Usage: cmdide-backend <pipe-path>");
        return 1;
    }

    const std::string pipe_path = argv[1];
    spdlog::info("Starting, connecting to pipe: {}", pipe_path);

    IpcPipe ipc;
    // Retry connecting in case the Go server isn't ready yet.
    bool connected = false;
    for (int attempt = 0; attempt < 20; ++attempt) {
        if (ipc.connect(pipe_path)) {
            connected = true;
            break;
        }
        Sleep(50);
    }
    if (!connected) {
        spdlog::error("Failed to connect to named pipe after all retries");
        return 1;
    }
    spdlog::info("Connected to named pipe");

    std::string line;
    while (ipc.read_line(line)) {
        if (line.empty()) continue;
        try {
            auto msg = json::parse(line);
            const auto type = msg.value("type", std::string{});

            if (type == "ping") {
                json pong;
                pong["type"] = "pong";
                if (msg.contains("id")) pong["id"] = msg["id"];
                if (!ipc.write_line(pong.dump())) {
                    spdlog::error("Failed to write pong");
                    break;
                }
                spdlog::debug("ping->pong id={}", msg.value("id", ""));
            } else if (type == "shutdown") {
                spdlog::info("Received shutdown, exiting");
                break;
            } else {
                spdlog::debug("Unknown message type: {}", type);
            }
        } catch (const json::parse_error& e) {
            spdlog::error("JSON parse error: {}", e.what());
        }
    }

    spdlog::info("Exiting cleanly");
    return 0;
}
