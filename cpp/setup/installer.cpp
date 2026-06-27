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

// Run a command in a hidden console window (no CMD flash for the user)
static void RunHidden(const std::string& cmd) {
    std::wstring wcmd;
    int n = MultiByteToWideChar(CP_UTF8, 0, cmd.data(), (int)cmd.size(), nullptr, 0);
    wcmd.resize(n);
    MultiByteToWideChar(CP_UTF8, 0, cmd.data(), (int)cmd.size(), wcmd.data(), n);

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi{};
    if (CreateProcessW(nullptr, wcmd.data(), nullptr, nullptr,
                       FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, 30000);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
}
#endif

using json = nlohmann::json;
namespace fs = std::filesystem;

static constexpr const char* kGithubRepo = "BinderTools/binder";
static constexpr const char* kBinaryName = "Binder.exe";

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

// Where the main app's Config (cpp/src/config.cpp) looks for local data.
// Must stay in sync with GetDataRoot() there.
static std::string GetDataRootPath() {
#ifdef _WIN32
    wchar_t localapp[MAX_PATH] = {};
    GetEnvironmentVariableW(L"LOCALAPPDATA", localapp, MAX_PATH);
    return to_utf8(std::wstring(localapp) + L"\\Binder");
#elif __APPLE__
    const char* home = getenv("HOME");
    return std::string(home ? home : "/tmp") + "/Library/Application Support/Binder";
#else
    const char* home = getenv("HOME");
    return std::string(home ? home : "/tmp") + "/.local/share/binder";
#endif
}

static std::string GetInstallDirPath() {
#ifdef _WIN32
    wchar_t localapp[MAX_PATH] = {};
    SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localapp);
    return to_utf8(std::wstring(localapp) + L"\\Programs\\Binder");
#elif __APPLE__
    const char* home = getenv("HOME");
    return std::string(home ? home : "/tmp") + "/Applications/Binder";
#else
    const char* home = getenv("HOME");
    return std::string(home ? home : "/tmp") + "/.local/bin/binder";
#endif
}

// ── InstallerApp ──────────────────────────────────────────────────────────────

InstallerApp::InstallerApp(webview::webview& wv) : wv_(wv) {}

void InstallerApp::emit_progress(int pct, const std::string& msg) {
    // Pass pct and msg as POSITIONAL args matching the Wails EventsOn(event, pct, msg) convention.
    // The callback is (pct: number, msg: string) — it must receive separate args, not one object.
    nlohmann::json jmsg = msg;  // handles quoting/escaping
    std::string js = "if(window.__binder_emit){window.__binder_emit('install:progress'," +
                     std::to_string(pct) + "," + jmsg.dump() + ")}";
    wv_.dispatch([this, js] { wv_.eval(js); });
}

