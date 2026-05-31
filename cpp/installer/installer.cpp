#include "installer.hpp"
#include "channel.hpp"
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <thread>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#endif

using json = nlohmann::json;
namespace fs = std::filesystem;

static constexpr const char* kGithubRepo = "Command-IDE/cmd-ide";
static constexpr const char* kBinaryName = "cmdIDE.exe";

// ── Helpers ────────────────────────────────────────────────────────────────────

#ifdef _WIN32
static std::wstring to_wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}
static std::string to_utf8(const std::wstring& w) {
    if (w.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
    return s;
}
#endif

static std::string GetInstallDirPath() {
#ifdef _WIN32
    wchar_t localapp[MAX_PATH] = {};
    SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localapp);
    return to_utf8(std::wstring(localapp) + L"\\Programs\\cmdIDE");
#elif __APPLE__
    const char* home = getenv("HOME");
    return std::string(home ? home : "/tmp") + "/Applications/cmdIDE";
#else
    const char* home = getenv("HOME");
    return std::string(home ? home : "/tmp") + "/.local/bin/cmdide";
#endif
}

// ── InstallerApp ──────────────────────────────────────────────────────────────

InstallerApp::InstallerApp(webview::webview& wv) : wv_(wv) {}

void InstallerApp::emit_progress(int pct, const std::string& msg) {
    json data = {{"pct", pct}, {"msg", msg}};
    std::string js = "if(window.__cmdide_emit){window.__cmdide_emit('install:progress'," +
                     data.dump() + ")}";
    wv_.dispatch([this, js] { wv_.eval(js); });
}

void InstallerApp::emit_error(const std::string& msg) {
    std::string js = "if(window.__cmdide_emit){window.__cmdide_emit('installer:error',\"" +
                     msg + "\")}";
    wv_.dispatch([this, js] { wv_.eval(js); });
}

void InstallerApp::GetChannel(const std::string& seq) {
    json r = {{"ok", true}, {"data", kIncludePrerelease ? "dev" : "stable"}};
    wv_.resolve(seq, 0, r.dump());
}

void InstallerApp::GetInstallDir(const std::string& seq) {
    json r = {{"ok", true}, {"data", GetInstallDirPath()}};
    wv_.resolve(seq, 0, r.dump());
}

void InstallerApp::GetReleases(const std::string& seq) {
    httplib::SSLClient cli("api.github.com");
    cli.set_follow_location(true);
    cli.enable_server_certificate_verification(true);
    cli.set_default_headers({
        {"Accept",     "application/vnd.github+json"},
        {"User-Agent", "cmdIDE-installer/1.0"}
    });

    auto res = cli.Get("/repos/" + std::string(kGithubRepo) + "/releases");
    if (!res || res->status != 200) {
        std::string err = "GitHub API returned " + std::to_string(res ? res->status : 0);
        emit_error(err);
        json r = {{"ok", false}, {"error", err}};
        wv_.resolve(seq, 0, r.dump());
        return;
    }

    json raw;
    try { raw = json::parse(res->body); } catch (...) {
        emit_error("Failed to parse releases");
        wv_.resolve(seq, 0, json{{"ok", false}, {"error", "parse error"}}.dump());
        return;
    }

    releases_cache_.clear();
    for (auto& r : raw) {
        bool prerelease = r.value("prerelease", false);
        if (prerelease && !kIncludePrerelease) continue;

        std::string tag = r.value("tag_name", std::string{});
        if (tag.empty()) continue;

        std::string dl_url;
        for (auto& asset : r.value("assets", json::array())) {
            if (asset.value("name", std::string{}) == "cmdIDE-windows-amd64.exe") {
                dl_url = asset.value("browser_download_url", std::string{});
                break;
            }
        }
        if (dl_url.empty()) {
            dl_url = "https://github.com/" + std::string(kGithubRepo) +
                     "/releases/download/" + tag + "/cmdIDE-windows-amd64.exe";
        }

        std::string pub = r.value("published_at", std::string{});
        if (pub.size() >= 10) pub = pub.substr(0, 10);

        releases_cache_.push_back({tag, r.value("name", tag), pub,
                                   prerelease, dl_url, r.value("body", std::string{})});
    }

    json arr = json::array();
    for (auto& rel : releases_cache_) {
        arr.push_back({{"version",      rel.version},
                       {"name",         rel.name},
                       {"publishedAt",  rel.published_at},
                       {"prerelease",   rel.prerelease},
                       {"downloadURL",  rel.download_url},
                       {"releaseNotes", rel.release_notes}});
    }
    wv_.resolve(seq, 0, json{{"ok", true}, {"data", arr}}.dump());
}

