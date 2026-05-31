#include "dispatch.hpp"
#include "window_win.hpp"
#include "../src/fileops.hpp"
#include "../src/config.hpp"
#include "../src/search.hpp"
#include "../src/sysinfo.hpp"
#include "../src/preview.hpp"
#include "../src/session.hpp"
#include "../src/pack.hpp"
#include "../src/updater.hpp"
#include "../src/base64.hpp"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

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
static constexpr const char* kHostVersion = "1.0.0";

// ── Constructor / Destructor ──────────────────────────────────────────────────

Dispatcher::Dispatcher(webview::webview& wv) : wv_(wv) {
    Config::instance().load();
}

Dispatcher::~Dispatcher() {
    // Stop all terminal sessions before shutdown
    std::vector<std::unique_ptr<Terminal>> to_stop;
    {
        std::lock_guard<std::mutex> lk(terminals_mu_);
        for (auto& kv : terminals_) to_stop.push_back(std::move(kv.second));
        terminals_.clear();
    }
    // Stop outside lock to avoid deadlock with reader callbacks
    to_stop.clear();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

void Dispatcher::resolve_ok(const std::string& seq, const json& data) {
    json r = {{"ok", true}, {"data", data}};
    wv_.resolve(seq, 0, r.dump());
}

void Dispatcher::resolve_err(const std::string& seq, const std::string& error) {
    json r = {{"ok", false}, {"error", error}};
    wv_.resolve(seq, 0, r.dump());
}

void Dispatcher::emit(const std::string& event, const json& data) {
    std::string js = "if(window.__cmdide_emit){window.__cmdide_emit('" +
                     event + "'," + data.dump() + ")}";
    wv_.dispatch([this, js] { wv_.eval(js); });
}

// Delegate to old-style dispatch functions.
// Strips type/id fields from resp and returns {ok, data} envelope.
json Dispatcher::old_to_new(const std::string& type,
                            const json& args,
                            const std::string& req_id) {
    // Build old-style message: merge type + id into args
    json msg = args;
    msg["type"] = type;
    msg["id"]   = req_id;

    json resp;
    bool handled =
        fileops::dispatch(type, msg, req_id, resp)  ||
        config_dispatch(type, msg, req_id, resp)     ||
        search_ops::dispatch(type, msg, req_id, resp)||
        sysinfo_ops::dispatch(type, msg, req_id, resp)||
        preview_ops::dispatch(type, msg, req_id, resp)||
        session_ops::dispatch(type, msg, req_id, resp)||
        pack_ops::dispatch(type, msg, req_id, resp)  ||
        updater_ops::dispatch(type, msg, req_id, resp);

    if (!handled) {
        return {{"ok", false}, {"error", "not yet implemented: " + type}};
    }

    resp.erase("type");
    resp.erase("id");

    // If backend signalled ok:false, propagate the error
    if (resp.contains("ok") && resp["ok"].is_boolean() && !resp["ok"].get<bool>()) {
        std::string err = resp.value("error", "backend error");
        return {{"ok", false}, {"error", err}};
    }

    return {{"ok", true}, {"data", resp}};
}

// ── Public dispatch entry-point ───────────────────────────────────────────────

void Dispatcher::dispatch(const std::string& seq,
                          const std::string& type,
                          const std::string& args) {
    spdlog::info("IPC: type={}", type);

    // Handle synchronous/simple types immediately on caller thread
    if (type == "ping") {
        resolve_ok(seq, "pong");
        return;
    }
    if (type == "debug.version" || type == "debug.status") {
        resolve_ok(seq, kHostVersion);
        return;
    }
    if (type == "app.ready") {
        if (splash_) splash_->Close();
        resolve_ok(seq, true);
        return;
    }
    if (type == "shutdown") {
        resolve_ok(seq, true);
        wv_.dispatch([this] { wv_.terminate(); });
        return;
    }

    // All other types run on a detached worker thread (may block for I/O, CPU sampling, etc.)
    std::thread([this, seq, type, args]() {
        try {
            json args_json = args.empty() ? json::object()
                                          : json::parse(args);
            dispatch_worker(seq, type, args_json);
        } catch (const std::exception& e) {
            spdlog::error("IPC dispatch error: type={} error={}", type, e.what());
            resolve_err(seq, std::string("dispatch error: ") + e.what());
        }
    }).detach();
}

// ── Worker ────────────────────────────────────────────────────────────────────

void Dispatcher::dispatch_worker(const std::string& seq,
                                 const std::string& type,
                                 const json& args) {
    const std::string req_id = seq; // use seq as the backend request id

    // ── Terminal ──────────────────────────────────────────────────────────────
    if (type == "terminal.start") {
        std::string id    = args.value("id",    std::string{});
        std::string shell = args.value("shell", std::string{});
        std::string cwd   = args.value("cwd",   std::string{});
        int cols = args.value("cols", 80);
        int rows = args.value("rows", 24);

        auto on_output = [this](const std::string& tid, const std::string& b64) {
            emit("terminal.output", {{"id", tid}, {"data", b64}});
        };
        auto on_exit = [this](const std::string& tid, int code) {
            spdlog::info("terminal.exit id={} code={}", tid, code);
            emit("terminal.exit", {{"id", tid}, {"code", code}});
        };

        auto t  = std::make_unique<Terminal>(id, on_output, on_exit);
        bool ok = t->Start(shell, cwd, cols, rows);
        {
            std::lock_guard<std::mutex> lk(terminals_mu_);
            if (ok) terminals_[id] = std::move(t);
        }
        resolve_ok(seq, {{"ok", ok}});
        return;
    }

    if (type == "terminal.input") {
        std::string id   = args.value("id",   std::string{});
        std::string data = args.value("data", std::string{});
        // Frontend sends raw text; base64-encode before passing to Terminal::Write
        std::string b64 = base64::encode(data);
        std::lock_guard<std::mutex> lk(terminals_mu_);
        auto it = terminals_.find(id);
        if (it != terminals_.end()) it->second->Write(b64);
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.resize") {
        std::string id = args.value("id",   std::string{});
        int cols = args.value("cols", 80);
        int rows = args.value("rows", 24);
        std::lock_guard<std::mutex> lk(terminals_mu_);
        auto it = terminals_.find(id);
        if (it != terminals_.end()) it->second->Resize(cols, rows);
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.interrupt") {
        std::string id = args.value("id", std::string{});
        std::lock_guard<std::mutex> lk(terminals_mu_);
        auto it = terminals_.find(id);
        if (it != terminals_.end()) it->second->Interrupt();
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.stop") {
        std::string id = args.value("id", std::string{});
        std::unique_ptr<Terminal> t;
        {
            std::lock_guard<std::mutex> lk(terminals_mu_);
            auto it = terminals_.find(id);
            if (it != terminals_.end()) {
                t = std::move(it->second);
                terminals_.erase(it);
            }
        }
        if (t) t->Stop(); // blocks briefly to join reader thread
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.list") {
        std::vector<std::string> ids;
        {
            std::lock_guard<std::mutex> lk(terminals_mu_);
            for (auto& kv : terminals_) ids.push_back(kv.first);
        }
        resolve_ok(seq, ids);
        return;
    }

    if (type == "terminal.cwd" || type == "terminal.setcwd" || type == "terminal.setalignment") {
        // Not directly supported by ConPTY; resolve OK with no-op
        resolve_ok(seq, true);
        return;
    }

    // ── Window management ─────────────────────────────────────────────────────
    if (type.rfind("window.", 0) == 0) {
#ifdef _WIN32
        auto hwnd_res = wv_.window();
        HWND hwnd = hwnd_res.ok() ? static_cast<HWND>(hwnd_res.value()) : nullptr;

        if (type == "window.setTitle") {
            auto title = args.value("title", std::string{});
            wv_.dispatch([this, title] { wv_.set_title(title); });
            resolve_ok(seq, true);
        } else if (type == "window.minimise" && hwnd) {
            wv_.dispatch([hwnd] { ShowWindow(hwnd, SW_MINIMIZE); });
            resolve_ok(seq, true);
        } else if (type == "window.maximise" && hwnd) {
            wv_.dispatch([hwnd] { ShowWindow(hwnd, SW_MAXIMIZE); });
            resolve_ok(seq, true);
        } else if (type == "window.unmaximise" && hwnd) {
            wv_.dispatch([hwnd] { ShowWindow(hwnd, SW_RESTORE); });
            resolve_ok(seq, true);
        } else if (type == "window.toggleMaximise" && hwnd) {
            bool zoomed = IsZoomed(hwnd);
            wv_.dispatch([hwnd, zoomed] {
                ShowWindow(hwnd, zoomed ? SW_RESTORE : SW_MAXIMIZE);
            });
            resolve_ok(seq, true);
        } else if (type == "window.isMaximised") {
            resolve_ok(seq, hwnd ? (bool)IsZoomed(hwnd) : false);
        } else if (type == "window.isMinimised") {
            resolve_ok(seq, hwnd ? (bool)IsIconic(hwnd) : false);
        } else if (type == "window.close") {
            resolve_ok(seq, true);
            wv_.dispatch([this] { wv_.terminate(); });
        } else if (type == "window.setDragRects") {
            auto rects_json = args.value("rects", json::array());
            std::vector<DragRect> rects;
            for (auto& r : rects_json) {
                rects.push_back({
                    r.value("x", 0), r.value("y", 0),
                    r.value("w", 0), r.value("h", 0)
                });
            }
            if (hwnd) SetDragRects(hwnd, rects);
            resolve_ok(seq, true);
        } else if (type == "window.new") {
            // Launch a new instance of this exe
            wchar_t exe[MAX_PATH];
            GetModuleFileNameW(nullptr, exe, MAX_PATH);
            ShellExecuteW(nullptr, L"open", exe, nullptr, nullptr, SW_SHOWNORMAL);
            resolve_ok(seq, true);
        } else if (type == "window.fullscreen" && hwnd) {
            // Simple fullscreen via ShowWindow
            wv_.dispatch([hwnd] { ShowWindow(hwnd, SW_MAXIMIZE); });
            resolve_ok(seq, true);
        } else if (type == "window.unfullscreen" && hwnd) {
            wv_.dispatch([hwnd] { ShowWindow(hwnd, SW_RESTORE); });
            resolve_ok(seq, true);
        } else if (type == "window.isFullscreen") {
            resolve_ok(seq, hwnd ? (bool)IsZoomed(hwnd) : false);
        } else if (type == "window.centre" && hwnd) {
            RECT r{};
            GetWindowRect(hwnd, &r);
            int w = r.right - r.left, h = r.bottom - r.top;
            int sw = GetSystemMetrics(SM_CXSCREEN);
            int sh = GetSystemMetrics(SM_CYSCREEN);
            wv_.dispatch([hwnd, sw, sh, w, h] {
                SetWindowPos(hwnd, nullptr,
                    (sw - w) / 2, (sh - h) / 2, w, h,
                    SWP_NOZORDER | SWP_NOSIZE);
            });
            resolve_ok(seq, true);
        } else if (type == "window.setSize") {
            int width  = args.value("width",  1280);
            int height = args.value("height", 800);
            wv_.dispatch([this, width, height] {
                wv_.set_size(width, height, WEBVIEW_HINT_NONE);
            });
            resolve_ok(seq, true);
        } else if (type == "window.getSize" && hwnd) {
            RECT r{};
            GetClientRect(hwnd, &r);
            resolve_ok(seq, {{"w", r.right - r.left}, {"h", r.bottom - r.top}});
        } else if (type == "window.setPosition" && hwnd) {
            int x = args.value("x", 0), y = args.value("y", 0);
            wv_.dispatch([hwnd, x, y] {
                SetWindowPos(hwnd, nullptr, x, y, 0, 0, SWP_NOZORDER | SWP_NOSIZE);
            });
            resolve_ok(seq, true);
        } else if (type == "window.getPosition" && hwnd) {
            RECT r{};
            GetWindowRect(hwnd, &r);
            resolve_ok(seq, {{"x", r.left}, {"y", r.top}});
        } else if (type == "window.alwaysOnTop" && hwnd) {
            bool on_top = args.value("value", false);
            HWND insert = on_top ? HWND_TOPMOST : HWND_NOTOPMOST;
            wv_.dispatch([hwnd, insert] {
                SetWindowPos(hwnd, insert, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            });
            resolve_ok(seq, true);
        } else {
            resolve_ok(seq, true); // no-op for other window.*
        }
#else
        resolve_ok(seq, true); // platform-specific window management in Phase J/K
#endif
        return;
    }

    // ── Shell operations ──────────────────────────────────────────────────────
    if (type.rfind("shell.", 0) == 0) {
#ifdef _WIN32
        if (type == "shell.openUrl") {
            auto url = args.value("url", std::string{});
            std::wstring wurl(url.begin(), url.end());
            ShellExecuteW(nullptr, L"open", wurl.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            resolve_ok(seq, true);
        } else if (type == "shell.reveal") {
            auto path = args.value("path", std::string{});
            std::wstring wpath(path.begin(), path.end());
            std::wstring cmd = L"/select,\"" + wpath + L"\"";
            ShellExecuteW(nullptr, L"open", L"explorer.exe", cmd.c_str(), nullptr, SW_SHOWNORMAL);
            resolve_ok(seq, true);
        } else if (type == "shell.selectdir") {
            // Show folder browser dialog — must run on main thread
            std::string result;
            bool done = false;
            wv_.dispatch([this, seq, &result, &done]() {
                BROWSEINFOW bi{};
                bi.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
                PIDLIST_ABSOLUTE pidl = SHBrowseForFolderW(&bi);
                if (pidl) {
                    wchar_t path[MAX_PATH];
                    if (SHGetPathFromIDListW(pidl, path)) {
                        int n = WideCharToMultiByte(CP_UTF8, 0, path, -1, nullptr, 0, nullptr, nullptr);
                        std::string utf8(n - 1, '\0');
                        WideCharToMultiByte(CP_UTF8, 0, path, -1, utf8.data(), n, nullptr, nullptr);
                        resolve_ok(seq, utf8);
                    } else {
                        resolve_ok(seq, std::string{});
                    }
                    CoTaskMemFree(pidl);
                } else {
                    resolve_ok(seq, std::string{});
                }
            });
        } else if (type == "shell.exec") {
            auto cmd  = args.value("cmd",  std::string{});
            auto dir  = args.value("dir",  std::string{});
            auto a    = args.value("args", std::vector<std::string>{});
            // Build full command line
            std::string full = cmd;
            for (auto& arg : a) full += " " + arg;
            // Run via cmd.exe and capture output
            std::string output;
            std::string cd_cmd = dir.empty() ? "" : "cd /d \"" + dir + "\" && ";
            std::string pipe_cmd = "cmd.exe /c " + cd_cmd + full + " 2>&1";
            FILE* f = _popen(pipe_cmd.c_str(), "r");
            if (f) {
                char buf[1024];
                while (fgets(buf, sizeof(buf), f)) output += buf;
                _pclose(f);
            }
            resolve_ok(seq, output);
        } else if (type == "shell.ctrlclick") {
            auto path = args.value("path", std::string{});
            // Open the path with the default handler
            std::wstring wpath(path.begin(), path.end());
            ShellExecuteW(nullptr, L"open", wpath.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            resolve_ok(seq, true);
        } else {
            resolve_ok(seq, true);
        }
#else
        resolve_ok(seq, true); // Unix shell ops in Phase K
#endif
        return;
    }

    // ── Clipboard ─────────────────────────────────────────────────────────────
    if (type == "clipboard.get") {
#ifdef _WIN32
        wv_.dispatch([this, seq]() {
            if (!OpenClipboard(nullptr)) { resolve_ok(seq, std::string{}); return; }
            HANDLE h = GetClipboardData(CF_UNICODETEXT);
            if (!h) { CloseClipboard(); resolve_ok(seq, std::string{}); return; }
            auto* wptr = static_cast<wchar_t*>(GlobalLock(h));
            std::string result;
            if (wptr) {
                int n = WideCharToMultiByte(CP_UTF8, 0, wptr, -1, nullptr, 0, nullptr, nullptr);
                result.resize(n - 1);
                WideCharToMultiByte(CP_UTF8, 0, wptr, -1, result.data(), n, nullptr, nullptr);
                GlobalUnlock(h);
            }
            CloseClipboard();
            resolve_ok(seq, result);
        });
#else
        resolve_ok(seq, std::string{});
#endif
        return;
    }

    if (type == "clipboard.set") {
#ifdef _WIN32
        auto text = args.value("text", std::string{});
        wv_.dispatch([this, seq, text]() {
            int n = MultiByteToWideChar(CP_UTF8, 0, text.data(), (int)text.size(), nullptr, 0);
            std::wstring wtext(n, L'\0');
            MultiByteToWideChar(CP_UTF8, 0, text.data(), (int)text.size(), wtext.data(), n);
            if (OpenClipboard(nullptr)) {
                EmptyClipboard();
                HGLOBAL hmem = GlobalAlloc(GMEM_MOVEABLE, (wtext.size() + 1) * sizeof(wchar_t));
                if (hmem) {
                    auto* dst = static_cast<wchar_t*>(GlobalLock(hmem));
                    if (dst) {
                        memcpy(dst, wtext.data(), (wtext.size() + 1) * sizeof(wchar_t));
                        GlobalUnlock(hmem);
                        SetClipboardData(CF_UNICODETEXT, hmem);
                    }
                }
                CloseClipboard();
            }
            resolve_ok(seq, true);
        });
#else
        resolve_ok(seq, true);
#endif
        return;
    }

    // ── File language detection ───────────────────────────────────────────────
    if (type == "fs.language") {
        auto path = args.value("path", std::string{});
        resolve_ok(seq, fileops::detect_language(path));
        return;
    }

    // ── Perf monitor start/stop (sysinfo polling managed by frontend) ─────────
    if (type == "sysinfo.perf.start" || type == "sysinfo.perf.stop") {
        resolve_ok(seq, true); // Frontend polls sysinfo.perf directly
        return;
    }

    // ── Database (stub — future implementation) ───────────────────────────────
    if (type == "db.read") {
        resolve_ok(seq, json::object());
        return;
    }

    // ── Plugin fetch (stub) ───────────────────────────────────────────────────
    if (type == "plugin.fetch") {
        resolve_err(seq, "plugin.fetch not yet implemented");
        return;
    }

    // ── Problems scan (stub) ──────────────────────────────────────────────────
    if (type == "problems.scan") {
        resolve_ok(seq, json::object());
        return;
    }

    // ── Delegate to backend dispatch modules ──────────────────────────────────
    json result = old_to_new(type, args, req_id);
    wv_.resolve(seq, 0, result.dump());
}
