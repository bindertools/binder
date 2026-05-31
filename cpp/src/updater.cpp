#include "updater.hpp"
// CPPHTTPLIB_OPENSSL_SUPPORT is already defined by vcpkg cpp-httplib[openssl]
#include <httplib.h>

#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
namespace {
    std::wstring to_wstr(const std::string& s) {
        if (s.empty()) return {};
        int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
        std::wstring w(n, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
        return w;
    }
}
#endif

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace updater_ops {

namespace {

static const char* kGithubRepo  = "Command-IDE/cmd-ide";
static const char* kDownloadExe = "cmdIDE-windows-amd64.exe";

struct ReleaseInfo {
    bool        available = false;
    std::string latest_version;
    std::string download_url;
    std::string release_notes;
};

// Return the appropriate CA cert path for the current platform.
// Empty string means "use system/default certs".
static std::string GetCACertPath() {
#ifdef _WIN32
    return ""; // cpp-httplib uses OpenSSL which finds Windows certs automatically
#elif __APPLE__
    return ""; // Apple system keychain
#else
    // Linux — check common locations
    for (auto& p : {"/etc/ssl/certs/ca-certificates.crt",
                    "/etc/pki/tls/certs/ca-bundle.crt",
                    "/etc/ssl/ca-bundle.pem"}) {
        if (fs::exists(p)) return p;
    }
    return "";
#endif
}

// Configure an SSLClient with common settings.
static void configure_client(httplib::SSLClient& cli, const std::string& ca) {
    cli.set_follow_location(true);
    cli.enable_server_certificate_verification(true);
    if (!ca.empty()) cli.set_ca_cert_path(ca.c_str());
    cli.set_default_headers({
        {"User-Agent", "cmdIDE-app/1.0"},
        {"Accept",     "application/vnd.github+json"}
    });
}

// ─── GitHub releases check ─────────────────────────────────────────────────

static ReleaseInfo check_for_update(const std::string& app_version) {
    httplib::SSLClient cli("api.github.com");
    configure_client(cli, GetCACertPath());
    auto res = cli.Get("/repos/" + std::string(kGithubRepo) + "/releases");
    if (!res || res->status != 200) {
        spdlog::warn("[updater] GitHub API returned {}", res ? res->status : 0);
        return {};
    }

    json releases;
    try { releases = json::parse(res->body); } catch (...) { return {}; }
    if (!releases.is_array()) return {};

    for (auto& r : releases) {
        if (r.value("prerelease", false)) continue;
        std::string tag = r.value("tag_name", std::string{});
        if (tag.empty() || tag == app_version) continue;

        std::string dl_url;
        if (r.contains("assets") && r["assets"].is_array()) {
            for (auto& asset : r["assets"]) {
                if (asset.value("name", std::string{}) == kDownloadExe) {
                    dl_url = asset.value("browser_download_url", std::string{});
                    break;
                }
            }
        }
        if (dl_url.empty()) {
            dl_url = "https://github.com/" + std::string(kGithubRepo) +
                     "/releases/download/" + tag + "/" + kDownloadExe;
        }
        return {true, tag, dl_url, r.value("body", std::string{})};
    }
    return {};
}

// ─── File download ─────────────────────────────────────────────────────────

static bool download_file(const std::string& url, const std::string& dest,
                          std::string& err_msg) {
    // Parse URL: extract scheme://host/path
    std::string host, path;
    {
        size_t scheme_end = url.find("://");
        if (scheme_end == std::string::npos) { err_msg = "invalid URL"; return false; }
        size_t host_start = scheme_end + 3;
        size_t path_start = url.find('/', host_start);
        if (path_start == std::string::npos) { err_msg = "no path in URL"; return false; }
        host = url.substr(host_start, path_start - host_start);
        path = url.substr(path_start);
    }

    std::ofstream out(dest, std::ios::binary | std::ios::trunc);
    if (!out) { err_msg = "cannot create destination file: " + dest; return false; }

    httplib::SSLClient cli(host);
    configure_client(cli, GetCACertPath());
    bool write_ok = true;
    auto res = cli.Get(path.c_str(), [&](const char* data, size_t len) {
        out.write(data, static_cast<std::streamsize>(len));
        if (!out) { write_ok = false; return false; }
        return true;
    });

    out.close();

    if (!write_ok) {
        fs::remove(dest);
        err_msg = "write error during download";
        return false;
    }
    if (!res || res->status != 200) {
        fs::remove(dest);
        err_msg = "HTTP " + std::to_string(res ? res->status : 0);
        return false;
    }
    return true;
}

// ─── Open a file with the OS default handler ────────────────────────────────

static void open_with_system(const std::string& path) {
#ifdef _WIN32
    std::wstring wpath = to_wstr(path);
    ShellExecuteW(nullptr, L"open", wpath.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#elif __APPLE__
    system(("open \"" + path + "\"").c_str());
#else
    system(("xdg-open \"" + path + "\" &").c_str());
#endif
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
        reply(ok ? json{{"ok", true},  {"path", dest_path}}
                 : json{{"ok", false}, {"error", err}});
        return true;
    }

    if (type == "updater.install") {
        auto installer_path = msg.value("installerPath", std::string{});
        if (installer_path.empty()) {
            reply({{"ok", false}, {"error", "installerPath required"}});
            return true;
        }
        open_with_system(installer_path);
        reply({{"ok", true}, {"status", "launching"}});
        return true;
    }

    return false;
}

} // namespace updater_ops
