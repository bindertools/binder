#include "updater.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>   // ShellExecuteW
#include <winhttp.h>    // WinHttpOpen / WinHttpConnect / etc.

#include <spdlog/spdlog.h>

#include <string>
#include <vector>

using json = nlohmann::json;

namespace updater_ops {

namespace {

// ─── Helpers ──────────────────────────────────────────────────────────────────

static std::wstring to_wstr(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

static std::string to_utf8(const wchar_t* w, int wlen = -1) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, wlen, nullptr, 0, nullptr, nullptr);
    if (n <= 0) return {};
    std::string s(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, wlen, s.data(), n, nullptr, nullptr);
    return s;
}

// ─── WinHTTP GET — returns response body or empty on error ───────────────────
// Used for both the JSON API check and binary file downloads.

struct WinHttpGet {
    HINTERNET hSession = nullptr;
    HINTERNET hConnect = nullptr;
    HINTERNET hRequest = nullptr;

    ~WinHttpGet() {
        if (hRequest) WinHttpCloseHandle(hRequest);
        if (hConnect) WinHttpCloseHandle(hConnect);
        if (hSession) WinHttpCloseHandle(hSession);
    }

    // Open a GET request.  host must be the bare hostname (no scheme/path).
    // path includes the leading '/'.  port is 443 for HTTPS, 80 for HTTP.
    bool open(const wchar_t* host, INTERNET_PORT port, const wchar_t* path,
              bool is_https, const wchar_t* user_agent = L"cmdIDE-app/1.0") {
        hSession = WinHttpOpen(user_agent,
                               WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                               WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!hSession) return false;

        hConnect = WinHttpConnect(hSession, host, port, 0);
        if (!hConnect) return false;

        DWORD flags = is_https ? WINHTTP_FLAG_SECURE : 0;
        hRequest = WinHttpOpenRequest(hConnect, L"GET", path, nullptr,
                                      WINHTTP_NO_REFERER,
                                      WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
        return hRequest != nullptr;
    }

    bool add_header(const wchar_t* header) {
        return WinHttpAddRequestHeaders(hRequest, header, (DWORD)-1,
                                        WINHTTP_ADDREQ_FLAG_ADD) != FALSE;
    }

    bool send() {
        return WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                  nullptr, 0, 0, 0) &&
               WinHttpReceiveResponse(hRequest, nullptr);
    }

    int status_code() {
        DWORD code = 0, size = sizeof(code);
        WinHttpQueryHeaders(hRequest,
                            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &code, &size,
                            WINHTTP_NO_HEADER_INDEX);
        return (int)code;
    }

    // Read entire response into a string.
    std::string read_all() {
        std::string out;
        DWORD avail = 0;
        char buf[8192];
        while (WinHttpQueryDataAvailable(hRequest, &avail) && avail > 0) {
            DWORD chunk = avail < sizeof(buf) ? avail : sizeof(buf);
            DWORD got   = 0;
            if (!WinHttpReadData(hRequest, buf, chunk, &got)) break;
            out.append(buf, got);
        }
        return out;
    }

    // Stream response body to a file, returning total bytes written.
    // progress_cb(pct) called approximately every 5%.
    int64_t read_to_file(HANDLE file,
                         std::function<void(double)> progress_cb = {}) {
        // Content-Length (may be 0 if chunked / unknown)
        DWORD total_bytes = 0;
        {
            wchar_t len_str[32] = {};
            DWORD   len_size    = sizeof(len_str);
            WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_CONTENT_LENGTH,
                                WINHTTP_HEADER_NAME_BY_INDEX, len_str, &len_size,
                                WINHTTP_NO_HEADER_INDEX);
            total_bytes = (DWORD)_wtoi(len_str);
        }

        int64_t received       = 0;
        double  last_pct_notif = -1.0;
        char    buf[65536];
        DWORD   avail = 0;

        while (WinHttpQueryDataAvailable(hRequest, &avail) && avail > 0) {
            DWORD chunk = avail < sizeof(buf) ? avail : sizeof(buf);
            DWORD got   = 0;
            if (!WinHttpReadData(hRequest, buf, chunk, &got)) break;
            if (got == 0) continue;

            DWORD written;
            WriteFile(file, buf, got, &written, nullptr);
            received += got;

            if (progress_cb && total_bytes > 0) {
                double pct = (double)received * 100.0 / (double)total_bytes;
                if (pct - last_pct_notif >= 5.0) {
                    progress_cb(pct > 100.0 ? 100.0 : pct);
                    last_pct_notif = pct;
                }
            }
        }
        return received;
    }
};

// ─── GitHub releases API check ────────────────────────────────────────────────
// Replicates Go's CheckForUpdate exactly:
//   URL:         https://api.github.com/repos/Command-IDE/cmd-ide/releases
//   Headers:     Accept: application/vnd.github+json
//                User-Agent: cmdIDE-app
//   Logic:       Find first non-prerelease release (GitHub returns newest-first).
//                If tag_name != current AppVersion → update available.

static const char* kGithubRepo    = "Command-IDE/cmd-ide";
static const char* kDownloadExe   = "cmdIDE-windows-amd64.exe";

struct ReleaseInfo {
    bool        available      = false;
    std::string latest_version;
    std::string download_url;
    std::string release_notes;
};

