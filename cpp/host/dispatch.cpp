#include "dispatch.hpp"
#ifdef _WIN32
#include "window_win.hpp"
#endif
#include "../src/fileops.hpp"
#include "../src/config.hpp"
#include "../src/search.hpp"
#include "../src/sysinfo.hpp"
#include "../src/preview.hpp"
#include "../src/session.hpp"
#include "../src/pack.hpp"
#include "../src/updater.hpp"
#include "../src/git.hpp"
#include "../src/workflows.hpp"
#include "../src/workflow_runner.hpp"
#include "../src/base64.hpp"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <sqlite3.h>

#include <string>
#include <thread>
#include <filesystem>
#include <deque>
#include <fstream>
#include <vector>
#include <map>
#include <set>
#include <algorithm>
#include <ctime>
#include <cstdint>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#else
#include <sys/wait.h>
#endif

using json = nlohmann::json;
namespace fs = std::filesystem;
static constexpr const char* kHostVersion = "1.0.0";

#ifdef _WIN32
static std::wstring dispatch_to_wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}
#endif

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
    wv_.resolve(seq, 0, r.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace));
}

void Dispatcher::resolve_err(const std::string& seq, const std::string& error) {
    json r = {{"ok", false}, {"error", error}};
    wv_.resolve(seq, 0, r.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace));
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
        updater_ops::dispatch(type, msg, req_id, resp)||
        git_ops::dispatch(type, msg, req_id, resp)  ||
        workflows_ops::dispatch(type, msg, req_id, resp);

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
#ifdef _WIN32
        if (splash_) splash_->Close();
        // Show the main window now that content is ready — it was hidden in
        // MakeFrameless to prevent the OS-decorated flash during WebView2 init.
        {
            auto hwnd_res = wv_.window();
            if (hwnd_res.ok()) {
                HWND hwnd = static_cast<HWND>(hwnd_res.value());
                wv_.dispatch([hwnd]() {
                    ShowWindow(hwnd, SW_SHOW);
                    SetForegroundWindow(hwnd);
                });
            }
        }
