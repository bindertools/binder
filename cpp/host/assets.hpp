#pragma once
// Frontend asset embedding + serving.
// On Windows: assets are embedded as a zip RC resource (FRONTEND_ZIP) and
//             extracted to %TEMP%\cmdide-<hash>\ on first run.
//             No www/ sidecar directory is needed — the exe is self-contained.
// On macOS/Linux: assets are served from <exe_dir>/www/ (copy-alongside).

#include <webview.h>
#include <string>
#include <cstdlib>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <algorithm>  // std::min
#include <windows.h>
#include <WebView2.h>
#include <zip.h>
#include <filesystem>
#include <fstream>
#include <sstream>
#include "resource.h"
namespace fs = std::filesystem;

// ── Windows: exe directory ────────────────────────────────────────────────────
inline std::string GetExeDir() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    return fs::path(path).parent_path().string();
}

// ── Windows: extract embedded zip to temp dir ─────────────────────────────────
inline std::string ExtractAssets() {
    HMODULE hMod = GetModuleHandleW(nullptr);

    // Locate the embedded zip resource
    HRSRC  hRes  = FindResourceW(hMod, L"FRONTEND_ZIP", RT_RCDATA);
    if (!hRes) {
        // Fallback: serve from www/ next to the exe (development mode)
        return GetExeDir() + "\\www";
    }

    HGLOBAL hData  = LoadResource(hMod, hRes);
    const char* zipData = static_cast<const char*>(LockResource(hData));
    DWORD       zipSize = SizeofResource(hMod, hRes);

    // Derive a stable dir name from the first 64 bytes of the zip
    uint32_t hash = 0x811c9dc5u;
    for (DWORD i = 0; i < std::min(zipSize, (DWORD)64); ++i)
        hash = (hash ^ (unsigned char)zipData[i]) * 0x01000193u;

    char tmp[MAX_PATH];
    GetTempPathA(MAX_PATH, tmp);
    char hashStr[12];
    sprintf_s(hashStr, "%08x", hash);
    std::string extractDir = std::string(tmp) + "cmdide-" + hashStr;
    std::string marker     = extractDir + "\\.extracted";

    // Skip extraction if already done (same version)
    if (GetFileAttributesA(marker.c_str()) != INVALID_FILE_ATTRIBUTES)
        return extractDir;

    fs::create_directories(extractDir);

    // Extract zip using libzip (in-memory source)
    zip_error_t ze{};
    zip_source_t* src = zip_source_buffer_create(zipData, zipSize, 0, &ze);
    if (!src) return extractDir;
    zip_t* za = zip_open_from_source(src, ZIP_RDONLY, &ze);
    if (!za) { zip_source_free(src); return extractDir; }

    zip_int64_t count = zip_get_num_entries(za, 0);
    for (zip_int64_t i = 0; i < count; ++i) {
        const char* name = zip_get_name(za, i, 0);
        if (!name) continue;
        std::string dest = extractDir + "/" + name;

        if (name[strlen(name) - 1] == '/') {
            fs::create_directories(dest);
            continue;
        }
        fs::create_directories(fs::path(dest).parent_path());

        zip_file_t* zf = zip_fopen_index(za, i, 0);
        if (!zf) continue;
        std::ofstream out(dest, std::ios::binary);
        char buf[65536];
        zip_int64_t n;
        while ((n = zip_fread(zf, buf, sizeof(buf))) > 0)
            out.write(buf, static_cast<std::streamsize>(n));
        zip_fclose(zf);
    }
    zip_close(za);

    // Write marker so future launches skip extraction
    std::ofstream(marker).close();
    return extractDir;
}

// ── GetDevUrl ─────────────────────────────────────────────────────────────────
inline std::string GetDevUrl() { return "http://localhost:5173"; }

// ── GetFrontendUrl ────────────────────────────────────────────────────────────
// Registers the extracted dir as a virtual hostname so the frontend loads as
// "https://app.local/index.html" (avoids file:// CORS restrictions).
inline std::string GetFrontendUrl(webview::webview& wv, const std::string& extractedRoot) {
    auto ctrl_res = wv.browser_controller();
    if (ctrl_res.ok()) {
        auto* controller = static_cast<ICoreWebView2Controller*>(ctrl_res.value());
        ICoreWebView2* wv2 = nullptr;
        if (SUCCEEDED(controller->get_CoreWebView2(&wv2)) && wv2) {
            ICoreWebView2_3* wv2_3 = nullptr;
            if (SUCCEEDED(wv2->QueryInterface(IID_PPV_ARGS(&wv2_3))) && wv2_3) {
                std::wstring wdir(extractedRoot.begin(), extractedRoot.end());
                wv2_3->SetVirtualHostNameToFolderMapping(
                    L"app.local", wdir.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                wv2_3->Release();
                wv2->Release();
                return "https://app.local/index.html";
            }
            wv2->Release();
        }
    }
    return "file:///" + extractedRoot + "/index.html";
}

#elif __APPLE__
#include <filesystem>
#include <mach-o/dyld.h>
namespace fs = std::filesystem;

inline std::string GetExeDir() {
    char path[4096] = {};
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size) == 0)
        return fs::path(path).parent_path().string();
    return fs::current_path().string();
}
inline std::string ExtractAssets()                               { return GetExeDir() + "/www"; }
inline std::string GetDevUrl()                                   { return "http://localhost:5173"; }
inline std::string GetFrontendUrl(webview::webview& /*wv*/, const std::string& root) {
    return "file://" + root + "/index.html";
}

#else // Linux
#include <filesystem>
#include <unistd.h>
namespace fs = std::filesystem;

inline std::string GetExeDir() {
    char path[4096] = {};
    ssize_t n = readlink("/proc/self/exe", path, sizeof(path) - 1);
    if (n > 0) return fs::path(path).parent_path().string();
    return fs::current_path().string();
}
inline std::string ExtractAssets()                               { return GetExeDir() + "/www"; }
inline std::string GetDevUrl()                                   { return "http://localhost:5173"; }
inline std::string GetFrontendUrl(webview::webview& /*wv*/, const std::string& root) {
    return "file://" + root + "/index.html";
}
#endif
