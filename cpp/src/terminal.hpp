#pragma once
#include <atomic>
#include <functional>
#include <string>
#include <thread>

#ifdef _WIN32
// Windows-specific types in the class — only pull in windows.h on Windows
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

// Platform-neutral terminal session.
// Windows: ConPTY (ConPseudoConsole). macOS/Linux: forkpty.
// Thread-safe for concurrent Write/Resize/Interrupt/Stop calls.
class Terminal {
public:
    using OutputCallback = std::function<void(const std::string& id,
                                              const std::string& b64_data)>;
    using ExitCallback   = std::function<void(const std::string& id, int code)>;

    Terminal(std::string id, OutputCallback on_output, ExitCallback on_exit);
    ~Terminal();

    Terminal(const Terminal&)            = delete;
    Terminal& operator=(const Terminal&) = delete;

    bool Start(const std::string& shell, const std::string& cwd, int cols, int rows);
    bool Write(const std::string& b64_data);
    bool Resize(int cols, int rows);
    void Interrupt();
    void Stop();

    bool              IsRunning() const { return running_.load(); }
    const std::string& Id()       const { return id_; }

private:
    void ReadLoop();

    std::string    id_;
    OutputCallback on_output_;
    ExitCallback   on_exit_;

#ifdef _WIN32
    HPCON  hpc_          = nullptr;
    HANDLE pty_in_write_ = INVALID_HANDLE_VALUE;
    HANDLE pty_out_read_ = INVALID_HANDLE_VALUE;
    HANDLE process_      = INVALID_HANDLE_VALUE;
#else
    int    master_fd_ = -1;
    int    pid_       = -1;
#endif

    std::thread       reader_;
    std::atomic<bool> running_{false};
};