#endif
        resolve_ok(seq, true);
        return;
    }
    if (type == "shutdown") {
        resolve_ok(seq, true);
        wv_.dispatch([this] { wv_.terminate(); });
        return;
    }

    // ── window.startDrag must be handled synchronously on the UI thread ──────────
    // The IPC binding callback runs on the main UI thread.  Handling startDrag
    // here (before the worker-thread spawn below) means PostMessage(SC_MOVE) is
    // enqueued immediately — by the time the binding callback returns and the
    // message loop resumes, SC_MOVE is already queued so the OS drag loop starts
    // without the extra thread-hop latency that used to drop fast drag gestures.
    if (type == "window.startDrag") {
#ifdef _WIN32
        auto hwnd_res = wv_.window();
        if (hwnd_res.ok()) {
            HWND hwnd = static_cast<HWND>(hwnd_res.value());
            POINT pt;
            GetCursorPos(&pt);
            ReleaseCapture();
            // SC_MOVE | 0x0002 = mouse-initiated move (low nibble != 0)
            PostMessage(hwnd, WM_SYSCOMMAND, SC_MOVE | 0x0002,
                        MAKELPARAM(pt.x, pt.y));
        }
#endif
        resolve_ok(seq, true);
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
        std::string id  = args.value("id",  std::string{});
        std::string cwd = args.value("cwd", std::string{});

        // Resolve starting directory
        if (cwd.empty())
            cwd = Config::instance().get().value("default_directory", std::string{});
        if (cwd.empty()) {
            try { cwd = fs::current_path().string(); } catch (...) {}
        }
        if (cwd.empty()) cwd = "C:\\";

        {
            std::string alignment = args.value("alignment", std::string{"default"});
            std::lock_guard<std::mutex> lk(sessions_mu_);
            term_sessions_[id].cwd = cwd;
            // Only set alignment if not already written by a concurrent setalignment call
            if (term_sessions_[id].alignment.empty() ||
                term_sessions_[id].alignment == "default")
                term_sessions_[id].alignment = alignment;
        }
        emit_prompt(id, cwd, 0);
        resolve_ok(seq, {{"ok", true}});
        return;
    }

    // terminal.execute — run a command in the session's CWD, handle slash commands
    if (type == "terminal.execute") {
        std::string id  = args.value("id",  std::string{});
        std::string cmd = args.value("cmd", std::string{});

        // Trim whitespace
        while (!cmd.empty() && (cmd.front()==' '||cmd.front()=='\t'||
                                 cmd.front()=='\r'||cmd.front()=='\n'))
            cmd.erase(cmd.begin());
        while (!cmd.empty() && (cmd.back()==' '||cmd.back()=='\t'||
                                 cmd.back()=='\r'||cmd.back()=='\n'))
            cmd.pop_back();

        // Get session CWD (create on demand)
        std::string cwd;
        {
            std::lock_guard<std::mutex> lk(sessions_mu_);
            auto it = term_sessions_.find(id);
            if (it == term_sessions_.end()) {
                try { cwd = fs::current_path().string(); } catch (...) { cwd = "C:\\"; }
                term_sessions_[id] = {cwd};
            } else {
                cwd = it->second.cwd;
            }
        }

        if (cmd.empty()) {
            emit_prompt(id, cwd, 0);
            resolve_ok(seq, true);
            return;
        }

        // ── Slash commands ────────────────────────────────────────────────────
        if (cmd[0] == '/') {
            std::string rest = cmd.substr(1);
            std::string name;
            std::string slash_args;
            {
                auto sp = rest.find(' ');
                name = (sp == std::string::npos) ? rest : rest.substr(0, sp);
                slash_args = (sp == std::string::npos) ? "" : rest.substr(sp + 1);
            }
            for (char& c : name) c = (char)tolower((unsigned char)c);

            if (name == "config") {
                emit("app:open-config", json({{"terminalId", id}}));
            } else if (name == "themes") {
                emit("terminal:output:" + id, json(std::string(
                    "\r\nAvailable themes: dark  minimal  dracula  nord  solarized-dark"
                    "  solarized-light  monokai  tokyo-night  catppuccin-mocha  one-dark\r\n")));
            } else if (name == "preview") {
                if (!slash_args.empty())
                    emit("app:open-preview", json({{"type","url"},{"url",slash_args},
                                                    {"path",slash_args},{"terminalId",id}}));
            } else if (name == "problems") {
                emit("app:open-problems", json({{"cwd",cwd},{"terminalId",id},
                                                {"sources",json::array()},{"items",json::array()}}));
            } else if (name == "debug") {
                std::string info = "\r\ncmdIDE v" + std::string(kHostVersion) + " (C++ host)\r\n";
                info += "CWD: " + cwd + "\r\n";
#ifdef _WIN32
                char comp[256]={}; DWORD sz=256;
                GetComputerNameA(comp,&sz);
                info += "Host: " + std::string(comp) + "\r\n";
#endif
                emit("terminal:output:" + id, json(info));
            } else if (name == "kill") {
                if (!slash_args.empty()) {
                    json kill_args={{"port",slash_args}};
                    json kill_resp; std::string dummy=seq;
                    sysinfo_ops::dispatch("sysinfo.ports.kill", kill_args, dummy, kill_resp);
                    auto res = kill_resp.value("result", std::string{});
                    if (!res.empty()) emit("terminal:output:" + id, json("\r\n" + res + "\r\n"));
                }
            } else if (name == "explorer") {
#ifdef _WIN32
                ShellExecuteW(nullptr, L"open", dispatch_to_wide(cwd).c_str(),
                              nullptr, nullptr, SW_SHOWNORMAL);
#endif
            } else if (name == "ports") {
                emit("app:open-tab", json({{"type","ports"},{"title","ports"},{"terminalId",id}}));
            } else if (name == "performance") {
                emit("app:open-tab", json({{"type","perf"},{"title","performance"},{"terminalId",id}}));
            } else if (name == "fullscreen" || name == "fs") {
                emit("app:open-tab", json({{"type","fullscreen"},{"title","explorer"},
                                           {"terminalId",id},{"cwd",cwd}}));
            } else if (name == "plugins") {
                emit("app:open-tab", json({{"type","plugins"},{"title","plugins"},{"terminalId",id}}));
            } else if (name == "pack") {
                json pack_args={{"path",cwd},{"dry_run",false}};
                json pack_resp; std::string dummy2=seq;
                pack_ops::dispatch("pack.zip", pack_args, dummy2, pack_resp);
            } else if (name == "uptime") {
#ifdef _WIN32
                ULONGLONG ms = GetTickCount64();
                unsigned long long s=ms/1000, d=s/86400; s%=86400;
                unsigned long long h=s/3600; s%=3600; unsigned long long m=s/60; s%=60;
                char buf[128]; snprintf(buf,sizeof(buf),"\r\nUptime: %llud %lluh %llum %llus\r\n",d,h,m,s);
                emit("terminal:output:" + id, json(std::string(buf)));
#endif
            } else if (name == "lang-map") {
                std::string target = slash_args.empty() ? cwd : slash_args;
                if (!fs::path(target).is_absolute())
                    try { target = fs::weakly_canonical(fs::path(cwd) / target).string(); } catch (...) {}

                static const std::map<std::string,const char*> kExtLang = {
                    {".go","Go"},{".ts","TypeScript"},{".tsx","TypeScript"},
                    {".js","JavaScript"},{".jsx","JavaScript"},{".mjs","JavaScript"},{".cjs","JavaScript"},
                    {".py","Python"},{".rs","Rust"},{".java","Java"},
                    {".cpp","C++"},{".cc","C++"},{".cxx","C++"},{".hpp","C++"},{".c","C"},{".h","C"},
                    {".cs","C#"},{".rb","Ruby"},{".php","PHP"},{".swift","Swift"},
                    {".kt","Kotlin"},{".kts","Kotlin"},{".scala","Scala"},
                    {".sh","Shell"},{".bash","Shell"},{".zsh","Shell"},{".fish","Shell"},
                    {".ps1","PowerShell"},{".sql","SQL"},{".html","HTML"},{".htm","HTML"},
                    {".vue","Vue"},{".svelte","Svelte"},
                    {".css","CSS"},{".scss","CSS"},{".less","CSS"},
                    {".lua","Lua"},{".r","R"},{".dart","Dart"},
                    {".ex","Elixir"},{".exs","Elixir"},{".tf","HCL"},{".hcl","HCL"},
                    {".proto","Protobuf"},{".graphql","GraphQL"},{".gql","GraphQL"},
                };
                static const std::map<std::string,const char*> kLangColor = {
                    {"Go","\x1b[38;5;81m"},{"TypeScript","\x1b[38;5;68m"},
                    {"JavaScript","\x1b[38;5;220m"},{"Python","\x1b[38;5;33m"},
                    {"Rust","\x1b[38;5;180m"},{"C","\x1b[38;5;240m"},{"C++","\x1b[38;5;204m"},
                    {"C#","\x1b[38;5;34m"},{"Java","\x1b[38;5;130m"},{"Ruby","\x1b[38;5;124m"},
                    {"PHP","\x1b[38;5;97m"},{"Swift","\x1b[38;5;208m"},{"Kotlin","\x1b[38;5;141m"},
                    {"Scala","\x1b[38;5;160m"},{"Shell","\x1b[38;5;112m"},{"PowerShell","\x1b[38;5;68m"},
                    {"HTML","\x1b[38;5;166m"},{"CSS","\x1b[38;5;55m"},{"Vue","\x1b[38;5;71m"},
                    {"Svelte","\x1b[38;5;202m"},{"SQL","\x1b[38;5;215m"},{"Lua","\x1b[38;5;18m"},
                    {"R","\x1b[38;5;26m"},{"Dart","\x1b[38;5;37m"},{"Elixir","\x1b[38;5;97m"},
                    {"HCL","\x1b[38;5;97m"},{"GraphQL","\x1b[38;5;205m"},{"Protobuf","\x1b[38;5;246m"},
                };
                static const std::set<std::string> kSkipDirs = {
                    "node_modules",".git",".svn",".hg","dist","build",".next","__pycache__",
                    "vendor","target",".cache","coverage",".angular",".turbo",".gradle",
                    "out",".idea",".vscode",
                };

                auto fmt_bytes = [](int64_t b) -> std::string {
                    char buf[32];
                    if      (b < 1024LL)              snprintf(buf,sizeof(buf),"%lld B",  (long long)b);
                    else if (b < 1024LL*1024)         snprintf(buf,sizeof(buf),"%.1f KB", b/1024.0);
                    else if (b < 1024LL*1024*1024)    snprintf(buf,sizeof(buf),"%.1f MB", b/(1024.0*1024));
                    else                              snprintf(buf,sizeof(buf),"%.1f GB", b/(1024.0*1024*1024));
                    return buf;
                };

                struct LStat { int64_t bytes = 0; int files = 0; };
                std::map<std::string, LStat> counts;
                int64_t total_bytes = 0;

                try {
                    fs::recursive_directory_iterator it(
                        target, fs::directory_options::skip_permission_denied);
                    for (; it != fs::recursive_directory_iterator(); ++it) {
                        auto fname = it->path().filename().string();
                        if (it->is_directory()) {
                            if (!fname.empty() && (fname[0]=='.' || kSkipDirs.count(fname)))
                                it.disable_recursion_pending();
                            continue;
                        }
                        if (!it->is_regular_file()) continue;
                        if (!fname.empty() && fname[0] == '.') continue;
                        std::string ext = it->path().extension().string();
                        for (char& c : ext) c = (char)tolower((unsigned char)c);
                        auto lit = kExtLang.find(ext);
                        if (lit == kExtLang.end()) continue;
                        std::error_code fec;
                        auto fsize = fs::file_size(it->path(), fec);
                        if (fec) fsize = 0;
                        counts[lit->second].bytes += (int64_t)fsize;
                        counts[lit->second].files++;
                        total_bytes += (int64_t)fsize;
                    }
                } catch (...) {}

                if (total_bytes == 0) {
                    std::string dn = target;
                    for (char& c : dn) if (c=='\\') c='/';
                    emit("terminal:output:" + id, json(
                        "\r\n\x1b[38;5;246mNo recognized source files found in " + dn + "\x1b[0m\r\n"));
                } else {
                    struct Row { std::string lang; int64_t bytes; int files; };
                    std::vector<Row> rows;
                    rows.reserve(counts.size());
                    for (auto& [lang, s] : counts) rows.push_back({lang, s.bytes, s.files});
                    std::sort(rows.begin(), rows.end(), [](const Row& a, const Row& b){
                        return a.bytes != b.bytes ? a.bytes > b.bytes : a.lang < b.lang;
                    });

                    // Home-relative label
                    std::string label = target;
                    const char* home_env = std::getenv("USERPROFILE");
                    if (!home_env) home_env = std::getenv("HOME");
                    if (home_env) {
                        std::string h = home_env;
                        if (label.size() > h.size() && label.rfind(h, 0) == 0)
                            label = "~" + label.substr(h.size());
                    }
                    for (char& c : label) if (c=='\\') c='/';

                    // Cap at 12, roll remainder into "Other"
                    const int kMax = 12, kBarW = 26;
                    int64_t other_bytes = 0; int other_files = 0;
                    if ((int)rows.size() > kMax) {
                        for (int i = kMax; i < (int)rows.size(); i++) {
                            other_bytes += rows[i].bytes;
                            other_files += rows[i].files;
                        }
                        rows.resize(kMax);
                    }

                    size_t col = 5;
                    for (auto& r : rows) if (r.lang.size() > col) col = r.lang.size();

                    std::string out = "\r\n\x1b[38;5;75mLanguage breakdown\x1b[0m  \x1b[38;5;246m"
                                    + label + "\x1b[0m\r\n\r\n";

                    auto write_row = [&](const std::string& lang, const char* color,
                                         int64_t bytes, int files) {
                        double pct = (double)bytes / (double)total_bytes * 100.0;
                        int filled = (int)(pct / 100.0 * kBarW + 0.5);
                        if (filled < 1 && bytes > 0) filled = 1;
                        if (filled > kBarW) filled = kBarW;
                        std::string bar;
                        for (int i = 0; i < filled;       i++) bar += "\xe2\x96\x88"; // █
                        for (int i = filled; i < kBarW;   i++) bar += "\xe2\x96\x91"; // ░
                        const char* fw = (files == 1) ? "file" : "files";
                        char buf[640];
                        snprintf(buf, sizeof(buf),
                            "  %s%-*s\x1b[0m  %s%s\x1b[0m  %5.1f%%  \x1b[38;5;246m%d %s  %s\x1b[0m\r\n",
                            color, (int)col, lang.c_str(),
                            color, bar.c_str(),
                            pct, files, fw, fmt_bytes(bytes).c_str());
                        out += buf;
                    };

                    for (auto& r : rows) {
                        const char* color = "\x1b[38;5;246m";
                        auto cit = kLangColor.find(r.lang);
                        if (cit != kLangColor.end()) color = cit->second;
                        write_row(r.lang, color, r.bytes, r.files);
                    }
                    if (other_bytes > 0)
                        write_row("Other", "\x1b[38;5;240m", other_bytes, other_files);

                    out += "\r\n  \x1b[38;5;246mTotal  " + fmt_bytes(total_bytes) + "\x1b[0m\r\n";
                    emit("terminal:output:" + id, json(out));
                }
            } else if (name == "version") {
                emit("terminal:output:" + id, json(
                    "\r\ncmdIDE v" + std::string(kHostVersion) + " (C++ WebView host)\r\n"));
            } else if (name == "help") {
                emit("terminal:output:" + id, json(std::string(
                    "\r\nBuilt-in commands:\r\n"
                    "  /config           open settings & theme UI\r\n"
                    "  /themes           list available themes\r\n"
                    "  /preview <url>    preview a URL or file\r\n"
                    "  /problems         show project diagnostics\r\n"
                    "  /debug            show debug info\r\n"
                    "  /kill <port>      kill process on a port\r\n"
                    "  /explorer         open native file explorer\r\n"
                    "  /pack             zip current directory\r\n"
                    "  /ports            open ports monitor tab\r\n"
                    "  /performance      open performance monitor tab\r\n"
                    "  /fullscreen /fs   open fullscreen IDE explorer\r\n"
                    "  /plugins          open plugin store\r\n"
                    "  /uptime           show system uptime\r\n"
                    "  /version          show version info\r\n"
                    "  /help             show this help\r\n")));
            } else {
                emit("terminal:output:" + id, json(
                    "\r\n\x1b[31mUnknown command: /" + name + "\x1b[0m\r\n"));
            }
            emit_prompt(id, cwd, 0);
            resolve_ok(seq, true);
            return;
        }

        // ── Built-in shell commands ───────────────────────────────────────────
        std::string lower = cmd;
        for (char& c : lower) c = (char)tolower((unsigned char)c);

        if (lower == "cls" || lower == "clear") {
            emit("terminal:output:" + id, json(std::string("\x1b[2J\x1b[H\r\nCleared successfully\r\n")));
            emit_prompt(id, cwd, 0);
            resolve_ok(seq, true);
            return;
        }
        if (lower == "exit") {
            emit("terminal:output:" + id, json(std::string(
                "\r\n\x1b[33m[close the tab to exit]\x1b[0m\r\n")));
            emit_prompt(id, cwd, 0);
            resolve_ok(seq, true);
            return;
        }

        // cd command — track CWD in session
        bool is_cd = (lower == "cd") ||
                     (lower.size() > 2 && lower[0]=='c' && lower[1]=='d' &&
                      (lower[2]==' ' || lower[2]=='\t'));
        if (is_cd) {
            std::string path_part = cmd.size() > 3 ? cmd.substr(3) : "";
            while (!path_part.empty() && (path_part.front()==' '||path_part.front()=='\t'))
                path_part.erase(path_part.begin());
            while (!path_part.empty() && (path_part.back()==' '||path_part.back()=='\t'))
                path_part.pop_back();

            std::string new_cwd;
            try {
                if (path_part.empty() || path_part == "~") {
                    const char* home = std::getenv("USERPROFILE");
                    if (!home) home = std::getenv("HOME");
                    new_cwd = home ? home : cwd;
                } else {
                    fs::path p = path_part;
                    if (!p.is_absolute()) p = fs::path(cwd) / p;
                    p = fs::weakly_canonical(p);
                    if (fs::is_directory(p)) {
                        new_cwd = p.string();
                    } else {
                        emit("terminal:output:" + id, json(std::string(
                            "\r\n\x1b[31mThe system cannot find the path specified.\x1b[0m\r\n")));
                        emit_prompt(id, cwd, 1);
                        resolve_ok(seq, true);
                        return;
                    }
                }
            } catch (const std::exception& e) {
                emit("terminal:output:" + id, json(
                    std::string("\r\n\x1b[31mcd: ") + e.what() + "\x1b[0m\r\n"));
                emit_prompt(id, cwd, 1);
                resolve_ok(seq, true);
                return;
            }
            {
                std::lock_guard<std::mutex> lk(sessions_mu_);
                auto it = term_sessions_.find(id);
                if (it != term_sessions_.end()) it->second.cwd = new_cwd;
            }
            cwd = new_cwd;
            emit("terminal:cwd:" + id, json(cwd));
            emit("terminal:output:" + id, json("\r\nPath changed to " + new_cwd + "\r\n"));
            emit_prompt(id, cwd, 0);
            resolve_ok(seq, true);
            return;
        }

        // ── ls — built-in directory listing with Unix-style multi-column output ──
        if (lower == "ls" || (lower.size() >= 3 && lower[0]=='l' && lower[1]=='s' &&
                              (lower.size() == 2 || lower[2]==' '))) {
            std::string list_path = cwd;
            bool show_hidden = false;

            // Parse flags and optional path argument
            if (cmd.size() > 3) {
                std::string rest = cmd.substr(3);
                while (!rest.empty() && rest.front() == ' ') rest.erase(rest.begin());
                // Tokenise
                std::string tok;
                auto flush_tok = [&]() {
                    if (tok.empty()) return;
                    if (tok[0] == '-') {
                        if (tok.find('a') != std::string::npos) show_hidden = true;
                    } else {
                        fs::path p = tok;
                        if (!p.is_absolute()) p = fs::path(cwd) / p;
                        try { list_path = fs::weakly_canonical(p).string(); } catch (...) {}
                    }
                    tok.clear();
                };
                for (char c : rest) { if (c == ' ') flush_tok(); else tok += c; }
                flush_tok();
            }

            // Collect entries
            struct Entry { std::string name; bool is_dir; };
            std::vector<Entry> entries;
            try {
                for (auto& e : fs::directory_iterator(list_path,
                        fs::directory_options::skip_permission_denied)) {
                    auto name = e.path().filename().string();
                    if (!show_hidden && !name.empty() && name[0] == '.') continue;
                    entries.push_back({name, e.is_directory()});
                }
            } catch (...) {}

            // Sort: dirs first, then case-insensitive alpha
            std::sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b) {
                if (a.is_dir != b.is_dir) return a.is_dir > b.is_dir;
                std::string al = a.name, bl = b.name;
                for (char& c : al) c = (char)tolower((unsigned char)c);
                for (char& c : bl) c = (char)tolower((unsigned char)c);
                return al < bl;
            });

            if (entries.empty()) {
                emit("terminal:output:" + id, json(std::string("\r\n")));
                emit_prompt(id, cwd, 0);
                resolve_ok(seq, true);
                return;
            }

            // Display names include the trailing "/" for directories
            std::vector<std::string> labels;
            labels.reserve(entries.size());
            for (auto& e : entries) labels.push_back(e.name + (e.is_dir ? "/" : ""));

            // Multi-column layout: column width = longest label + 2 spaces
            size_t max_len = 0;
            for (auto& l : labels) if (l.size() > max_len) max_len = l.size();
            size_t col_w = max_len + 2;
            size_t term_w = 80;
            size_t ncols = std::max<size_t>(1, term_w / col_w);
            size_t n = labels.size();
            size_t nrows = (n + ncols - 1) / ncols;

            // Fill column-major (like Unix ls)
            std::string output = "\r\n";
            for (size_t row = 0; row < nrows; ++row) {
                for (size_t col = 0; col < ncols; ++col) {
                    size_t idx = col * nrows + row;
                    if (idx >= n) break;
                    const auto& label = labels[idx];
                    bool last = (col == ncols - 1) || ((col + 1) * nrows + row >= n);
                    if (entries[idx].is_dir)
                        output += "\x1b[34m" + label + "\x1b[0m";
                    else
                        output += label;
                    if (!last) {
                        size_t pad = col_w - label.size();
                        output.append(pad, ' ');
                    }
                }
                output += "\r\n";
            }

            emit("terminal:output:" + id, json(output));
            emit_prompt(id, cwd, 0);
            resolve_ok(seq, true);
            return;
        }

        // ── open — open file/dir with system default app ──────────────────────
        if (lower == "open" || (lower.size() >= 5 && lower.substr(0, 5) == "open ")) {
            std::string target = cmd.size() > 5 ? cmd.substr(5) : cwd;
            while (!target.empty() && target.front() == ' ') target.erase(target.begin());
            while (!target.empty() && target.back() == ' ') target.pop_back();
            if (target.empty()) target = cwd;
            if (!fs::path(target).is_absolute()) {
                try { target = fs::weakly_canonical(fs::path(cwd) / target).string(); } catch (...) {}
            }
#ifdef _WIN32
            ShellExecuteW(nullptr, L"open", dispatch_to_wide(target).c_str(),
                          nullptr, nullptr, SW_SHOWNORMAL);
#else
            system(("xdg-open \"" + target + "\" &").c_str());
#endif
            emit("terminal:output:" + id, json(std::string("\r\n")));
            emit_prompt(id, cwd, 0);
            resolve_ok(seq, true);
            return;
        }

        // Regular command — run via shell, stream output
        // ── Unix-path normalisation & PowerShell script detection ────────────────
        // cmd.exe doesn't understand ./ (Unix-style current-dir prefix).
        // Normalise it to .\ so file associations and relative paths work.
        {
            std::string norm = cmd;
            for (char& c : norm) if (c == '/') c = '\\';
            // ".ps1" files need to be run via PowerShell — cmd.exe won't execute them.
            // Match: [./\]?anything.ps1 [args]
            auto first_ws = norm.find_first_of(" \t");
            std::string prog  = (first_ws == std::string::npos) ? norm : norm.substr(0, first_ws);
            std::string pargs = (first_ws == std::string::npos) ? "" : norm.substr(first_ws);
            std::string prog_l = prog;
            for (char& c : prog_l) c = (char)tolower((unsigned char)c);
            if (prog_l.size() > 4 && prog_l.compare(prog_l.size()-4, 4, ".ps1") == 0) {
                // Strip leading .\ so PowerShell resolves it relative to cwd
                if (prog.size() > 2 && prog[0]=='.' && prog[1]=='\\') prog = prog.substr(2);
                cmd = "powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + prog + "\"" + pargs;
            } else {
                cmd = norm;  // just apply the / -> \ normalisation
            }
        }

        int exitCode = run_command(id, cmd, cwd);
        emit_prompt(id, cwd, exitCode);
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.input") {
        // Raw PTY input (only used when a ConPTY session is active for interactive programs)
        std::string id   = args.value("id",   std::string{});
        std::string data = args.value("data", std::string{});
        std::string b64  = base64::encode(data);
        std::lock_guard<std::mutex> lk(terminals_mu_);
        auto it = terminals_.find(id);
        if (it != terminals_.end()) it->second->Write(b64);
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.resize") {
        std::string id = args.value("id", std::string{});
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
        {
            std::lock_guard<std::mutex> lk(terminals_mu_);
            auto it = terminals_.find(id);
            if (it != terminals_.end()) { it->second->Interrupt(); }
        }
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.stop") {
        std::string id = args.value("id", std::string{});
        {
            std::lock_guard<std::mutex> lk(sessions_mu_);
            term_sessions_.erase(id);
        }
        std::unique_ptr<Terminal> t;
        {
            std::lock_guard<std::mutex> lk(terminals_mu_);
            auto it = terminals_.find(id);
            if (it != terminals_.end()) { t = std::move(it->second); terminals_.erase(it); }
        }
        if (t) t->Stop();
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.list") {
        std::vector<std::string> ids;
        {
            std::lock_guard<std::mutex> lk(sessions_mu_);
            for (auto& kv : term_sessions_) ids.push_back(kv.first);
        }
        resolve_ok(seq, ids);
        return;
    }

    if (type == "terminal.cwd") {
        std::string id = args.value("id", std::string{});
        std::string cwd;
        {
            std::lock_guard<std::mutex> lk(sessions_mu_);
            auto it = term_sessions_.find(id);
            if (it != term_sessions_.end()) cwd = it->second.cwd;
        }
        resolve_ok(seq, cwd);
        return;
    }

    if (type == "terminal.setcwd") {
        std::string id  = args.value("id",  std::string{});
        std::string cwd = args.value("cwd", std::string{});

        std::string new_cwd = cwd;
        try {
            fs::path p = fs::weakly_canonical(fs::path(cwd));
            if (fs::is_directory(p)) new_cwd = p.string();
        } catch (const std::exception&) {}

        {
            std::lock_guard<std::mutex> lk(sessions_mu_);
            auto it = term_sessions_.find(id);
            if (it != term_sessions_.end()) it->second.cwd = new_cwd;
        }
        emit_prompt(id, new_cwd, 0);
        resolve_ok(seq, true);
        return;
    }

    if (type == "terminal.setalignment") {
        std::string id        = args.value("id",        std::string{});
        std::string alignment = args.value("alignment", std::string{"default"});
        {
            std::lock_guard<std::mutex> lk(sessions_mu_);
            term_sessions_[id].alignment = alignment;  // create if not yet started
        }
        resolve_ok(seq, true);
        return;
    }

    // ── Workflows: run/stop a workflow locally via the native runner ─────────────
    if (type == "workflows.run") {
        std::string path  = args.value("path",  std::string{});
        std::string file  = args.value("file",  std::string{});
        std::string runId = args.value("runId", std::string{});
        workflow_runner::run_workflow(path, file, runId,
            [this](const std::string& event, const json& data) { emit(event, data); });
        resolve_ok(seq, true);
        return;
    }

    if (type == "workflows.stop") {
        std::string runId = args.value("runId", std::string{});
        workflow_runner::stop_workflow(runId);
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
            // Use PostMessage SC_MINIMIZE so Windows plays the native OS animation
            wv_.dispatch([hwnd] {
                PostMessage(hwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0);
            });
            resolve_ok(seq, true);
        } else if (type == "window.maximise" && hwnd) {
            wv_.dispatch([hwnd] {
                PostMessage(hwnd, WM_SYSCOMMAND, SC_MAXIMIZE, 0);
            });
            resolve_ok(seq, true);
        } else if (type == "window.unmaximise" && hwnd) {
            wv_.dispatch([hwnd] {
                PostMessage(hwnd, WM_SYSCOMMAND, SC_RESTORE, 0);
            });
            resolve_ok(seq, true);
        } else if (type == "window.toggleMaximise" && hwnd) {
            bool zoomed = IsZoomed(hwnd);
            wv_.dispatch([hwnd, zoomed] {
                PostMessage(hwnd, WM_SYSCOMMAND,
                            zoomed ? SC_RESTORE : SC_MAXIMIZE, 0);
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
            auto tabId = args.value("tabId", std::string{});
            auto path  = args.value("path",  std::string{});
            // Resolve relative paths using the session's cwd
            if (!path.empty() && !fs::path(path).is_absolute()) {
                std::string cwd;
                {
                    std::lock_guard<std::mutex> lk(sessions_mu_);
                    auto it = term_sessions_.find(tabId);
                    if (it != term_sessions_.end()) cwd = it->second.cwd;
                }
                if (!cwd.empty()) {
                    try { path = (fs::path(cwd) / path).string(); } catch (...) {}
                }
            }
            bool exists = false;
            bool isDir  = false;
            try {
                exists = fs::exists(path);
                if (exists) isDir = fs::is_directory(path);
            } catch (...) {}
            json result = {
                {"resolved", path},
                {"isDir",    isDir},
                {"exists",   exists},
            };
            resolve_ok(seq, result);
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

    // ── Database read (SQLite) ────────────────────────────────────────────────
    if (type == "db.read") {
        std::string db_path = args.value("path", args.value("key", std::string{}));
        if (db_path.empty()) {
            resolve_err(seq, "db.read: no path specified");
            return;
        }

        std::string captured_seq  = seq;
        std::string captured_path = db_path;
        auto* d = this;

        std::thread([d, captured_seq, captured_path]() {
            sqlite3* db = nullptr;
            int rc = sqlite3_open_v2(captured_path.c_str(), &db,
                                     SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nullptr);
            if (rc != SQLITE_OK) {
                std::string err = db ? sqlite3_errmsg(db) : "cannot open database";
                if (db) sqlite3_close(db);
                d->resolve_err(captured_seq, "Cannot open database: " + err);
                return;
            }

            // Enumerate user tables (skip sqlite_ internals)
            std::vector<std::string> table_names;
            {
                sqlite3_stmt* stmt = nullptr;
                const char* sql =
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name NOT LIKE 'sqlite_%' "
                    "ORDER BY name";
                if (sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr) == SQLITE_OK) {
                    while (sqlite3_step(stmt) == SQLITE_ROW) {
                        const unsigned char* n = sqlite3_column_text(stmt, 0);
                        if (n) table_names.emplace_back(reinterpret_cast<const char*>(n));
                    }
                    sqlite3_finalize(stmt);
                }
            }

            json tables_arr = json::array();
            static constexpr int kRowLimit = 500;

            for (const auto& tname : table_names) {
                json tobj;
                tobj["name"] = tname;

                // Column info via PRAGMA table_info
                json cols = json::array();
                {
                    std::string sql = "PRAGMA table_info(\"" + tname + "\")";
                    sqlite3_stmt* stmt = nullptr;
                    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
                        while (sqlite3_step(stmt) == SQLITE_ROW) {
                            json col;
                            auto cn = sqlite3_column_text(stmt, 1);
                            auto ct = sqlite3_column_text(stmt, 2);
                            col["name"]    = cn ? std::string(reinterpret_cast<const char*>(cn)) : "";
                            col["type"]    = ct ? std::string(reinterpret_cast<const char*>(ct)) : "";
                            col["notnull"] = sqlite3_column_int(stmt, 3) != 0;
                            col["pk"]      = sqlite3_column_int(stmt, 5) != 0;
                            cols.push_back(col);
                        }
                        sqlite3_finalize(stmt);
                    }
                }
                tobj["columns"] = cols;

                // Row count
                int64_t row_count = 0;
                {
                    std::string sql = "SELECT COUNT(*) FROM \"" + tname + "\"";
                    sqlite3_stmt* stmt = nullptr;
                    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
                        if (sqlite3_step(stmt) == SQLITE_ROW)
                            row_count = sqlite3_column_int64(stmt, 0);
                        sqlite3_finalize(stmt);
                    }
                }
                tobj["row_count"] = row_count;

                // Rows (capped at kRowLimit)
                json rows = json::array();
                {
                    std::string sql = "SELECT * FROM \"" + tname + "\" LIMIT " +
                                      std::to_string(kRowLimit);
                    sqlite3_stmt* stmt = nullptr;
                    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
                        int ncols = sqlite3_column_count(stmt);
                        while (sqlite3_step(stmt) == SQLITE_ROW) {
                            json row = json::array();
                            for (int i = 0; i < ncols; ++i) {
                                switch (sqlite3_column_type(stmt, i)) {
                                    case SQLITE_NULL:
                                        row.push_back(nullptr);
                                        break;
                                    case SQLITE_INTEGER:
                                        row.push_back(sqlite3_column_int64(stmt, i));
                                        break;
                                    case SQLITE_FLOAT:
                                        row.push_back(sqlite3_column_double(stmt, i));
                                        break;
                                    default: {
                                        auto t = sqlite3_column_text(stmt, i);
                                        row.push_back(t ? std::string(
                                            reinterpret_cast<const char*>(t)) : "");
                                        break;
                                    }
                                }
                            }
                            rows.push_back(row);
                        }
                        sqlite3_finalize(stmt);
                    }
                }
                tobj["rows"] = rows;

                tables_arr.push_back(tobj);
            }

            sqlite3_close(db);
            d->resolve_ok(captured_seq, {{"tables", tables_arr}});
        }).detach();
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

    // ── CWE static analysis ───────────────────────────────────────────────────
    if (type == "problems.cwe") {
        std::string scan_path = args.value("path", std::string{});
        if (scan_path.empty()) {
            try { scan_path = fs::current_path().string(); } catch (...) { scan_path = "."; }
        }

        std::string captured_seq  = seq;
        std::string captured_path = scan_path;
        auto* d = this;

        std::thread([d, captured_seq, captured_path]() {
          try {
            struct CwePattern {
                const char* cwe_id;
                const char* name;
                const char* description;
                const char* severity;
                const char* pattern;
                const char* extensions;
                const char* mitre_url;
                const char* remediation;
            };

            static const CwePattern kPatterns[] = {
                {"CWE-120", "Buffer Copy without Checking Size of Input",
                 "The program copies an input buffer to a destination without verifying the destination is large enough.",
                 "high", "strcpy(", ".c,.cpp,.h,.hpp",
                 "https://cwe.mitre.org/data/definitions/120.html",
                 "Replace strcpy() with strncpy() or strlcpy(). Always validate that the destination buffer is large enough before copying."},
                {"CWE-120", "Unbounded Input via gets()",
                 "gets() reads an unbounded amount of input and is inherently unsafe — use fgets() instead.",
                 "critical", "gets(", ".c,.cpp,.h,.hpp",
                 "https://cwe.mitre.org/data/definitions/120.html",
                 "Replace gets() with fgets(buf, sizeof(buf), stdin). gets() has no bounds checking and is removed from C11."},
                {"CWE-134", "Use of Externally-Controlled Format String",
                 "sprintf() with a variable format argument can be exploited to write to arbitrary memory locations.",
                 "high", "sprintf(", ".c,.cpp,.h,.hpp",
                 "https://cwe.mitre.org/data/definitions/134.html",
                 "Use snprintf() instead of sprintf(). Never pass a variable as the format string \xe2\x80\x94 always use a literal format: snprintf(buf, sizeof(buf), \"%s\", input)."},
                {"CWE-78", "OS Command Injection via system()",
                 "system() constructs a shell command that may include attacker-controlled input.",
                 "critical", "system(", ".c,.cpp,.h,.hpp",
                 "https://cwe.mitre.org/data/definitions/78.html",
                 "Avoid system(). Use execve() with an explicit argv[] array to avoid shell interpretation of arguments."},
                {"CWE-78", "OS Command Injection via popen()",
                 "popen() executes a shell pipeline that may be influenced by external input.",
                 "high", "popen(", ".c,.cpp,.h,.hpp",
                 "https://cwe.mitre.org/data/definitions/78.html",
                 "Validate and sanitize all input before passing to popen(). Prefer subprocess with explicit argument lists."},
                {"CWE-95", "Improper Neutralization of Eval Input",
                 "eval() executes code from a string. If the string contains attacker-controlled data, arbitrary code execution is possible.",
                 "high", "eval(", ".js,.ts,.jsx,.tsx,.mjs,.cjs",
                 "https://cwe.mitre.org/data/definitions/95.html",
                 "Avoid eval() entirely. Use JSON.parse() for data, or a safe expression evaluator. If eval is required, run it in a sandboxed context."},
                {"CWE-79", "Cross-Site Scripting via innerHTML",
                 "Setting innerHTML from untrusted data can inject arbitrary HTML and execute scripts.",
                 "high", "innerHTML", ".js,.ts,.jsx,.tsx,.html",
                 "https://cwe.mitre.org/data/definitions/79.html",
                 "Use textContent instead of innerHTML when inserting text. When HTML is needed, sanitize with DOMPurify before assignment."},
                {"CWE-79", "Cross-Site Scripting via document.write()",
                 "document.write() injects raw HTML into the page and is considered unsafe.",
                 "medium", "document.write(", ".js,.ts,.jsx,.tsx,.html",
                 "https://cwe.mitre.org/data/definitions/79.html",
                 "Avoid document.write(). Manipulate the DOM using createElement() and appendChild() instead."},
                {"CWE-79", "XSS via dangerouslySetInnerHTML",
                 "React's dangerouslySetInnerHTML bypasses XSS protections — ensure the value is sanitized.",
                 "medium", "dangerouslySetInnerHTML", ".jsx,.tsx",
                 "https://cwe.mitre.org/data/definitions/79.html",
                 "Always sanitize HTML with DOMPurify before passing to dangerouslySetInnerHTML. Consider using a dedicated rich-text component."},
                {"CWE-89", "SQL Injection Pattern",
                 "A SELECT query appears to be constructed inline. Prefer parameterized queries or prepared statements.",
                 "critical", "SELECT * FROM", ".js,.ts,.jsx,.tsx,.py,.go,.java,.php",
                 "https://cwe.mitre.org/data/definitions/89.html",
                 "Use parameterized queries or prepared statements. Never concatenate user input into SQL strings directly."},
                {"CWE-502", "Deserialization of Untrusted Data",
                 "JSON.parse() on untrusted input may lead to prototype pollution. Validate schema before use.",
                 "medium", "JSON.parse(", ".js,.ts,.jsx,.tsx",
                 "https://cwe.mitre.org/data/definitions/502.html",
                 "Validate JSON structure against a schema (e.g. zod, ajv) after parsing. Consider using JSON.parse() with a reviver function."},
                {"CWE-78", "OS Command Injection via os.system()",
                 "os.system() executes a shell command. Prefer subprocess with shell=False and explicit argument lists.",
                 "critical", "os.system(", ".py",
                 "https://cwe.mitre.org/data/definitions/78.html",
                 "Replace os.system() with subprocess.run() using a list of arguments (shell=False). This prevents shell injection."},
                {"CWE-502", "Insecure Deserialization via pickle",
                 "pickle.loads() deserializes arbitrary Python objects and can execute arbitrary code.",
                 "critical", "pickle.loads(", ".py",
                 "https://cwe.mitre.org/data/definitions/502.html",
                 "Never unpickle data from untrusted sources. Use json.loads() for data exchange, or cryptographically sign pickle data."},
            };
            static const size_t kPatternCount = sizeof(kPatterns) / sizeof(kPatterns[0]);

            static const std::set<std::string> kSkipDirs = {
                "node_modules", ".git", ".svn", "dist", "build",
                "out", ".next", "target", "vendor", "__pycache__",
            };
            static constexpr size_t kMaxFileSize = 2 * 1024 * 1024;
            static constexpr size_t kMaxFindings = 200;

            json results = json::array();
            try {
                for (auto it = fs::recursive_directory_iterator(
                        captured_path,
                        fs::directory_options::skip_permission_denied);
                     it != fs::recursive_directory_iterator(); ++it) {

                    if (results.size() >= kMaxFindings) break;

                    if (it->is_directory()) {
                        if (kSkipDirs.count(it->path().filename().string()))
                            it.disable_recursion_pending();
                        continue;
                    }
                    if (!it->is_regular_file()) continue;

                    std::error_code ec;
                    auto fsize = fs::file_size(it->path(), ec);
                    if (ec || fsize > kMaxFileSize) continue;

                    std::string ext = it->path().extension().string();
                    for (char& c : ext) c = (char)tolower((unsigned char)c);

                    // Collect applicable patterns for this extension
                    std::vector<const CwePattern*> applicable;
                    for (size_t pi = 0; pi < kPatternCount; ++pi) {
                        std::string exts = kPatterns[pi].extensions;
                        size_t pos = 0;
                        while (pos < exts.size()) {
                            auto comma = exts.find(',', pos);
                            auto cand  = comma == std::string::npos
                                ? exts.substr(pos)
                                : exts.substr(pos, comma - pos);
                            if (cand == ext) { applicable.push_back(&kPatterns[pi]); break; }
                            if (comma == std::string::npos) break;
                            pos = comma + 1;
                        }
                    }
                    if (applicable.empty()) continue;

                    std::ifstream f(it->path(), std::ios::binary);
                    if (!f) continue;

                    // Buffer to hold a rolling window of lines for context
                    std::deque<std::string> lineBuffer;
                    std::string line;
                    int lineNo = 0;
                    while (std::getline(f, line) && results.size() < kMaxFindings) {
                        ++lineNo;
                        // Trim trailing \r
                        if (!line.empty() && line.back() == '\r') line.pop_back();
                        lineBuffer.push_back(line);
                        if (lineBuffer.size() > 3) lineBuffer.pop_front();

                        for (auto* pat : applicable) {
                            auto col = line.find(pat->pattern);
                            if (col == std::string::npos) continue;

                            // Collect context: up to 2 lines before (already in buffer)
                            // plus 2 lines after (read ahead)
                            std::vector<std::string> ctxLines(lineBuffer.begin(), lineBuffer.end());
                            int matchIdxInCtx = (int)ctxLines.size() - 1; // matching line is last so far
                            for (int ai = 0; ai < 2; ++ai) {
                                std::string after;
                                if (std::getline(f, after)) {
                                    if (!after.empty() && after.back() == '\r') after.pop_back();
                                    ctxLines.push_back(after);
                                    lineBuffer.push_back(after);
                                    if (lineBuffer.size() > 3) lineBuffer.pop_front();
                                    ++lineNo;
                                }
                            }

                            // Build multi-line snippet (trim leading whitespace per line)
                            std::string snippet;
                            for (size_t si = 0; si < ctxLines.size(); ++si) {
                                const std::string& sl = ctxLines[si];
                                size_t sp = sl.find_first_not_of(" \t");
                                std::string trimmed = (sp != std::string::npos) ? sl.substr(sp) : sl;
                                if (trimmed.size() > 120) trimmed = trimmed.substr(0, 120) + "...";
                                if (si > 0) snippet += "\n";
                                snippet += trimmed;
                            }

                            json item;
                            item["cwe_id"]      = pat->cwe_id;
                            item["name"]        = pat->name;
                            item["description"] = pat->description;
                            item["severity"]    = pat->severity;
                            item["file"]        = it->path().u8string();
                            item["line"]        = lineNo - (int)(ctxLines.size() - 1 - matchIdxInCtx);
                            item["col"]         = (int)(col + 1);
                            item["snippet"]     = snippet;
                            item["snippet_match_idx"] = matchIdxInCtx;
                            item["mitre_url"]   = pat->mitre_url;
                            item["remediation"] = pat->remediation;
                            results.push_back(std::move(item));
                            break;
                        }
                    }
                }
            } catch (...) {}

            d->resolve_ok(captured_seq, results);
          } catch (const std::exception& e) {
            d->resolve_err(captured_seq, std::string("cwe scan error: ") + e.what());
          } catch (...) {
            d->resolve_err(captured_seq, "cwe scan error");
          }
        }).detach();
        return;
    }

    // ── Completions (intercept before old_to_new to resolve paths via session cwd) ──
    if (type == "complete.path") {
        std::string tabId  = args.value("tabId",  std::string{});
        std::string dir    = args.value("dir",    std::string{});
        std::string prefix = args.value("prefix", std::string{});

        std::string cwd;
        {
            std::lock_guard<std::mutex> lk(sessions_mu_);
            auto it = term_sessions_.find(tabId);
            if (it != term_sessions_.end()) cwd = it->second.cwd;
        }
        if (cwd.empty()) {
            try { cwd = fs::current_path().string(); } catch (...) { cwd = "C:\\"; }
        }

        json search_msg = {{"cwd", cwd}, {"dir", dir}, {"prefix", prefix}};
        json resp;
        search_ops::dispatch("complete.path", search_msg, req_id, resp);
        resolve_ok(seq, resp.value("completions", json::array()));
        return;
    }

    // ── search.files — resolve terminal-session ID → CWD, then search ─────────
    // The shim passes the active terminal's session ID as "path". Detect it and
    // swap it for the session's real CWD so the backend gets a filesystem path.
    // Returns the results array directly (not wrapped in {results:[...]}).
    if (type == "search.files") {
        std::string path  = args.value("path",  args.value("root", std::string{}));
        std::string query = args.value("query", std::string{});

        // If path looks like a terminal session ID ("tab-N"), resolve it to CWD.
        if (!path.empty() && path.rfind("tab-", 0) == 0) {
            std::lock_guard<std::mutex> lk(sessions_mu_);
            auto it = term_sessions_.find(path);
            if (it != term_sessions_.end()) path = it->second.cwd;
            else path.clear();
        }
        if (path.empty()) {
            try { path = fs::current_path().string(); } catch (...) { path = "C:\\"; }
        }

        json search_msg = {{"path", path}, {"query", query}, {"maxResults", 50}};
        search_msg["type"] = "search.files";
        search_msg["id"]   = req_id;
        json resp;
        search_ops::dispatch("search.files", search_msg, req_id, resp);
        resolve_ok(seq, resp.value("results", json::array()));
        return;
    }

    // ── Delegate to backend dispatch modules ──────────────────────────────────
    json result = old_to_new(type, args, req_id);
    wv_.resolve(seq, 0, result.dump());
}