void InstallerApp::emit_error(const std::string& msg) {
    nlohmann::json jmsg = msg;
    std::string js = "if(window.__binder_emit){window.__binder_emit('installer:error'," +
                     jmsg.dump() + ")}";
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
        {"User-Agent", "Binder-installer/1.0"}
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

        std::string tag = r.value("tag_name", std::string{});
        if (tag.empty()) continue;

        std::string dl_url;
        for (auto& asset : r.value("assets", json::array())) {
            if (asset.value("name", std::string{}) == "Binder-windows-amd64.exe") {
                dl_url = asset.value("browser_download_url", std::string{});
                break;
            }
        }
        if (dl_url.empty()) {
            dl_url = "https://github.com/" + std::string(kGithubRepo) +
                     "/releases/download/" + tag + "/Binder-windows-amd64.exe";
        }

        std::string pub = r.value("published_at", std::string{});
        if (pub.size() >= 10) pub.resize(10);

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
                           const std::vector<std::string>& seed_apps) {
    emit_progress(5, "Preparing...");

    std::string install_dir = GetInstallDirPath();

    // Build download URL
    std::string url;
    if (version.empty() || version == "latest") {
        url = "https://github.com/" + std::string(kGithubRepo) +
              "/releases/latest/download/Binder-windows-amd64.exe";
    } else {
        url = "https://github.com/" + std::string(kGithubRepo) +
              "/releases/download/" + version + "/Binder-windows-amd64.exe";
    }

    // Parse host and path
    std::string host = "github.com";
    std::string path = url.substr(url.find('/', url.find("://") + 3));

    emit_progress(10, "Fetching release...");

    // Download with progress
    httplib::SSLClient cli(host);
    cli.set_follow_location(true);
    cli.enable_server_certificate_verification(true);
    cli.set_default_headers({{"User-Agent", "Binder-installer/1.0"}});

    std::string tmp_path = install_dir + "\\.binder_download_tmp.exe";
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
        ps << "Remove-Item -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Binder' -Recurse -Force -ErrorAction SilentlyContinue\n";
        ps << "Remove-Item -Recurse -Force $PSScriptRoot -ErrorAction SilentlyContinue\n";
    }
    std::string reg_cmd = "powershell.exe -NoProfile -NonInteractive -Command \""
        "$p='HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Binder';"
        "New-Item -Path $p -Force|Out-Null;"
        "Set-ItemProperty -Path $p -Name DisplayName -Value 'Binder';"
        "Set-ItemProperty -Path $p -Name DisplayVersion -Value '" + version + "';"
        "Set-ItemProperty -Path $p -Name InstallLocation -Value '" + install_dir + "';"
        "Set-ItemProperty -Path $p -Name UninstallString -Value 'powershell.exe -File \\\"" + uninstall_ps + "\\\"';"
        "\"";
    RunHidden(reg_cmd);

    emit_progress(98, "Creating shortcuts...");
    // Create Start Menu shortcut
    auto make_shortcut = [&](const std::string& folder_const) {
        std::string ps = "powershell.exe -Sta -NoProfile -NonInteractive -Command \""
            "$d=[System.Environment]::GetFolderPath('" + folder_const + "');"
            "if('" + folder_const + "' -eq 'StartMenu'){$d=[System.IO.Path]::Combine($d,'Programs')};"
            "$s=New-Object -ComObject WScript.Shell;"
            "$l=$s.CreateShortcut([System.IO.Path]::Combine($d,'Binder.lnk'));"
            "$l.TargetPath='" + dest + "';"
            "$l.WorkingDirectory='" + install_dir + "';"
            "$l.Save()\"";
        RunHidden(ps);
    };
    make_shortcut("StartMenu");
    if (create_desktop) make_shortcut("Desktop");
#endif

    // Seed the persona-selected apps for the main app's first launch. We write
    // a one-shot marker rather than the main app's config.json directly, so
    // the installer doesn't need to duplicate Config's merge/defaults logic;
    // Config::load() consumes and deletes this file on first run.
    if (!seed_apps.empty()) {
        std::error_code ec;
        std::string data_root = GetDataRootPath();
        fs::create_directories(data_root, ec);
        if (!ec) {
            json seed = {{"installed_apps", seed_apps}};
            std::ofstream f(data_root + "/.first-run-apps.json", std::ios::trunc);
            if (f) f << seed.dump(2);
        }
    }

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

// Called once the React app has mounted and painted its first frame. The
// window is created hidden (see cpp/setup/main.cpp) precisely so it never
// shows blank or with default OS chrome before this fires.
void InstallerApp::Ready(const std::string& seq) {
#ifdef _WIN32
    // This handler runs on the detached IPC worker thread (see
    // __binder_invoke in main.cpp), not the UI thread that owns the window.
    // ShowWindow/SetForegroundWindow must be marshalled onto the UI thread
    // via wv_.dispatch() (same as cpp/host/dispatch.cpp's app.ready handler) —
    // calling them directly from the worker thread leaves the window hidden.
    auto hwnd_res = wv_.window();
    if (hwnd_res.ok()) {
        HWND hwnd = static_cast<HWND>(hwnd_res.value());
        wv_.dispatch([hwnd]() {
            ShowWindow(hwnd, SW_SHOW);
            SetForegroundWindow(hwnd);
        });
    }
#endif
    wv_.resolve(seq, 0, json{{"ok", true}}.dump());
}
