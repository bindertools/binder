#include "file_watcher.hpp"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <spdlog/spdlog.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <mutex>
#include <set>
#include <thread>
#include <vector>

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace file_watcher {
namespace {

fs::path from_u8(const std::string& s) {
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return fs::path(std::move(w));
}

std::mutex        g_lifecycle_mu;
std::thread       g_thread;
HANDLE            g_stop_event = nullptr;
std::atomic<bool> g_running{false};

// Walk one ReadDirectoryChangesW result buffer, collecting the (forward-slash)
// path of each changed entry's *containing* directory into `pending`.
void collect_changed_dirs(const std::vector<BYTE>& buf, DWORD bytes,
                          const fs::path& root, std::set<std::string>& pending) {
    DWORD offset = 0;
    for (;;) {
        auto* info = reinterpret_cast<const FILE_NOTIFY_INFORMATION*>(buf.data() + offset);
        std::wstring rel(reinterpret_cast<const wchar_t*>(info->FileName),
                         info->FileNameLength / sizeof(WCHAR));
        fs::path full = root / fs::path(rel);
        pending.insert(full.parent_path().generic_u8string());

        if (info->NextEntryOffset == 0) break;
        offset += info->NextEntryOffset;
        if (offset >= bytes) break;
    }
}

void watch_thread_main(std::wstring root_w, std::string root_u8, EmitFn emit) {
    HANDLE hDir = CreateFileW(
        root_w.c_str(), FILE_LIST_DIRECTORY,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED, nullptr);
    if (hDir == INVALID_HANDLE_VALUE) {
        spdlog::warn("[file_watcher] CreateFileW failed for '{}' (err {})", root_u8, GetLastError());
        return;
    }

    fs::path root = fs::path(root_w);
    std::vector<BYTE> buf(64 * 1024);
    OVERLAPPED ov{};
    ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

    const DWORD kFilter =
        FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME |
        FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_CREATION |
        FILE_NOTIFY_CHANGE_SIZE;

    std::set<std::string> pending;
    bool have_deadline = false;
    std::chrono::steady_clock::time_point deadline;

    auto issue = [&]() -> bool {
        ResetEvent(ov.hEvent);
        DWORD bytesReturned = 0;
        BOOL ok = ReadDirectoryChangesW(hDir, buf.data(), static_cast<DWORD>(buf.size()), TRUE,
                                        kFilter, &bytesReturned, &ov, nullptr);
        return ok || GetLastError() == ERROR_IO_PENDING;
    };

    auto flush = [&]() {
        if (pending.empty()) return;
        json dirs = json::array();
        for (auto& d : pending) dirs.push_back(d);
        emit("fs:changed", {{"dirs", dirs}});
        pending.clear();
        have_deadline = false;
    };

    if (issue()) {
        HANDLE waitHandles[2] = { ov.hEvent, g_stop_event };
        for (;;) {
            DWORD timeout = INFINITE;
            if (have_deadline) {
                auto now = std::chrono::steady_clock::now();
                timeout = now >= deadline ? 0 : static_cast<DWORD>(
                    std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now).count());
            }

            DWORD wr = WaitForMultipleObjects(2, waitHandles, FALSE, timeout);
            if (wr == WAIT_OBJECT_0 + 1) break;        // stop requested
            if (wr == WAIT_TIMEOUT) { flush(); continue; }
            if (wr != WAIT_OBJECT_0) break;            // unexpected error

            DWORD bytesReturned = 0;
            if (!GetOverlappedResult(hDir, &ov, &bytesReturned, FALSE)) break;

            if (bytesReturned == 0) {
                // Notification buffer overflowed (too many changes between
                // reads) — fall back to reporting the root as changed so the
                // explorer re-syncs whatever it currently has expanded.
                pending.insert(root.generic_u8string());
            } else {
                collect_changed_dirs(buf, bytesReturned, root, pending);
            }

            if (!pending.empty()) {
                deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(200);
                have_deadline = true;
            }

            if (!issue()) break;
        }
    }

    CancelIoEx(hDir, &ov);
    DWORD discard = 0;
    GetOverlappedResult(hDir, &ov, &discard, TRUE); // drain cancellation before closing

    CloseHandle(ov.hEvent);
    CloseHandle(hDir);
}

// Caller must hold g_lifecycle_mu.
void stop_locked() {
    if (!g_running.exchange(false)) return;
    if (g_stop_event) SetEvent(g_stop_event);
    if (g_thread.joinable()) g_thread.join();
    if (g_stop_event) { CloseHandle(g_stop_event); g_stop_event = nullptr; }
}

} // namespace

void start(const std::string& path, EmitFn emit) {
    std::lock_guard<std::mutex> lk(g_lifecycle_mu);
    stop_locked();
    if (path.empty()) return;

    std::error_code ec;
    fs::path root = from_u8(path);
    if (!fs::is_directory(root, ec)) {
        spdlog::warn("[file_watcher] not a directory, not watching: {}", path);
        return;
    }

    g_stop_event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    g_running = true;
    g_thread = std::thread(watch_thread_main, root.wstring(), path, std::move(emit));
}

void stop() {
    std::lock_guard<std::mutex> lk(g_lifecycle_mu);
    stop_locked();
}

} // namespace file_watcher

#else // !_WIN32

#include <spdlog/spdlog.h>

namespace file_watcher {

void start(const std::string& /*path*/, EmitFn /*emit*/) {
    // Deferred: no native recursive watcher implemented for this platform
    // yet. The explorer still works via its manual "Refresh" action.
    spdlog::info("[file_watcher] native file watching is not implemented on this platform");
}

void stop() {}

} // namespace file_watcher

#endif
