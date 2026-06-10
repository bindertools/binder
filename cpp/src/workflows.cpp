#include "workflows.hpp"
#include <spdlog/spdlog.h>
#include <algorithm>
#include <fstream>
#include <map>
#include <mutex>
#include <sstream>
#include <filesystem>

#ifdef _WIN32
#  include <windows.h>
#endif

namespace workflows_ops {

using json = nlohmann::json;
namespace fs = std::filesystem;

// ── Small string helpers ──────────────────────────────────────────────────────

static std::string trim(const std::string& s) {
    auto a = s.find_first_not_of(" \t");
    if (a == std::string::npos) return {};
    auto b = s.find_last_not_of(" \t\r");
    return s.substr(a, b - a + 1);
}

static std::string strip_quotes(std::string s) {
    if (s.size() >= 2 && (s.front() == '"' || s.front() == '\'') && s.back() == s.front())
        return s.substr(1, s.size() - 2);
    return s;
}

static std::string rtrim_nl(std::string s) {
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' '))
        s.pop_back();
    return s;
}

// ── Platform process runner (capture mode) ────────────────────────────────────
// Runs `argv[0] argv[1...]` with cwd as the working directory and captures
// merged stdout+stderr. Returns code == -1 if the program could not be started.

struct RunResult { std::string out; int code = -1; };

#ifdef _WIN32
static std::wstring to_wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

static std::string win_quote(const std::string& s) {
    std::string r = "\"";
    int bs = 0;
    for (char c : s) {
        if (c == '\\')     { ++bs; }
        else if (c == '"') { r.append(bs * 2 + 1, '\\'); bs = 0; r += '"'; }
        else               { r.append(bs, '\\'); bs = 0; r += c; }
    }
    r.append(bs * 2, '\\');
    return r + "\"";
}
#else
static std::string posix_quote(const std::string& s) {
    std::string r = "'";
    for (char c : s) {
        if (c == '\'') r += "'\\''";
        else r += c;
    }
    return r + "'";
}
#endif

static RunResult run_capture(const std::string& cwd, const std::vector<std::string>& argv) {
    RunResult result;
    if (argv.empty()) return result;

#ifdef _WIN32
    std::string cmd = win_quote(argv[0]);
    for (size_t i = 1; i < argv.size(); i++) cmd += " " + win_quote(argv[i]);
    std::wstring wcmd = to_wide(cmd);
    std::wstring wcwd = to_wide(cwd);

    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE rd = INVALID_HANDLE_VALUE, wr = INVALID_HANDLE_VALUE;
    if (!CreatePipe(&rd, &wr, &sa, 0)) return result;
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si{};
    si.cb         = sizeof(si);
    si.dwFlags    = STARTF_USESTDHANDLES;
    si.hStdOutput = wr;
    si.hStdError  = wr;
    si.hStdInput  = INVALID_HANDLE_VALUE;

    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(nullptr, wcmd.data(), nullptr, nullptr, TRUE,
                             CREATE_NO_WINDOW, nullptr,
                             cwd.empty() ? nullptr : wcwd.data(), &si, &pi);
    CloseHandle(wr);
    if (!ok) { CloseHandle(rd); return result; }
    CloseHandle(pi.hThread);

    char buf[4096];
    DWORD n;
    while (ReadFile(rd, buf, sizeof(buf), &n, nullptr) && n > 0)
        result.out.append(buf, n);
    CloseHandle(rd);

    WaitForSingleObject(pi.hProcess, 30000);
    DWORD ec = 0;
    GetExitCodeProcess(pi.hProcess, &ec);
    CloseHandle(pi.hProcess);
    result.code = (int)ec;
#else
    std::string cmd = posix_quote(argv[0]);
    for (size_t i = 1; i < argv.size(); i++) cmd += " " + posix_quote(argv[i]);
    if (!cwd.empty()) cmd = "cd " + posix_quote(cwd) + " && " + cmd;
    cmd += " 2>&1";

    FILE* f = popen(cmd.c_str(), "r");
    if (!f) return result;
    char buf[4096];
    while (fgets(buf, sizeof(buf), f)) result.out += buf;
    int rc = pclose(f);
    result.code = WIFEXITED(rc) ? WEXITSTATUS(rc) : -1;
#endif

    return result;
}

// ── Workflow YAML metadata (best-effort, no full YAML parser) ────────────────

struct WorkflowMeta {
    std::string              name;
    std::vector<std::string> triggers;
};

