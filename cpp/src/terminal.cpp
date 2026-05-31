#include "terminal.hpp"
#include "base64.hpp"
#include <spdlog/spdlog.h>
#include <cstdlib>
#include <vector>

Terminal::Terminal(std::string id, OutputCallback on_output, ExitCallback on_exit)
    : id_(std::move(id)),
      on_output_(std::move(on_output)),
      on_exit_(std::move(on_exit)) {}

Terminal::~Terminal() {
    Stop();
}

// ─────────────────────────────────────────────────────────────────────────────
#ifdef _WIN32
// ── Windows ConPTY implementation ─────────────────────────────────────────────

#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE 0x00020016
#endif

namespace {
std::wstring to_wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()),
                                nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()),
                        w.data(), n);
    return w;
}
} // namespace

bool Terminal::Start(const std::string& shell, const std::string& cwd,
                     int cols, int rows) {
    if (running_.load()) return false;

    std::string shell_path = shell;
    if (shell_path.empty()) {
        const char* comspec = std::getenv("COMSPEC");
        shell_path = comspec ? comspec : R"(C:\Windows\System32\cmd.exe)";
    }

    HANDLE pty_in_read   = INVALID_HANDLE_VALUE;
    HANDLE pty_out_write = INVALID_HANDLE_VALUE;

    if (!CreatePipe(&pty_in_read, &pty_in_write_, nullptr, 0)) {
        spdlog::error("[{}] CreatePipe(pty_in) failed: {}", id_, GetLastError());
        return false;
    }
    if (!CreatePipe(&pty_out_read_, &pty_out_write, nullptr, 0)) {
        spdlog::error("[{}] CreatePipe(pty_out) failed: {}", id_, GetLastError());
        CloseHandle(pty_in_read);
        CloseHandle(pty_in_write_);
        pty_in_write_ = INVALID_HANDLE_VALUE;
        return false;
    }

    COORD size{static_cast<SHORT>(cols), static_cast<SHORT>(rows)};
    HRESULT hr = CreatePseudoConsole(size, pty_in_read, pty_out_write, 0, &hpc_);
    CloseHandle(pty_in_read);
    CloseHandle(pty_out_write);

    if (FAILED(hr)) {
        spdlog::error("[{}] CreatePseudoConsole failed: {:08x}", id_,
                      static_cast<uint32_t>(hr));
        CloseHandle(pty_in_write_);  pty_in_write_ = INVALID_HANDLE_VALUE;
        CloseHandle(pty_out_read_);  pty_out_read_ = INVALID_HANDLE_VALUE;
        return false;
    }

    SIZE_T attr_size = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attr_size);
    std::vector<uint8_t> attr_buf(attr_size);
    auto* attr_list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attr_buf.data());

    if (!InitializeProcThreadAttributeList(attr_list, 1, 0, &attr_size) ||
        !UpdateProcThreadAttribute(attr_list, 0,
                                   PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                                   hpc_, sizeof(hpc_), nullptr, nullptr)) {
        spdlog::error("[{}] Attribute list setup failed: {}", id_, GetLastError());
        DeleteProcThreadAttributeList(attr_list);
        ClosePseudoConsole(hpc_);    hpc_ = nullptr;
        CloseHandle(pty_in_write_);  pty_in_write_ = INVALID_HANDLE_VALUE;
        CloseHandle(pty_out_read_);  pty_out_read_ = INVALID_HANDLE_VALUE;
        return false;
    }

    std::wstring shell_w = to_wide(shell_path);
    std::wstring cwd_w   = cwd.empty() ? std::wstring{} : to_wide(cwd);

    STARTUPINFOEXW siex{};
    siex.StartupInfo.cb  = sizeof(STARTUPINFOEXW);
    siex.lpAttributeList = attr_list;

    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(
        nullptr, shell_w.data(), nullptr, nullptr, FALSE,
        EXTENDED_STARTUPINFO_PRESENT, nullptr,
        cwd_w.empty() ? nullptr : cwd_w.data(),
        &siex.StartupInfo, &pi);

    DeleteProcThreadAttributeList(attr_list);

    if (!ok) {
        spdlog::error("[{}] CreateProcessW('{}') failed: {}", id_, shell_path, GetLastError());
        ClosePseudoConsole(hpc_);    hpc_ = nullptr;
        CloseHandle(pty_in_write_);  pty_in_write_ = INVALID_HANDLE_VALUE;
        CloseHandle(pty_out_read_);  pty_out_read_ = INVALID_HANDLE_VALUE;
        return false;
    }

    process_ = pi.hProcess;
    CloseHandle(pi.hThread);

    running_.store(true);
    reader_ = std::thread(&Terminal::ReadLoop, this);
    spdlog::info("[{}] Started shell: {}", id_, shell_path);
    return true;
}