void InstallerApp::Install(const std::string& seq,
                           const std::string& version,
                           bool create_desktop,
                           bool /*install_plugins*/) {
    emit_progress(5, "Preparing...");

    std::string install_dir = GetInstallDirPath();

    // Build download URL
    std::string url;
    if (version.empty() || version == "latest") {
        url = "https://github.com/" + std::string(kGithubRepo) +
              "/releases/latest/download/cmdIDE-windows-amd64.exe";
    } else {
        url = "https://github.com/" + std::string(kGithubRepo) +
              "/releases/download/" + version + "/cmdIDE-windows-amd64.exe";
    }

    // Parse host and path
    std::string host = "github.com";
    std::string path = url.substr(url.find('/', url.find("://") + 3));

    emit_progress(10, "Fetching release...");

    // Download with progress
    httplib::SSLClient cli(host);
    cli.set_follow_location(true);
    cli.enable_server_certificate_verification(true);
    cli.set_default_headers({{"User-Agent", "cmdIDE-installer/1.0"}});

    std::string tmp_path = install_dir + "\\.cmdide_download_tmp.exe";
    {
        std::error_code ec;
        fs::create_directories(install_dir, ec);
        if (ec) {
            emit_error("Could not create install directory: " + ec.message());
            wv_.resolve(seq, 0, json{{"ok", false}, {"error", ec.message()}}.dump());
            return;
        }
    }

    std::ofstream out(tmp_path, std::ios::binary | std::ios::trunc);
    if (!out) {
        emit_error("Cannot create download file");
        wv_.resolve(seq, 0, json{{"ok", false}, {"error", "cannot create file"}}.dump());
        return;
    }

    int64_t total_bytes = 0;
    int64_t received    = 0;
    bool    write_ok    = true;

    auto res = cli.Get(path.c_str(),
        [&](const httplib::Response& r) {
            // Headers callback
            auto it = r.headers.find("Content-Length");
            if (it != r.headers.end()) {
                try { total_bytes = std::stoll(it->second); } catch (...) {}
            }
            return true;
        },
        [&](const char* data, size_t len) {
            out.write(data, static_cast<std::streamsize>(len));
            if (!out) { write_ok = false; return false; }
            received += static_cast<int64_t>(len);
            if (total_bytes > 0) {
                int pct = 15 + static_cast<int>(received * 75 / total_bytes);
                emit_progress(pct, "Downloading...");
            }
            return true;
        });

    out.close();

    if (!write_ok || !res || res->status != 200) {
        fs::remove(tmp_path);
        std::string err = "Download failed: HTTP " + std::to_string(res ? res->status : 0);
        emit_error(err);
        wv_.resolve(seq, 0, json{{"ok", false}, {"error", err}}.dump());
        return;
    }

    emit_progress(92, "Installing...");
    std::string dest = install_dir + "\\" + kBinaryName;
    {
        std::error_code ec;
        fs::rename(tmp_path, dest, ec);
        if (ec) {
            fs::copy_file(tmp_path, dest, fs::copy_options::overwrite_existing, ec);
            fs::remove(tmp_path);
            if (ec) {
                emit_error("Could not install binary: " + ec.message());
                wv_.resolve(seq, 0, json{{"ok", false}, {"error", ec.message()}}.dump());
                return;
            }
        }
    }

    emit_progress(95, "Registering application...");
#ifdef _WIN32
    // Register uninstall entry and write uninstall script via PowerShell
    std::string uninstall_ps = install_dir + "\\uninstall.ps1";
    {
        std::ofstream ps(uninstall_ps);
        ps << "Remove-Item -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\cmdIDE' -Recurse -Force -ErrorAction SilentlyContinue\n";
        ps << "Remove-Item -Recurse -Force $PSScriptRoot -ErrorAction SilentlyContinue\n";
    }
    std::string reg_cmd = "powershell.exe -NoProfile -NonInteractive -Command \""
        "$p='HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\cmdIDE';"
        "New-Item -Path $p -Force|Out-Null;"
        "Set-ItemProperty -Path $p -Name DisplayName -Value 'Command IDE';"
        "Set-ItemProperty -Path $p -Name DisplayVersion -Value '" + version + "';"
        "Set-ItemProperty -Path $p -Name InstallLocation -Value '" + install_dir + "';"
        "Set-ItemProperty -Path $p -Name UninstallString -Value 'powershell.exe -File \\\"" + uninstall_ps + "\\\"';"
        "\"";
    system(reg_cmd.c_str());

    emit_progress(98, "Creating shortcuts...");
    // Create Start Menu shortcut
    auto make_shortcut = [&](const std::string& folder_const) {
        std::string ps = "powershell.exe -Sta -NoProfile -NonInteractive -Command \""
            "$d=[System.Environment]::GetFolderPath('" + folder_const + "');"
            "if('" + folder_const + "' -eq 'StartMenu'){$d=[System.IO.Path]::Combine($d,'Programs')};"
            "$s=New-Object -ComObject WScript.Shell;"
            "$l=$s.CreateShortcut([System.IO.Path]::Combine($d,'Command IDE.lnk'));"
            "$l.TargetPath='" + dest + "';"
            "$l.WorkingDirectory='" + install_dir + "';"
            "$l.Save()\"";
        system(ps.c_str());
    };
    make_shortcut("StartMenu");
    if (create_desktop) make_shortcut("Desktop");
#endif

    emit_progress(100, "Installation complete");
    wv_.resolve(seq, 0, json{{"ok", true}}.dump());
}

void InstallerApp::LaunchAndClose(const std::string& seq) {
    std::string exe = GetInstallDirPath() + "\\" + kBinaryName;
    wv_.resolve(seq, 0, json{{"ok", true}}.dump());
#ifdef _WIN32
    std::wstring wexe = to_wide(exe);
    ShellExecuteW(nullptr, L"open", wexe.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#else
    system(("\"" + exe + "\" &").c_str());
#endif
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    wv_.dispatch([this] { wv_.terminate(); });
}

void InstallerApp::CloseInstaller(const std::string& seq) {
    wv_.resolve(seq, 0, json{{"ok", true}}.dump());
    wv_.dispatch([this] { wv_.terminate(); });
}
