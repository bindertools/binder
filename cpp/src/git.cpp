#include "git.hpp"
#include <spdlog/spdlog.h>
#include <sstream>
#include <fstream>
#include <filesystem>
#include <algorithm>

#ifdef _WIN32
#  include <windows.h>
#endif

namespace git_ops {

using json = nlohmann::json;
namespace fs = std::filesystem;

// ── Platform run helper ───────────────────────────────────────────────────────

struct RunResult {
    std::string out;
    int         code = -1;
};

#ifdef _WIN32
static std::wstring to_wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

// CommandLineToArgvW-compatible double-quote escaping
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

// Run: git -C <cwd> <args[0]> <args[1]> ...
// Captures stdout+stderr merged. Returns output and exit code.
static RunResult run_git(const std::string& cwd, const std::vector<std::string>& args) {
    RunResult result;

#ifdef _WIN32
    std::string cmd = "git " + win_quote("-C") + " " + win_quote(cwd);
    for (const auto& a : args) cmd += " " + win_quote(a);
    std::wstring wcmd = to_wide(cmd);

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
    if (!CreateProcessW(nullptr, wcmd.data(), nullptr, nullptr, TRUE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        CloseHandle(rd); CloseHandle(wr);
        return result;
    }
    CloseHandle(wr);
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
    std::string cmd = "git " + posix_quote("-C") + " " + posix_quote(cwd);
    for (const auto& a : args) cmd += " " + posix_quote(a);
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

// Trim trailing whitespace/newlines
static std::string rtrim(std::string s) {
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' '))
        s.pop_back();
    return s;
}

// ── git status parser ─────────────────────────────────────────────────────────

struct StatusResult {
    std::string branch, remote;
    int         ahead = 0, behind = 0;
    json        staged, unstaged, untracked;
};

static StatusResult parse_status(const std::string& raw) {
    StatusResult r;
    r.staged = r.unstaged = json::array();
    r.untracked = json::array();

    std::istringstream ss(raw);
    std::string line;
    bool first = true;

    while (std::getline(ss, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();

        if (first) {
            first = false;
            // "## branch...remote [ahead N, behind N]" or "## No commits yet on branch"
            if (line.size() >= 3 && line.substr(0, 3) == "## ") {
                std::string rest = line.substr(3);
                auto dots = rest.find("...");
                if (dots != std::string::npos) {
                    r.branch = rest.substr(0, dots);
                    std::string after = rest.substr(dots + 3);
                    r.remote = after.substr(0, after.find(' '));
                    auto bk = rest.find('[');
                    if (bk != std::string::npos) {
                        auto bk_end = rest.find(']', bk);
                        if (bk_end != std::string::npos) {
                            std::string inner = rest.substr(bk + 1, bk_end - bk - 1);
                            auto ap = inner.find("ahead ");
                            if (ap != std::string::npos) try { r.ahead  = std::stoi(inner.substr(ap + 6)); } catch (...) {}
                            auto bp = inner.find("behind ");
                            if (bp != std::string::npos) try { r.behind = std::stoi(inner.substr(bp + 7)); } catch (...) {}
                        }
                    }
                } else if (rest.rfind("No commits yet on ", 0) == 0) {
                    r.branch = rest.substr(18);
                } else {
                    // strip " (no branch)" suffix for detached HEAD
                    r.branch = rest.substr(0, rest.find(' '));
                }
            }
            continue;
        }

        if (line.size() < 4) continue;

        char X = line[0]; // staged status
        char Y = line[1]; // unstaged status
        std::string filename = line.substr(3);

        // Strip git's octal-quoted filenames
        if (!filename.empty() && filename.front() == '"' && filename.back() == '"')
            filename = filename.substr(1, filename.size() - 2);

        // For renames ("old -> new"), use the new name
        auto arrow = filename.find(" -> ");
        if (arrow != std::string::npos) filename = filename.substr(arrow + 4);

        if (X == '?' && Y == '?') {
            r.untracked.push_back(filename);
            continue;
        }
        if (X != ' ' && X != '?')
            r.staged.push_back({{"file", filename}, {"status", std::string(1, X)}});
        if (Y != ' ' && Y != '?')
            r.unstaged.push_back({{"file", filename}, {"status", std::string(1, Y)}});
    }

    return r;
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

    if (type == "git.status") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto r = run_git(path, {"status", "--branch", "--porcelain=v1"});
        if (r.code < 0)  { reply_err("git not found"); return true; }
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        auto s = parse_status(r.out);
        reply({{"branch", s.branch}, {"remote", s.remote},
               {"ahead", s.ahead}, {"behind", s.behind},
               {"staged", s.staged}, {"unstaged", s.unstaged},
               {"untracked", s.untracked}});
        return true;
    }

    if (type == "git.diff") {
        auto file   = msg.value("file",   std::string{});
        bool staged = msg.value("staged", false);
        if (path.empty() || file.empty()) { reply_err("path and file required"); return true; }
        std::vector<std::string> args = {"diff"};
        if (staged) args.push_back("--cached");
        args.insert(args.end(), {"--", file});
        auto r = run_git(path, args);
        reply({{"diff", r.out}});
        return true;
    }

    // Per-line change info for the editor's git gutter — all uncommitted
    // (staged + unstaged) changes to `file` relative to HEAD, as a -U0
    // unified diff. Untracked files report `untracked: true` instead, since
    // `git diff HEAD` knows nothing about them.
    if (type == "git.diff.lines") {
        auto file = msg.value("file", std::string{});
        if (path.empty() || file.empty()) { reply_err("path and file required"); return true; }
        auto st = run_git(path, {"status", "--porcelain", "--", file});
        if (st.out.size() >= 2 && st.out[0] == '?' && st.out[1] == '?') {
            reply({{"diff", ""}, {"untracked", true}});
            return true;
        }
        auto r = run_git(path, {"diff", "-U0", "HEAD", "--", file});
        reply({{"diff", r.out}, {"untracked", false}});
        return true;
    }

    if (type == "git.add") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto file = msg.value("file", std::string{});
        auto r = file.empty() ? run_git(path, {"add", "-A"})
                              : run_git(path, {"add", "--", file});
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({});
        return true;
    }