static ReleaseInfo check_for_update(const std::string& app_version) {
    WinHttpGet req;
    if (!req.open(L"api.github.com", INTERNET_DEFAULT_HTTPS_PORT,
                  L"/repos/Command-IDE/cmd-ide/releases", true)) {
        spdlog::warn("[updater] WinHttpOpen/Connect failed");
        return {};
    }
    req.add_header(L"Accept: application/vnd.github+json");
    req.add_header(L"User-Agent: cmdIDE-app");
    if (!req.send() || req.status_code() != 200) {
        spdlog::warn("[updater] GitHub API returned non-200");
        return {};
    }

    std::string body = req.read_all();
    json releases;
    try { releases = json::parse(body); } catch (...) { return {}; }
    if (!releases.is_array()) return {};

    // Find first stable release — GitHub returns newest first (matches Go).
    for (auto& r : releases) {
        if (r.value("prerelease", false)) continue;

        std::string tag = r.value("tag_name", std::string{});
        if (tag.empty()) continue;
        if (tag == app_version) return {}; // already up-to-date

        // Build download URL from the assets list.
        std::string dl_url;
        if (r.contains("assets") && r["assets"].is_array()) {
            for (auto& asset : r["assets"]) {
                std::string name = asset.value("name", std::string{});
                if (name == kDownloadExe) {
                    dl_url = asset.value("browser_download_url", std::string{});
                    break;
                }
            }
        }
        if (dl_url.empty()) {
            // Fallback URL format (matches Go's PerformUpdate).
            dl_url = "https://github.com/" + std::string(kGithubRepo) +
                     "/releases/download/" + tag + "/" + kDownloadExe;
        }

        return {
            true, tag, dl_url,
            r.value("body", std::string{}), // release notes (markdown)
        };
    }
    return {}; // no stable release found
}

// ─── File download via WinHTTP ────────────────────────────────────────────────

static bool download_file(const std::string& url_utf8,
                          const std::string& dest_utf8,
                          std::string& err_msg) {
    // Parse URL into host + path.
    std::wstring wurl = to_wstr(url_utf8);

    URL_COMPONENTS uc{};
    uc.dwStructSize      = sizeof(uc);
    wchar_t host[256]    = {};
    wchar_t path_buf[2048] = {};
    uc.lpszHostName      = host;
    uc.dwHostNameLength  = sizeof(host) / sizeof(wchar_t);
    uc.lpszUrlPath       = path_buf;
    uc.dwUrlPathLength   = sizeof(path_buf) / sizeof(wchar_t);

    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &uc)) {
        err_msg = "invalid URL";
        return false;
    }

    bool is_https = (uc.nScheme == INTERNET_SCHEME_HTTPS);

    WinHttpGet req;
    if (!req.open(host, uc.nPort, path_buf, is_https)) {
        err_msg = "WinHttpOpen failed";
        return false;
    }
    req.add_header(L"User-Agent: cmdIDE-app");
    if (!req.send()) {
        err_msg = "WinHttpSendRequest failed";
        return false;
    }
    int sc = req.status_code();
    if (sc != 200) {
        err_msg = "HTTP " + std::to_string(sc);
        return false;
    }

    std::wstring wdest = to_wstr(dest_utf8);
    HANDLE file = CreateFileW(wdest.c_str(), GENERIC_WRITE, 0, nullptr,
                              CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        err_msg = "cannot create destination file";
        return false;
    }

    int64_t bytes = req.read_to_file(file);
    CloseHandle(file);

    if (bytes <= 0) {
        DeleteFileW(wdest.c_str());
        err_msg = "download produced zero bytes";
        return false;
    }
    return true;
}

} // namespace

// ─── IPC dispatch ─────────────────────────────────────────────────────────────

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    if (type == "updater.check") {
        // app_version comes from the Go side (AppVersion build var); fall back to "dev".
        auto app_version = msg.value("appVersion", std::string{"dev"});
        auto info = check_for_update(app_version);
        reply({
            {"updateAvailable", info.available},
            {"latestVersion",   info.latest_version},
            {"downloadUrl",     info.download_url},
            {"releaseNotes",    info.release_notes},
        });
        return true;
    }

    if (type == "updater.download") {
        auto url       = msg.value("url",      std::string{});
        auto dest_path = msg.value("destPath", std::string{});
        if (url.empty() || dest_path.empty()) {
            reply({{"ok", false}, {"error", "url and destPath required"}});
            return true;
        }
        std::string err;
        bool ok = download_file(url, dest_path, err);
        if (ok) {
            reply({{"ok", true}, {"path", dest_path}});
        } else {
            reply({{"ok", false}, {"error", err}});
        }
        return true;
    }

    if (type == "updater.install") {
        // Launch an already-downloaded installer exe with UAC elevation.
        // The Go side handles the in-place rename+relaunch; this endpoint
        // is for a conventional installer scenario.
        auto installer_path = msg.value("installerPath", std::string{});
        if (installer_path.empty()) {
            reply({{"ok", false}, {"error", "installerPath required"}});
            return true;
        }
        std::wstring wpath = to_wstr(installer_path);
        HINSTANCE hr = ShellExecuteW(nullptr, L"runas", wpath.c_str(),
                                     nullptr, nullptr, SW_SHOWNORMAL);
        bool ok = (reinterpret_cast<INT_PTR>(hr) > 32);
        if (ok) {
            reply({{"ok", true}, {"status", "launching"}});
        } else {
            reply({{"ok", false}, {"error", "ShellExecuteW failed"}});
        }
        return true;
    }

    return false;
}

} // namespace updater_ops
