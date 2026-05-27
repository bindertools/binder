#include "ipc.hpp"
#include <algorithm>
#include <spdlog/spdlog.h>

IpcPipe::IpcPipe() : handle_(INVALID_HANDLE_VALUE) {}

IpcPipe::~IpcPipe() {
    close();
}

bool IpcPipe::connect(const std::string& pipe_path) {
    handle_ = CreateFileA(
        pipe_path.c_str(),
        GENERIC_READ | GENERIC_WRITE,
        0,
        nullptr,
        OPEN_EXISTING,
        0,
        nullptr
    );
    if (handle_ == INVALID_HANDLE_VALUE) {
        spdlog::error("CreateFile failed for {}: error {}", pipe_path, GetLastError());
        return false;
    }
    return true;
}

bool IpcPipe::read_line(std::string& out_line) {
    char tmp[4096];
    while (true) {
        auto it = std::find(buf_.begin(), buf_.end(), '\n');
        if (it != buf_.end()) {
            out_line.assign(buf_.begin(), it);
            buf_.erase(buf_.begin(), it + 1);
            return true;
        }
        DWORD nread = 0;
        if (!ReadFile(handle_, tmp, sizeof(tmp), &nread, nullptr) || nread == 0) {
            return false;
        }
        buf_.insert(buf_.end(), tmp, tmp + nread);
    }
}

bool IpcPipe::write_line(const std::string& line) {
    std::string msg = line + "\n";
    DWORD written = 0;
    return WriteFile(handle_, msg.c_str(), static_cast<DWORD>(msg.size()), &written, nullptr)
        && written == static_cast<DWORD>(msg.size());
}

void IpcPipe::close() {
    if (handle_ != INVALID_HANDLE_VALUE) {
        CloseHandle(handle_);
        handle_ = INVALID_HANDLE_VALUE;
    }
}
