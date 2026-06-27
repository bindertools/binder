#pragma once
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <atomic>

// Borderless GDI splash screen shown while WebView2 loads.
// Runs in a dedicated background thread; safe to close from any thread.
class SplashScreen {
public:
    SplashScreen() = default;
    ~SplashScreen() { Close(); }

    // Show the splash window; starts the background message loop.
    void Show();

    // Close the splash (posts WM_CLOSE to the background thread).
    // Safe to call from any thread; no-op if already closed or not shown.
    void Close();

    // hwnd_ is written by the background thread and read by Close().
    // Use atomic for safe cross-thread access.
    std::atomic<HWND> hwnd_{ nullptr };
};

#endif // _WIN32