bool Terminal::Write(const std::string& b64_data) {
    if (!running_.load() || pty_in_write_ == INVALID_HANDLE_VALUE) return false;
    std::string raw = base64::decode(b64_data);
    if (raw.empty()) return true;
    DWORD written = 0;
    return WriteFile(pty_in_write_, raw.data(),
                     static_cast<DWORD>(raw.size()), &written, nullptr) != FALSE;
}

bool Terminal::Resize(int cols, int rows) {
    if (!running_.load() || !hpc_) return false;
    COORD size{static_cast<SHORT>(cols), static_cast<SHORT>(rows)};
    return SUCCEEDED(ResizePseudoConsole(hpc_, size));
}

void Terminal::Interrupt() {
    if (!running_.load() || pty_in_write_ == INVALID_HANDLE_VALUE) return;
    char ctrl_c = '\x03';
    DWORD written = 0;
    WriteFile(pty_in_write_, &ctrl_c, 1, &written, nullptr);
}

void Terminal::Stop() {
    running_.store(false);
    if (hpc_) { ClosePseudoConsole(hpc_); hpc_ = nullptr; }
    if (process_ != INVALID_HANDLE_VALUE) {
        if (WaitForSingleObject(process_, 3000) == WAIT_TIMEOUT) {
            TerminateProcess(process_, 1);
            WaitForSingleObject(process_, 2000);
        }
    }
    if (reader_.joinable()) reader_.join();
    if (process_ != INVALID_HANDLE_VALUE) {
        CloseHandle(process_);       process_      = INVALID_HANDLE_VALUE;
    }
    if (pty_in_write_ != INVALID_HANDLE_VALUE) {
        CloseHandle(pty_in_write_);  pty_in_write_ = INVALID_HANDLE_VALUE;
    }
    if (pty_out_read_ != INVALID_HANDLE_VALUE) {
        CloseHandle(pty_out_read_);  pty_out_read_ = INVALID_HANDLE_VALUE;
    }
}

