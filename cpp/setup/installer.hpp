#pragma once
#include <nlohmann/json.hpp>
#include <webview.h>
#include <string>
#include <vector>

struct Release {
    std::string version;
    std::string name;
    std::string published_at;
    bool        prerelease    = false;
    std::string download_url;
    std::string release_notes;
};

// Handles all IPC calls for the installer window.
class InstallerApp {
public:
    explicit InstallerApp(webview::webview& wv);

    // IPC handlers — called from the __binder_invoke bind on a worker thread.
    void GetReleases(const std::string& seq);
    void GetChannel(const std::string& seq);
    void GetInstallDir(const std::string& seq);
    void Install(const std::string& seq,
                 const std::string& version,
                 bool create_desktop);
    void LaunchAndClose(const std::string& seq);
    void CloseInstaller(const std::string& seq);

private:
    void emit_progress(int pct, const std::string& msg);
    void emit_error(const std::string& msg);

    webview::webview& wv_;
    std::vector<Release> releases_cache_;
};
