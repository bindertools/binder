#pragma once
#include <atomic>
#include <chrono>
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

    // When set, a second Ctrl+C (raw 0x03) arriving within 1.5s of the first
    // force-terminates the session. Raw-mode TUIs (claude, codex) implement
    // their own "press again to exit" prompt but never actually get to see a
    // real CTRL_C_EVENT through a ConPTY, so without this they get stuck.
    // Left off for tools like vim/less where a quick second Ctrl+C is a
    // normal, non-exiting keystroke and killing the session would be wrong.
    void ForceKillOnDoubleCtrlC(bool enable) { force_kill_on_double_ctrlc_ = enable; }

private:
    void ReadLoop();

    std::string    id_;
    OutputCallback on_output_;
    ExitCallback   on_exit_;

    bool force_kill_on_double_ctrlc_ = false;
    std::chrono::steady_clock::time_point last_ctrlc_;

#ifdef _WIN32
    HPCON  hpc_          = nullptr;
    HANDLE pty_in_write_ = INVALID_HANDLE_VALUE;
    HANDLE pty_out_read_ = INVALID_HANDLE_VALUE;
    HANDLE process_      = INVALID_HANDLE_VALUE;
    // Holds the whole process tree (e.g. cmd.exe + the claude.exe it launches)
    // so a force-kill can take all of it down at once — TerminateProcess on
    // process_ alone only kills the immediate child, leaving any descendant
    // still attached to the pseudo console, which then never signals EOF.
    HANDLE job_          = nullptr;
#else
    int    master_fd_ = -1;
    int    pid_       = -1;
#endif

    std::thread       reader_;
    std::atomic<bool> running_{false};
};
