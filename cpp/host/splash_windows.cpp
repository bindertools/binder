#ifdef _WIN32
#include "splash_windows.hpp"
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <dwmapi.h>
#include <objidl.h>

// GDI+ uses min/max — pull them in before including gdiplus.h
#include <algorithm>
using std::min;
using std::max;
#include <gdiplus.h>
#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "ole32.lib")

#include "resource.h"

// ── Splash dimensions (matching Go implementation) ────────────────────────────
static constexpr int kW       = 340;
static constexpr int kH       = 145;
static constexpr int kBannerW = 300;
static constexpr int kBannerH = 100;
static constexpr int kBannerY = (kH - kBannerH) / 2;

static Gdiplus::GdiplusStartupInput g_gdipInput{};
static ULONG_PTR                    g_gdipToken = 0;
static Gdiplus::Bitmap*             g_bitmap    = nullptr;

static void LoadBitmapFromResource() {
    HMODULE hMod = GetModuleHandleW(nullptr);
    HRSRC  hRes  = FindResourceW(hMod, MAKEINTRESOURCEW(IDB_SPLASH), RT_RCDATA);
    if (!hRes) return;
    HGLOBAL hData = LoadResource(hMod, hRes);
    if (!hData) return;
    void*  pData = LockResource(hData);
    DWORD  size  = SizeofResource(hMod, hRes);
    if (!pData || !size) return;

    // Copy to a moveable heap block so CreateStreamOnHGlobal can take ownership
    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, size);
    if (!hMem) return;
    void* pMem = GlobalLock(hMem);
    if (!pMem) { GlobalFree(hMem); return; }
    memcpy(pMem, pData, size);
    GlobalUnlock(hMem);

    IStream* pStream = nullptr;
    if (SUCCEEDED(CreateStreamOnHGlobal(hMem, TRUE /*fDeleteOnRelease*/, &pStream))) {
        g_bitmap = Gdiplus::Bitmap::FromStream(pStream);
        pStream->Release();
        if (g_bitmap && g_bitmap->GetLastStatus() != Gdiplus::Ok) {
            delete g_bitmap;
            g_bitmap = nullptr;
        }
    }
}

static LRESULT CALLBACK SplashWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_PAINT) {
        PAINTSTRUCT ps{};
        HDC hdc = BeginPaint(hwnd, &ps);

        // Dark background (#0D0D0D)
        HBRUSH bgBrush = CreateSolidBrush(RGB(0x0D, 0x0D, 0x0D));
        RECT rc{0, 0, kW, kH};
        FillRect(hdc, &rc, bgBrush);
        DeleteObject(bgBrush);

        // 1px border (#2A2A2A)
        HBRUSH boBrush = CreateSolidBrush(RGB(0x2A, 0x2A, 0x2A));
        RECT edges[] = {
            {0,      0,      kW,  1   },  // top
            {0,      kH - 1, kW,  kH  },  // bottom
            {0,      0,      1,   kH  },  // left
            {kW - 1, 0,      kW,  kH  },  // right
        };
        for (auto& e : edges) FillRect(hdc, &e, boBrush);
        DeleteObject(boBrush);

        // Banner PNG centered horizontally
        if (g_bitmap) {
            int bx = (kW - kBannerW) / 2;
            Gdiplus::Graphics g(hdc);
            g.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
            g.DrawImage(g_bitmap, bx, kBannerY, kBannerW, kBannerH);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }

    if (msg == WM_ERASEBKGND) return 1;
    if (msg == WM_NCHITTEST)  return HTCAPTION;  // whole splash is draggable

    if (msg == WM_TIMER) {
        KillTimer(hwnd, 1);
        DestroyWindow(hwnd);
        return 0;
    }

    if (msg == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProcW(hwnd, msg, wp, lp);
}

// Background thread entry point
static DWORD WINAPI SplashThread(LPVOID arg) {
    auto* self = static_cast<SplashScreen*>(arg);

    Gdiplus::GdiplusStartup(&g_gdipToken, &g_gdipInput, nullptr);
    LoadBitmapFromResource();

    HINSTANCE hInst = GetModuleHandleW(nullptr);
    WNDCLASSEXW wc{};
    wc.cbSize        = sizeof(wc);
    wc.lpfnWndProc   = SplashWndProc;
    wc.hInstance     = hInst;
    wc.hCursor       = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"BinderSplash";
    wc.hIcon         = LoadIconW(hInst, MAKEINTRESOURCEW(IDI_APPICON));
    RegisterClassExW(&wc);

    int sw = GetSystemMetrics(SM_CXSCREEN);
    int sh = GetSystemMetrics(SM_CYSCREEN);

    HWND hwnd = CreateWindowExW(
        WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
        L"BinderSplash", L"Binder",
        WS_POPUP | WS_VISIBLE,
        (sw - kW) / 2, (sh - kH) / 2, kW, kH,
        nullptr, nullptr, hInst, nullptr);

    if (!hwnd) {
        Gdiplus::GdiplusShutdown(g_gdipToken);
        return 0;
    }

    // Rounded corners on Windows 11
    DWORD corner = 2; // DWMWCP_ROUND
    DwmSetWindowAttribute(hwnd, 33 /*DWMWA_WINDOW_CORNER_PREFERENCE*/, &corner, sizeof(corner));

    self->hwnd_.store(hwnd);
    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);
    SetTimer(hwnd, 1, 10000, nullptr);  // 10s auto-close

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    self->hwnd_.store(nullptr);
    if (g_bitmap) { delete g_bitmap; g_bitmap = nullptr; }
    Gdiplus::GdiplusShutdown(g_gdipToken);
    g_gdipToken = 0;
    return 0;
}

void SplashScreen::Show() {
    CreateThread(nullptr, 0, SplashThread, this, 0, nullptr);
    // Give the thread a moment to create its HWND
    Sleep(50);
}

void SplashScreen::Close() {
    HWND h = hwnd_.exchange(nullptr);
    if (h) PostMessageW(h, WM_CLOSE, 0, 0);
}

#endif // _WIN32