static WorkflowMeta parse_workflow_meta(const std::string& content) {
    WorkflowMeta meta;

    std::istringstream ss(content);
    std::string line;
    bool in_on = false;
    int on_indent = -1;

    while (std::getline(ss, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.find_first_not_of(" \t") == std::string::npos) continue;

        size_t indent = line.find_first_not_of(' ');
        std::string trimmed = trim(line.substr(indent));

        if (!in_on) {
            if (indent == 0 && meta.name.empty() && trimmed.rfind("name:", 0) == 0) {
                meta.name = strip_quotes(trim(trimmed.substr(5)));
                continue;
            }
            // GitHub workflows always write the trigger key as literal "on:"
            if (indent == 0 && trimmed.rfind("on:", 0) == 0) {
                std::string rest = trim(trimmed.substr(3));
                if (rest.empty()) {
                    in_on = true;
                    on_indent = -1;
                } else if (rest.front() == '[') {
                    auto end = rest.find(']');
                    std::string inner = rest.substr(1, (end == std::string::npos ? rest.size() : end) - 1);
                    std::istringstream items(inner);
                    std::string item;
                    while (std::getline(items, item, ',')) {
                        item = strip_quotes(trim(item));
                        if (!item.empty()) meta.triggers.push_back(item);
                    }
                } else {
                    rest = strip_quotes(rest);
                    if (!rest.empty()) meta.triggers.push_back(rest);
                }
            }
            continue;
        }

        // Inside the `on:` block
        if (indent == 0) { in_on = false; continue; }
        if (on_indent == -1) on_indent = (int)indent;
        if ((int)indent < on_indent) { in_on = false; continue; }
        if ((int)indent != on_indent) continue; // skip nested config (branches:, paths:, etc.)

        if (trimmed.rfind("- ", 0) == 0 || trimmed == "-") {
            std::string item = strip_quotes(trim(trimmed.substr(1)));
            if (!item.empty()) meta.triggers.push_back(item);
        } else {
            auto colon = trimmed.find(':');
            std::string key = strip_quotes(trim(colon == std::string::npos ? trimmed : trimmed.substr(0, colon)));
            if (!key.empty()) meta.triggers.push_back(key);
        }
    }

    return meta;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };
    auto reply_err = [&](const std::string& err) {
        resp = {{"type", type + ".resp"}, {"id", id}, {"ok", false}, {"error", err}};
    };

    auto path = msg.value("path", std::string{});

    if (type == "workflows.list") {
        if (path.empty()) { reply_err("path required"); return true; }

        json list = json::array();
        std::error_code ec;
        fs::path dir = fs::path(path) / ".github" / "workflows";

        if (fs::exists(dir, ec) && fs::is_directory(dir, ec)) {
            std::vector<fs::path> files;
            for (auto& e : fs::directory_iterator(dir, fs::directory_options::skip_permission_denied, ec)) {
                if (!e.is_regular_file()) continue;
                std::string ext = e.path().extension().string();
                for (char& c : ext) c = (char)tolower((unsigned char)c);
                if (ext == ".yml" || ext == ".yaml") files.push_back(e.path());
            }
            std::sort(files.begin(), files.end());

            for (auto& f : files) {
                std::string fname = f.filename().string();
                std::string relfile = ".github/workflows/" + fname;

                std::ifstream in(f, std::ios::binary);
                std::string content((std::istreambuf_iterator<char>(in)), {});
                auto meta = parse_workflow_meta(content);

                json entry = {
                    {"file",     fname},
                    {"path",     relfile},
                    {"name",     meta.name.empty() ? fname : meta.name},
                    {"triggers", meta.triggers},
                    {"lastCommit", nullptr},
                };

                // Last commit touching this file — best-effort, from local git state.
                auto gr = run_capture(path, {"git", "log", "-1",
                    "--format=%H\x1f%an\x1f%ar\x1f%s", "--", relfile});
                if (gr.code == 0) {
                    std::string out = rtrim_nl(gr.out);
                    if (!out.empty()) {
                        std::vector<std::string> parts;
                        size_t pos = 0;
                        while (true) {
                            auto sep = out.find('\x1f', pos);
                            if (sep == std::string::npos) { parts.push_back(out.substr(pos)); break; }
                            parts.push_back(out.substr(pos, sep - pos));
                            pos = sep + 1;
                        }
                        if (parts.size() == 4) {
                            entry["lastCommit"] = {
                                {"hash",    parts[0].substr(0, 7)},
                                {"author",  parts[1]},
                                {"date",    parts[2]},
                                {"message", parts[3]},
                            };
                        }
                    }
                }

                list.push_back(std::move(entry));
            }
        }

        reply({{"workflows", list}});
        return true;
    }

    if (type == "workflows.read") {
        auto file = msg.value("file", std::string{});
        if (path.empty() || file.empty()) { reply_err("path and file required"); return true; }
        if (file.find("..") != std::string::npos ||
            file.find('/')  != std::string::npos ||
            file.find('\\') != std::string::npos) {
            reply_err("invalid workflow file");
            return true;
        }

        fs::path f = fs::path(path) / ".github" / "workflows" / file;
        std::ifstream in(f, std::ios::binary);
        if (!in) { reply_err("cannot open file"); return true; }
        std::string content((std::istreambuf_iterator<char>(in)), {});
        reply({{"content", content}, {"language", "yaml"}});
        return true;
    }

    if (type == "workflows.checkAct") {
        auto r = run_capture("", {"act", "--version"});
        if (r.code != 0) { reply({{"installed", false}, {"version", ""}}); return true; }
        reply({{"installed", true}, {"version", rtrim_nl(r.out)}});
        return true;
    }

    return false;
}