void Terminal::ReadLoop() {
    const DWORD kBufSize = 4096;
    std::vector<char> buf(kBufSize);
    for (;;) {
        DWORD n = 0;
        if (!ReadFile(pty_out_read_, buf.data(), kBufSize, &n, nullptr) || n == 0) break;
        on_output_(id_, base64::encode(buf.data(), n));
    }
    if (running_.exchange(false)) {
        spdlog::info("[{}] Process exited", id_);
        on_exit_(id_, 0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
#else
// ── Unix forkpty implementation ───────────────────────────────────────────────

#ifdef __APPLE__
#include <util.h>   // forkpty on macOS
#else
#include <pty.h>    // forkpty on Linux
#endif
#include <unistd.h>
#include <signal.h>     // kill(), SIGTERM
#include <sys/wait.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <errno.h>
#include <fstream>
#include <sstream>

// Build the initial PATH for child processes on macOS (GUI apps don't inherit shell PATH).
static std::string BuildPath() {
    std::string path;
#ifdef __APPLE__
    // Read /etc/paths and /etc/paths.d/*
    auto append = [&](const std::string& p) {
        if (!path.empty()) path += ':';
        path += p;
    };
    auto read_file = [](const std::string& f) {
        std::vector<std::string> lines;
        std::ifstream in(f);
        std::string l;
        while (std::getline(in, l)) {
            if (!l.empty() && l[0] != '#') lines.push_back(l);
        }
        return lines;
    };
    for (auto& l : read_file("/etc/paths")) append(l);
    // /etc/paths.d/*
    {
        std::string cmd = "ls /etc/paths.d/ 2>/dev/null";
        FILE* f = popen(cmd.c_str(), "r");
        if (f) {
            char buf[256];
            while (fgets(buf, sizeof(buf), f)) {
                std::string name(buf);
                while (!name.empty() && (name.back() == '\n' || name.back() == '\r'))
                    name.pop_back();
                for (auto& l : read_file("/etc/paths.d/" + name)) append(l);
            }
            pclose(f);
        }
    }
    // Common tool locations
    for (auto& p : {"/opt/homebrew/bin", "/usr/local/bin",
                    "/usr/bin", "/bin", "/usr/sbin", "/sbin"}) {
        if (path.find(p) == std::string::npos) append(p);
    }
    // Merge with current PATH
    if (const char* cur = getenv("PATH")) {
        std::stringstream ss(cur);
        std::string seg;
        while (std::getline(ss, seg, ':')) {
            if (!seg.empty() && path.find(seg) == std::string::npos) append(seg);
        }
    }
#else
    // Linux: inherit PATH from process environment
    const char* p = getenv("PATH");
    path = p ? p : "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin";
#endif
    return path;
}

bool Terminal::Start(const std::string& shell, const std::string& cwd,
                     int cols, int rows) {
    if (running_.load()) return false;

    std::string shell_path = shell;
    if (shell_path.empty()) {
        const char* s = getenv("SHELL");
        shell_path = s ? s : "/bin/bash";
    }

    struct winsize ws{};
    ws.ws_col = static_cast<unsigned short>(cols);
    ws.ws_row = static_cast<unsigned short>(rows);

    pid_t pid = forkpty(&master_fd_, nullptr, nullptr, &ws);
    if (pid < 0) {
        spdlog::error("[{}] forkpty failed: {}", id_, errno);
        return false;
    }

    if (pid == 0) {
        // Child process
        if (!cwd.empty()) chdir(cwd.c_str());

        // Set PATH for macOS GUI apps
        std::string new_path = BuildPath();
        if (!new_path.empty()) setenv("PATH", new_path.c_str(), 1);

        // Set TERM if not already set
        if (!getenv("TERM")) setenv("TERM", "xterm-256color", 1);

        const char* args[] = {shell_path.c_str(), nullptr};
        execvp(shell_path.c_str(), const_cast<char* const*>(args));
        // execvp only returns on error
        _exit(1);
    }

    // Parent
    pid_ = pid;
    running_.store(true);
    reader_ = std::thread(&Terminal::ReadLoop, this);
    spdlog::info("[{}] Started shell: {} (pid={})", id_, shell_path, pid);
    return true;
}

bool Terminal::Write(const std::string& b64_data) {
    if (!running_.load() || master_fd_ < 0) return false;
    std::string raw = base64::decode(b64_data);
    if (raw.empty()) return true;
    ssize_t n = write(master_fd_, raw.data(), raw.size());
    return n >= 0;
}

bool Terminal::Resize(int cols, int rows) {
    if (!running_.load() || master_fd_ < 0) return false;
    struct winsize ws{};
    ws.ws_col = static_cast<unsigned short>(cols);
    ws.ws_row = static_cast<unsigned short>(rows);
    return ioctl(master_fd_, TIOCSWINSZ, &ws) == 0;
}

void Terminal::Interrupt() {
    if (!running_.load() || master_fd_ < 0) return;
    char ctrl_c = '\x03';
    (void)write(master_fd_, &ctrl_c, 1);
}

void Terminal::Stop() {
    running_.store(false);
    if (pid_ > 0) {
        kill(pid_, SIGTERM);
        int status;
        waitpid(pid_, &status, 0);
        pid_ = -1;
    }
    if (master_fd_ >= 0) {
        close(master_fd_);
        master_fd_ = -1;
    }
    if (reader_.joinable()) reader_.join();
}

void Terminal::ReadLoop() {
    const int kBufSize = 4096;
    std::vector<char> buf(kBufSize);
    for (;;) {
        ssize_t n = read(master_fd_, buf.data(), kBufSize);
        if (n <= 0) break;
        on_output_(id_, base64::encode(buf.data(), static_cast<size_t>(n)));
    }
    if (running_.exchange(false)) {
        spdlog::info("[{}] Process exited", id_);
        on_exit_(id_, 0);
    }
}

#endif // _WIN32