    if (type == "git.reset") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto file = msg.value("file", std::string{});
        auto r = file.empty() ? run_git(path, {"reset", "HEAD"})
                              : run_git(path, {"reset", "HEAD", "--", file});
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({});
        return true;
    }

    if (type == "git.discard") {
        auto file      = msg.value("file",      std::string{});
        bool untracked = msg.value("untracked", false);
        if (path.empty() || file.empty()) { reply_err("path and file required"); return true; }
        auto r = untracked ? run_git(path, {"clean", "-f", "--", file})
                           : run_git(path, {"checkout", "--", file});
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({});
        return true;
    }

    if (type == "git.stash") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto message = msg.value("message", std::string{});
        std::vector<std::string> args = {"stash", "push", "-u"};
        if (!message.empty()) { args.push_back("-m"); args.push_back(message); }
        auto r = run_git(path, args);
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({{"output", rtrim(r.out)}});
        return true;
    }

    if (type == "git.stash.list") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto r = run_git(path, {"stash", "list"});
        json stashes = json::array();
        std::istringstream ss(r.out);
        std::string line;
        while (std::getline(ss, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty()) continue;
            auto colon = line.find(": ");
            if (colon != std::string::npos)
                stashes.push_back({{"ref", line.substr(0, colon)},
                                   {"message", line.substr(colon + 2)}});
        }
        reply({{"stashes", stashes}});
        return true;
    }

    if (type == "git.stash.pop") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto ref = msg.value("ref", std::string{"stash@{0}"});
        auto r = run_git(path, {"stash", "pop", ref});
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({{"output", rtrim(r.out)}});
        return true;
    }

    if (type == "git.stash.drop") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto ref = msg.value("ref", std::string{"stash@{0}"});
        auto r = run_git(path, {"stash", "drop", ref});
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({{"output", rtrim(r.out)}});
        return true;
    }

    if (type == "git.commit") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto message = msg.value("message", std::string{});
        if (message.empty()) { reply_err("commit message required"); return true; }
        // Write to temp file to avoid command-line quoting issues with newlines/quotes
        auto tmpfile = (fs::temp_directory_path() / ("binder-commit-" + id + ".txt")).string();
        { std::ofstream f(tmpfile); f << message; }
        auto r = run_git(path, {"commit", "-F", tmpfile});
        fs::remove(tmpfile);
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({{"output", rtrim(r.out)}});
        return true;
    }

    if (type == "git.push") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto r = run_git(path, {"push"});
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({{"output", rtrim(r.out)}});
        return true;
    }

    if (type == "git.pull") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto r = run_git(path, {"pull"});
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({{"output", rtrim(r.out)}});
        return true;
    }

    if (type == "git.branches") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto r = run_git(path, {"branch"});
        json branches = json::array();
        std::string current;
        std::istringstream ss(r.out);
        std::string line;
        while (std::getline(ss, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.size() < 2) continue;
            bool is_current = (line[0] == '*');
            std::string name = line.substr(2);
            if (is_current) current = name;
            branches.push_back(name);
        }
        reply({{"branches", branches}, {"current", current}});
        return true;
    }

    if (type == "git.checkout") {
        if (path.empty()) { reply_err("path required"); return true; }
        auto branch = msg.value("branch", std::string{});
        if (branch.empty()) { reply_err("branch required"); return true; }
        auto r = run_git(path, {"checkout", branch});
        if (r.code != 0) { reply_err(rtrim(r.out)); return true; }
        reply({{"output", rtrim(r.out)}});
        return true;
    }

    return false;
}

} // namespace git_ops