// ── Terminal helper implementations ──────────────────────────────────────────

std::string Dispatcher::get_git_branch(const std::string& dir) {
    try {
        fs::path p = dir;
        for (int i = 0; i < 20; i++) {
            auto head = p / ".git" / "HEAD";
            std::error_code ec;
            if (fs::exists(head, ec)) {
                std::ifstream f(head);
                if (!f) return "";
                std::string line;
                std::getline(f, line);
                const char prefix[] = "ref: refs/heads/";
                if (line.rfind(prefix, 0) == 0) return line.substr(sizeof(prefix) - 1);
                if (line.size() >= 7) return line.substr(0, 7);
                return "";
            }
            auto parent = p.parent_path();
            if (parent == p) break;
            p = parent;
        }
    } catch (...) {}
    return "";
}

std::string Dispatcher::format_cwd(const std::string& cwd, bool minimal) {
    // Normalise to forward slashes for display
    std::string norm = cwd;
    for (char& c : norm) if (c == '\\') c = '/';
    while (norm.size() > 1 && norm.back() == '/') norm.pop_back();

    if (!minimal) return norm;

    // Show last two path components when minimal_pwd is set
    std::vector<std::string> parts;
    std::string seg;
    for (char c : norm) {
        if (c == '/') { if (!seg.empty()) { parts.push_back(seg); seg.clear(); } }
        else { seg += c; }
    }
    if (!seg.empty()) parts.push_back(seg);
    if (parts.size() <= 2) return norm;
    return parts[parts.size()-2] + "/" + parts.back();
}

