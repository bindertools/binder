#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <atomic>
#include <functional>
#include <string>
#include <thread>

// ConPTY-backed terminal session.
// Thread-safe for concurrent Write/Resize/Interrupt/Stop calls.
// Output arrives on a private reader thread via the OutputCallback.
class Terminal {
public:
    // Called from the reader thread with base64-encoded PTY output.
    using OutputCallback = std::function<void(const std::string& id,
                                              const std::string& b64_data)>;
    // Called from the reader thread when the child process exits.
    using ExitCallback   = std::function<void(const std::string& id, int code)>;

    Terminal(std::string id, OutputCallback on_output, ExitCallback on_exit);
    ~Terminal();

    Terminal(const Terminal&)            = delete;
    Terminal& operator=(const Terminal&) = delete;

    // Spawns the shell under a ConPTY. Returns false on any Windows API failure.
    bool Start(const std::string& shell, const std::string& cwd, int cols, int rows);

    // Writes base64-encoded bytes to the PTY's stdin.
    bool Write(const std::string& b64_data);

    // Resizes the ConPTY viewport.
    bool Resize(int cols, int rows);

    // Sends Ctrl+C (0x03) to the PTY.
    void Interrupt();

    // Signals the child to exit, waits up to ~5 s, then force-kills and joins.
    void Stop();

    bool              IsRunning() const { return running_.load(); }
    const std::string& Id()       const { return id_; }

private:
    void ReadLoop();

    std::string    id_;
    OutputCallback on_output_;
    ExitCallback   on_exit_;

    HPCON  hpc_          = nullptr;
    HANDLE pty_in_write_ = INVALID_HANDLE_VALUE; // we write keyboard input here
    HANDLE pty_out_read_ = INVALID_HANDLE_VALUE; // we read terminal output here
    HANDLE process_      = INVALID_HANDLE_VALUE;

    std::thread       reader_;
    std::atomic<bool> running_{false};
};
