// httplib.h must precede windows.h — it includes winsock2.h first, which is
// required when WIN32_LEAN_AND_MEAN is defined (our CMakeLists compile def).
#include <httplib.h>

#include <cmark.h>

#include <windows.h> // already pulled in by httplib.h, but explicit for clarity

#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>

#include "preview.hpp"

using json = nlohmann::json;

namespace preview_ops {

namespace {

// ─── Helpers ──────────────────────────────────────────────────────────────────

// UTF-8 string → fs::path-compatible wstring for Win32 file APIs.
static std::wstring to_wpath(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

static std::string lower_ext(const std::string& path) {
    auto dot = path.rfind('.');
    if (dot == std::string::npos) return "";
    std::string ext = path.substr(dot);
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return (char)std::tolower(c); });
    return ext;
}

static std::string mime_for(const std::string& ext) {
    static const std::unordered_map<std::string, std::string> kMap = {
        {".html", "text/html; charset=utf-8"},
        {".htm",  "text/html; charset=utf-8"},
        {".css",  "text/css; charset=utf-8"},
        {".js",   "application/javascript; charset=utf-8"},
        {".mjs",  "application/javascript; charset=utf-8"},
        {".json", "application/json; charset=utf-8"},
        {".xml",  "application/xml; charset=utf-8"},
        {".txt",  "text/plain; charset=utf-8"},
        {".svg",  "image/svg+xml"},
        {".png",  "image/png"},
        {".jpg",  "image/jpeg"},
        {".jpeg", "image/jpeg"},
        {".gif",  "image/gif"},
        {".ico",  "image/x-icon"},
        {".webp", "image/webp"},
        {".woff", "font/woff"},
        {".woff2","font/woff2"},
        {".ttf",  "font/ttf"},
        {".mp4",  "video/mp4"},
        {".mp3",  "audio/mpeg"},
        {".pdf",  "application/pdf"},
    };
    auto it = kMap.find(ext);
    return it != kMap.end() ? it->second : "application/octet-stream";
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

static const char kMdShellHead[] =
    "<!DOCTYPE html><html lang=\"en\"><head>"
    "<meta charset=\"UTF-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<style>"
    "body{background:#1e1e1e;color:#d4d4d4;"
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
    "max-width:860px;margin:0 auto;padding:2rem 2.5rem;line-height:1.7}"
    "h1,h2,h3,h4,h5,h6{color:#e8e8e8;border-bottom:1px solid #3a3a3a;padding-bottom:.3em;margin-top:1.5em}"
    "a{color:#4fc3f7}a:hover{color:#81d4fa}"
    "code{background:#2d2d2d;border-radius:3px;padding:.15em .4em;font-size:90%}"
    "pre{background:#2d2d2d;border-radius:5px;padding:1em;overflow-x:auto}"
    "pre code{background:none;padding:0;font-size:inherit}"
    "blockquote{border-left:4px solid #4fc3f7;margin:0;padding:.5em 1em;color:#9e9e9e}"
    "table{border-collapse:collapse;width:100%;margin:1em 0}"
    "th,td{border:1px solid #3a3a3a;padding:.5em 1em;text-align:left}"
    "th{background:#2d2d2d}"
    "hr{border:none;border-top:1px solid #3a3a3a;margin:1.5em 0}"
    "img{max-width:100%;border-radius:4px}"
    "</style></head><body><div class=\"md\">";
static const char kMdShellTail[] = "</div></body></html>";

static std::string render_markdown(const std::string& path_utf8) {
    // Read file
    std::ifstream f(to_wpath(path_utf8), std::ios::binary);
    if (!f) return "";
    std::string md((std::istreambuf_iterator<char>(f)), {});

    // cmark → HTML fragment
    char* html_raw = cmark_markdown_to_html(md.data(), md.size(), CMARK_OPT_DEFAULT);
    if (!html_raw) return "";
    std::string html_fragment(html_raw);
    free(html_raw);

    return std::string(kMdShellHead) + html_fragment + kMdShellTail;
}

// ─── Singleton HTTP server ────────────────────────────────────────────────────

struct PreviewServer {
    std::unique_ptr<httplib::Server> svr;
    std::thread               thread_;
    int                       port_ = 0;
    bool                      running_ = false;
    std::mutex                mu_;

    // Converts a URL path segment to an absolute Windows file path.
    // URL path for Windows: "/C:/Users/x/file.html" → "C:\Users\x\file.html"
    static std::string url_to_fspath(std::string url_path) {
        // Strip leading '/'
        if (!url_path.empty() && url_path[0] == '/') url_path.erase(0, 1);
        // Forward slashes to backslashes (Windows)
        for (char& c : url_path) if (c == '/') c = '\\';
        return url_path;
    }

    // Register GET handler and return the httplib::Server (fully configured).
    std::unique_ptr<httplib::Server> make_server() {
        auto s = std::make_unique<httplib::Server>();

        s->Get("/(.*)", [](const httplib::Request& req, httplib::Response& res) {
            std::string fspath = url_to_fspath(req.path);
            if (fspath.empty() || fspath.size() < 3) { // must have at least "C:\"
                res.status = 404; return;
            }

            // Basic path sanity check: must be absolute (drive letter on Windows)
            bool is_abs = fspath.size() >= 3 && fspath[1] == ':' &&
                          (fspath[2] == '\\' || fspath[2] == '/');
            if (!is_abs) { res.status = 404; return; }

            // Canonicalise and check for path traversal
            std::wstring wpath = to_wpath(fspath);
            wchar_t canon[MAX_PATH] = {};
            if (!GetFullPathNameW(wpath.c_str(), MAX_PATH, canon, nullptr)) {
                res.status = 404; return;
            }

            // Markdown → rendered HTML
            std::string ext = lower_ext(fspath);
            if (ext == ".md" || ext == ".markdown") {
                // Convert canonicalised wpath back to UTF-8 for reading
                int n = WideCharToMultiByte(CP_UTF8, 0, canon, -1, nullptr, 0, nullptr, nullptr);
                std::string canon_utf8(n > 0 ? n - 1 : 0, '\0');
                WideCharToMultiByte(CP_UTF8, 0, canon, -1, canon_utf8.data(), n, nullptr, nullptr);
                std::string html = render_markdown(canon_utf8);
                if (html.empty()) { res.status = 404; return; }
                res.set_content(html, "text/html; charset=utf-8");
                return;
            }

            // Binary / text file — read and serve
            std::ifstream f(canon, std::ios::binary);
            if (!f) { res.status = 404; return; }
            std::string body((std::istreambuf_iterator<char>(f)), {});
            res.set_content(body, mime_for(ext).c_str());
        });

        return s;
    }

    // Start the server; returns true if already running or successfully started.
    bool start() {
        std::lock_guard<std::mutex> lk(mu_);
        if (running_) return true;

        svr = make_server();
        int p = svr->bind_to_any_port("127.0.0.1");
        if (p <= 0) {
            spdlog::error("[preview] bind_to_any_port failed");
            svr.reset();
            return false;
        }
        port_ = p;
        running_ = true;

        thread_ = std::thread([this]() {
            svr->listen_after_bind();
            // listen_after_bind() returns only when stop() is called.
        });
        spdlog::info("[preview] server listening on 127.0.0.1:{}", port_);
        return true;
    }

    // Stop the server and join the listener thread.
    void stop() {
        httplib::Server* raw = nullptr;
        {
            std::lock_guard<std::mutex> lk(mu_);
            if (!running_ || !svr) return;
            raw = svr.get();
        }
        raw->stop(); // signals listen_after_bind() to return

        // Join outside the lock so the listener thread can finish cleanly.
        if (thread_.joinable()) thread_.join();

        std::lock_guard<std::mutex> lk(mu_);
        svr.reset();
        running_ = false;
        port_ = 0;
        spdlog::info("[preview] server stopped");
    }

    std::string base_url() const {
        std::lock_guard<std::mutex> lk(const_cast<std::mutex&>(mu_));
        if (!running_ || port_ <= 0) return "";
        return "http://127.0.0.1:" + std::to_string(port_);
    }

    bool is_running() const {
        std::lock_guard<std::mutex> lk(const_cast<std::mutex&>(mu_));
        return running_;
    }
};

static PreviewServer g_server;

} // namespace

// ─── IPC dispatch ─────────────────────────────────────────────────────────────

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    if (type == "preview.start") {
        bool ok = g_server.start();
        std::string url = g_server.base_url();
        reply({{"url", url}, {"ok", ok}});
        return true;
    }
    if (type == "preview.stop") {
        g_server.stop();
        reply({{"ok", true}});
        return true;
    }
    if (type == "preview.status") {
        bool running = g_server.is_running();
        reply({{"running", running}, {"url", g_server.base_url()}});
        return true;
    }
    return false;
}

} // namespace preview_ops
