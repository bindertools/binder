#include "terminal.hpp"
#include "base64.hpp"

#include <spdlog/spdlog.h>
#include <cstdlib>
#include <vector>

// PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE may not be defined on older SDKs.
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

Terminal::Terminal(std::string id, OutputCallback on_output, ExitCallback on_exit)
    : id_(std::move(id)),
      on_output_(std::move(on_output)),
      on_exit_(std::move(on_exit)) {}

Terminal::~Terminal() {
    Stop();
}

bool Terminal::Start(const std::string& shell, const std::string& cwd,
                     int cols, int rows) {
    if (running_.load()) return false;

    // Resolve shell: use caller's value, fall back to COMSPEC, then cmd.exe.
    std::string shell_path = shell;
    if (shell_path.empty()) {
        const char* comspec = std::getenv("COMSPEC"); // NOLINT(concurrency-mt-unsafe)
        shell_path = comspec ? comspec : R"(C:\Windows\System32\cmd.exe)";
    }

    // ─── Create anonymous pipe pairs ──────────────────────────────────────────
    // pty_in:  we write keyboard bytes here; ConPTY reads from the read end.
    // pty_out: ConPTY writes terminal output here; we read from the read end.
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

    // ─── Create the pseudo console ────────────────────────────────────────────
    COORD size{static_cast<SHORT>(cols), static_cast<SHORT>(rows)};
    HRESULT hr = CreatePseudoConsole(size, pty_in_read, pty_out_write, 0, &hpc_);
    // ConPTY now owns the pipe ends we handed to it — close our copies.
    CloseHandle(pty_in_read);
    CloseHandle(pty_out_write);

    if (FAILED(hr)) {
        spdlog::error("[{}] CreatePseudoConsole failed: {:08x}", id_,
                      static_cast<uint32_t>(hr));
        CloseHandle(pty_in_write_);  pty_in_write_ = INVALID_HANDLE_VALUE;
        CloseHandle(pty_out_read_);  pty_out_read_ = INVALID_HANDLE_VALUE;
        return false;
    }

    // ─── Build process attribute list ─────────────────────────────────────────
    SIZE_T attr_size = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attr_size);
    std::vector<uint8_t> attr_buf(attr_size);
    auto* attr_list =
        reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attr_buf.data());

    if (!InitializeProcThreadAttributeList(attr_list, 1, 0, &attr_size)) {
        spdlog::error("[{}] InitializeProcThreadAttributeList failed: {}",
                      id_, GetLastError());
        ClosePseudoConsole(hpc_);    hpc_ = nullptr;
        CloseHandle(pty_in_write_);  pty_in_write_ = INVALID_HANDLE_VALUE;
        CloseHandle(pty_out_read_);  pty_out_read_ = INVALID_HANDLE_VALUE;
        return false;
    }

    if (!UpdateProcThreadAttribute(attr_list, 0,
                                   PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                                   hpc_, sizeof(hpc_), nullptr, nullptr)) {
        spdlog::error("[{}] UpdateProcThreadAttribute failed: {}",
                      id_, GetLastError());
        DeleteProcThreadAttributeList(attr_list);
        ClosePseudoConsole(hpc_);    hpc_ = nullptr;
        CloseHandle(pty_in_write_);  pty_in_write_ = INVALID_HANDLE_VALUE;
        CloseHandle(pty_out_read_);  pty_out_read_ = INVALID_HANDLE_VALUE;
        return false;
    }

    // ─── Spawn the shell process ───────────────────────────────────────────────
    std::wstring shell_w = to_wide(shell_path);
    std::wstring cwd_w   = cwd.empty() ? std::wstring{} : to_wide(cwd);

    STARTUPINFOEXW siex{};
    siex.StartupInfo.cb = sizeof(STARTUPINFOEXW);
    siex.lpAttributeList = attr_list;

    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(
        nullptr,
        shell_w.data(),   // mutable command line
        nullptr, nullptr,
        FALSE,            // do not inherit handles
        EXTENDED_STARTUPINFO_PRESENT,
        nullptr,          // inherit parent's environment
        cwd_w.empty() ? nullptr : cwd_w.data(),
        &siex.StartupInfo,
        &pi);

    DeleteProcThreadAttributeList(attr_list);

    if (!ok) {
        spdlog::error("[{}] CreateProcessW('{}') failed: {}",
                      id_, shell_path, GetLastError());
        ClosePseudoConsole(hpc_);    hpc_ = nullptr;
        CloseHandle(pty_in_write_);  pty_in_write_ = INVALID_HANDLE_VALUE;
        CloseHandle(pty_out_read_);  pty_out_read_ = INVALID_HANDLE_VALUE;
        return false;
    }

    process_ = pi.hProcess;
    CloseHandle(pi.hThread); // we don't need the thread handle

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

    // Closing the ConPTY signals the child process to exit gracefully.
    if (hpc_) { ClosePseudoConsole(hpc_); hpc_ = nullptr; }

    if (process_ != INVALID_HANDLE_VALUE) {
        if (WaitForSingleObject(process_, 3000) == WAIT_TIMEOUT) {
            TerminateProcess(process_, 1);
            WaitForSingleObject(process_, 2000);
        }
    }

    // With ConPTY closed and process dead, ReadFile in ReadLoop returns an
    // error (ERROR_BROKEN_PIPE). The reader thread exits and can be joined.
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
        if (!ReadFile(pty_out_read_, buf.data(), kBufSize, &n, nullptr) || n == 0)
            break;
        on_output_(id_, base64::encode(buf.data(), n));
    }

    // Only fire on_exit_ when the process exited on its own (not via Stop()).
    if (running_.exchange(false)) {
        spdlog::info("[{}] Process exited", id_);
        on_exit_(id_, 0);
    }
}