void Dispatcher::emit_prompt(const std::string& id, const std::string& cwd, int exitCode) {
    auto cfg      = Config::instance().get();
    bool minimal     = cfg.value("minimal_pwd", false);
    bool show_ts     = cfg.value("show_timestamps", false);
    bool show_git    = false;
    if (cfg.contains("git_recognition"))
        show_git = cfg["git_recognition"].value("show_git_branch", false);

    std::string display = format_cwd(cwd, minimal);
    std::string branch  = show_git ? get_git_branch(cwd) : "";

    std::string ts_str;
    if (show_ts) {
        char ts_buf[12] = {};
        std::time_t now = std::time(nullptr);
        std::tm* tm_info = std::localtime(&now);
        if (tm_info) std::strftime(ts_buf, sizeof(ts_buf), "%H:%M:%S", tm_info);
        ts_str = ts_buf;
    }

    emit("terminal:bar-prompt:" + id,
         json({{"path", display}, {"branch", branch}, {"ts", ts_str}, {"exitCode", exitCode}}));

    // Always notify the frontend of the updated CWD
    emit("terminal:cwd:" + id, json(cwd));

    // The frontend renders its own block header (branch/path/timestamp/exit status),
    // so the raw output stream just needs a line break between commands.
    emit("terminal:output:" + id, json(std::string("\r\n")));
}