// ── Local act run (streaming) ─────────────────────────────────────────────────

#ifdef _WIN32
namespace {
std::mutex g_proc_mu;
std::map<std::string, HANDLE> g_running; // runId -> process handle
}

void run_act(const std::string& path, const std::string& file,
              const std::string& runId, const EmitFn& emit) {
    if (file.find("..") != std::string::npos ||
        file.find('/')  != std::string::npos ||
        file.find('\\') != std::string::npos) {
        emit("workflows:output:" + runId, json(std::string("\r\n\x1b[31mInvalid workflow file\x1b[0m\r\n")));
        emit("workflows:done:" + runId, json({{"code", -1}}));
        return;
    }

    std::string relfile = ".github/workflows/" + file;
    std::string cmd = win_quote("act") + " -W " + win_quote(relfile);
    std::wstring wcmd = to_wide(cmd);
    std::wstring wcwd = to_wide(path);

    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE rd = INVALID_HANDLE_VALUE, wr = INVALID_HANDLE_VALUE;
    if (!CreatePipe(&rd, &wr, &sa, 0)) {
        emit("workflows:output:" + runId, json(std::string("\r\n\x1b[31merror: pipe failed\x1b[0m\r\n")));
        emit("workflows:done:" + runId, json({{"code", -1}}));
        return;
    }
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si{};
    si.cb          = sizeof(si);
    si.dwFlags     = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    si.hStdOutput  = wr;
    si.hStdError   = wr;
    si.hStdInput   = INVALID_HANDLE_VALUE;

    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(nullptr, wcmd.data(), nullptr, nullptr, TRUE,
                             CREATE_NO_WINDOW, nullptr,
                             path.empty() ? nullptr : wcwd.data(), &si, &pi);
    CloseHandle(wr);
    if (!ok) {
        CloseHandle(rd);
        emit("workflows:output:" + runId, json(std::string(
            "\r\n\x1b[31m'act' is not installed or not on PATH\x1b[0m\r\n")));
        emit("workflows:done:" + runId, json({{"code", -1}}));
        return;
    }
    CloseHandle(pi.hThread);

    {
        std::lock_guard<std::mutex> lk(g_proc_mu);
        g_running[runId] = pi.hProcess;
    }

    char buf[4096];
    DWORD n;
    while (ReadFile(rd, buf, sizeof(buf), &n, nullptr) && n > 0) {
        std::string chunk(buf, n);
        std::string out; out.reserve(chunk.size() + 32);
        bool prev_cr = false;
        for (char c : chunk) {
            if (c == '\n' && !prev_cr) out += '\r';
            out += c;
            prev_cr = (c == '\r');
        }
        emit("workflows:output:" + runId, json(out));
    }
    CloseHandle(rd);

    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD ec = 0;
    GetExitCodeProcess(pi.hProcess, &ec);
    CloseHandle(pi.hProcess);

    {
        std::lock_guard<std::mutex> lk(g_proc_mu);
        g_running.erase(runId);
    }

    emit("workflows:done:" + runId, json({{"code", (int)ec}}));
}

void stop_act(const std::string& runId) {
    std::lock_guard<std::mutex> lk(g_proc_mu);
    auto it = g_running.find(runId);
    if (it != g_running.end()) {
        TerminateProcess(it->second, 1);
    }
}

#else

void run_act(const std::string& path, const std::string& file,
              const std::string& runId, const EmitFn& emit) {
    if (file.find("..") != std::string::npos ||
        file.find('/')  != std::string::npos ||
        file.find('\\') != std::string::npos) {
        emit("workflows:output:" + runId, json(std::string("\r\nInvalid workflow file\r\n")));
        emit("workflows:done:" + runId, json({{"code", -1}}));
        return;
    }

    std::string relfile = ".github/workflows/" + file;
    std::string cmd = "cd " + posix_quote(path) + " && act -W " + posix_quote(relfile) + " 2>&1";

    FILE* f = popen(cmd.c_str(), "r");
    if (!f) {
        emit("workflows:output:" + runId, json(std::string(
            "\r\n'act' is not installed or not on PATH\r\n")));
        emit("workflows:done:" + runId, json({{"code", -1}}));
        return;
    }
    char buf[4096]; size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
        emit("workflows:output:" + runId, json(std::string(buf, n)));
    }
    int rc = pclose(f);
    int code = WIFEXITED(rc) ? WEXITSTATUS(rc) : -1;
    emit("workflows:done:" + runId, json({{"code", code}}));
}

void stop_act(const std::string& /*runId*/) {
    // POSIX: not yet supported (popen doesn't expose the child pid here).
}

#endif

} // namespace workflows_ops
