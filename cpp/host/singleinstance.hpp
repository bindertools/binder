#pragma once
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <string>

// Single-instance enforcement using a named mutex.
// Returns false if another instance is already running (and brings it to front).
inline bool AcquireSingleInstance() {
    HANDLE h = CreateMutexW(nullptr, TRUE, L"Global\\Binder-App");
    if (!h) return true; // Failed to create mutex — allow startup

    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        // Another instance is running — bring its window to the foreground
        // Search by window title (webview/webview sets it via set_title)
        HWND existing = FindWindowW(nullptr, L"Binder");
        if (existing) {
            if (IsIconic(existing)) ShowWindow(existing, SW_RESTORE);
            SetForegroundWindow(existing);
        }
        CloseHandle(h);
        return false;
    }
    // Intentionally leak h — holds the mutex for the lifetime of the process
    return true;
}

#endif // _WIN32
