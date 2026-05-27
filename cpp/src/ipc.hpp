#pragma once
#include <string>
#include <vector>
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

class IpcPipe {
public:
    IpcPipe();
    ~IpcPipe();

    // Connects to a named pipe server as a client.
    bool connect(const std::string& pipe_path);

    // Blocks until one newline-terminated line is available; returns false on error/EOF.
    bool read_line(std::string& out_line);

    // Writes line + '\n' to the pipe; returns false on error.
    bool write_line(const std::string& line);

    void close();

private:
    HANDLE handle_;
    std::vector<char> buf_;
};