int Dispatcher::run_command(const std::string& id,
                             const std::string& cmd,
                             const std::string& cwd) {
#ifdef _WIN32
    SECURITY_ATTRIBUTES sa{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE hrd = INVALID_HANDLE_VALUE, hwr = INVALID_HANDLE_VALUE;
    if (!CreatePipe(&hrd, &hwr, &sa, 0)) {
        emit("terminal:output:" + id, json(std::string("\r\n\x1b[31merror: pipe failed\x1b[0m\r\n")));
        return 1;
    }
    SetHandleInformation(hrd, HANDLE_FLAG_INHERIT, 0);

    std::wstring wcmd = dispatch_to_wide("cmd.exe /d /c " + cmd);
    std::wstring wcwd = dispatch_to_wide(cwd);

    STARTUPINFOW si{sizeof(STARTUPINFOW)};
    si.dwFlags     = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    si.hStdOutput  = hwr;
    si.hStdError   = hwr;
    si.hStdInput   = INVALID_HANDLE_VALUE;

    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(nullptr, wcmd.data(), nullptr, nullptr, TRUE,
                              CREATE_NO_WINDOW, nullptr,
                              cwd.empty() ? nullptr : wcwd.data(), &si, &pi);
    CloseHandle(hwr);

    if (!ok) {
        CloseHandle(hrd);
        emit("terminal:output:" + id, json(std::string(
            "\r\n\x1b[31m'" + cmd + "' is not recognized\x1b[0m\r\n")));
        return 1;
    }

    char buf[4096];
    DWORD n;
    while (ReadFile(hrd, buf, sizeof(buf), &n, nullptr) && n > 0) {
        // Normalise lone \n → \r\n (cmd.exe output is usually \r\n already)
        std::string chunk(buf, n);
        std::string out; out.reserve(chunk.size() + 32);
        bool prev_cr = false;
        for (char c : chunk) {
            if (c == '\n' && !prev_cr) out += '\r';
            out += c;
            prev_cr = (c == '\r');
        }
        emit("terminal:output:" + id, json(out));
    }
    CloseHandle(hrd);
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return (int)exitCode;

#else
    // Unix: popen with cd to target directory
    std::string full = "cd '" + cwd + "' 2>/dev/null && " + cmd + " 2>&1";
    FILE* f = popen(full.c_str(), "r");
    if (!f) {
        emit("terminal:output:" + id, json(std::string(
            "\r\n\x1b[31merror: could not run command\x1b[0m\r\n")));
        return 1;
    }
    char buf[4096]; size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
        std::string chunk(buf, n);
        std::string out; out.reserve(chunk.size() + 32);
        bool prev_cr = false;
        for (char c : chunk) {
            if (c == '\n' && !prev_cr) out += '\r';
            out += c;
            prev_cr = (c == '\r');
        }
        emit("terminal:output:" + id, json(out));
    }
    int status = pclose(f);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
#endif
}
