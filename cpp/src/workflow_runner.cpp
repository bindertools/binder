#include "workflow_runner.hpp"
#include "workflow_yaml.hpp"
#include "workflow_expr.hpp"
#include "process_registry.hpp"

#include <spdlog/spdlog.h>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <unordered_set>
#include <utility>

#ifdef _WIN32
#  include <windows.h>
#endif

namespace workflow_runner {

using json = nlohmann::json;
namespace fs = std::filesystem;

using workflow_yaml::YamlNode;
using workflow_yaml::parse_yaml;
using workflow_expr::Context;
using workflow_expr::substitute;
using workflow_expr::eval_if;
using workflow_expr::to_display_string;

namespace {

// ── Small string helpers ──────────────────────────────────────────────────────

std::string trim(const std::string& s) {
    auto a = s.find_first_not_of(" \t");
    if (a == std::string::npos) return {};
    auto b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

std::string rtrim_nl(std::string s) {
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' '))
        s.pop_back();
    return s;
}

std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                    [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

// ── Platform process runner (capture mode) ────────────────────────────────────

struct RunResult { std::string out; int code = -1; };

#ifdef _WIN32
std::wstring to_wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

std::string win_quote(const std::string& s) {
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
std::string posix_quote(const std::string& s) {
    std::string r = "'";
    for (char c : s) {
        if (c == '\'') r += "'\\''";
        else r += c;
    }
    return r + "'";
}
#endif

RunResult run_capture(const std::string& cwd, const std::vector<std::string>& argv) {
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
    si.dwFlags    = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
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

// ── File helpers ───────────────────────────────────────────────────────────────

std::string read_whole_file(const fs::path& p) {
    std::ifstream f(p, std::ios::binary);
    if (!f) return "";
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

std::vector<std::string> split_lines(const std::string& content) {
    std::vector<std::string> lines;
    std::istringstream ss(content);
    std::string line;
    while (std::getline(ss, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        lines.push_back(line);
    }
    return lines;
}

// ── Cooperative stop tracking ───────────────────────────────────────────────────

std::mutex g_stop_mu;
std::set<std::string> g_stop_set;

bool stop_requested(const std::string& runId) {
    std::lock_guard<std::mutex> lk(g_stop_mu);
    return g_stop_set.count(runId) > 0;
}

// ── Sandbox preparation ─────────────────────────────────────────────────────────

const std::unordered_set<std::string> kSkipDirNames = {
    "node_modules", "vendor", ".git", "dist", "__pycache__",
    ".venv", "venv", ".next", "target", "out",
};

bool should_skip_dir(const fs::path& dirPath) {
    std::string name = dirPath.filename().u8string();
    if (kSkipDirNames.count(name)) return true;
    if (name.rfind("build", 0) == 0) return true; // build, build-static, ...
    if (!name.empty() && name[0] == '.' && name != ".github") return true;
    return false;
}

void copy_sandbox_tree(const fs::path& src, const fs::path& dst) {
    std::error_code ec;
    fs::create_directories(dst, ec);
    for (auto& entry : fs::directory_iterator(src, fs::directory_options::skip_permission_denied, ec)) {
        const fs::path& p = entry.path();
        std::error_code lec;
        if (entry.is_symlink(lec)) continue;
        if (entry.is_directory(lec)) {
            if (should_skip_dir(p)) continue;
            copy_sandbox_tree(p, dst / p.filename());
        } else if (entry.is_regular_file(lec)) {
            std::error_code cec;
            fs::copy_file(p, dst / p.filename(), fs::copy_options::overwrite_existing, cec);
        }
    }
}

fs::path prepare_sandbox(const std::string& projectPath, const std::string& runId, const EmitFn& emit) {
    auto emitOut = [&](const std::string& s) { emit("workflows:output:" + runId, json(s)); };
    emitOut("\x1b[90mPreparing sandbox...\x1b[0m\r\n");

    fs::path tempRoot = fs::temp_directory_path() / ("binder-run-" + runId);
    std::error_code ec;
    fs::remove_all(tempRoot, ec);
    fs::create_directories(tempRoot, ec);
    copy_sandbox_tree(fs::path(projectPath), tempRoot);
    fs::create_directories(tempRoot / "_temp", ec);
    fs::create_directories(tempRoot / "_tool_cache", ec);

    emitOut("\x1b[90mSandbox ready: " + tempRoot.u8string() + "\x1b[0m\r\n");
    return tempRoot;
}

// ── GitHub / runner contexts ────────────────────────────────────────────────────

std::pair<std::string, std::string> parse_owner_repo(const std::string& projectPath) {
    auto r = run_capture(projectPath, {"git", "remote", "get-url", "origin"});
    if (r.code != 0) return {"local", "workspace"};
    std::string url = trim(r.out);
    if (url.size() > 4 && url.substr(url.size() - 4) == ".git") url.resize(url.size() - 4);
    auto pos = url.find_last_of("/:");
    if (pos == std::string::npos) return {"local", "workspace"};
    std::string repo = url.substr(pos + 1);
    std::string rest = url.substr(0, pos);
    auto pos2 = rest.find_last_of("/:");
    std::string owner = pos2 == std::string::npos ? rest : rest.substr(pos2 + 1);
    if (owner.empty() || repo.empty()) return {"local", "workspace"};
    return {owner, repo};
}

json build_github_context(const std::string& projectPath, const fs::path& sandbox, const std::string& runId) {
    json gh = json::object();
    auto owner_repo = parse_owner_repo(projectPath);
    gh["repository"] = owner_repo.first + "/" + owner_repo.second;
    gh["repository_owner"] = owner_repo.first;
    gh["workspace"] = sandbox.u8string();

    auto refR = run_capture(projectPath, {"git", "symbolic-ref", "--short", "HEAD"});
    std::string refName = refR.code == 0 ? trim(refR.out) : "main";
    if (refName.empty()) refName = "main";
    gh["ref_name"] = refName;
    gh["ref"] = "refs/heads/" + refName;

    auto shaR = run_capture(projectPath, {"git", "rev-parse", "HEAD"});
    gh["sha"] = shaR.code == 0 ? trim(shaR.out) : "";

    auto actorR = run_capture(projectPath, {"git", "config", "user.name"});
    std::string actor = actorR.code == 0 ? trim(actorR.out) : "";
    gh["actor"] = actor.empty() ? "local-user" : actor;

    gh["event_name"] = "push";
    gh["run_id"] = runId;
    gh["run_number"] = "1";
    gh["event"] = json::object();
    return gh;
}

json build_runner_context(const fs::path& sandbox) {
    json runner = json::object();
    runner["os"] = "Windows";
    runner["arch"] = "X64";
    runner["temp"] = (sandbox / "_temp").u8string();
    runner["tool_cache"] = (sandbox / "_tool_cache").u8string();
    return runner;
}

// ── Job ordering (needs:) ────────────────────────────────────────────────────────

std::vector<std::string> get_needs_list(const YamlNode& jobNode) {
    std::vector<std::string> out;
    const YamlNode& needs = jobNode.get("needs");
    if (needs.isScalar()) {
        if (!needs.scalar.empty()) out.push_back(needs.scalar);
    } else if (needs.isSeq()) {
        for (auto& n : needs.seq) out.push_back(n.asString());
    }
    return out;
}

std::vector<std::string> topo_sort_jobs(const YamlNode& jobs) {
    std::vector<std::string> ids;
    for (auto& kv : jobs.map) ids.push_back(kv.first);

    std::map<std::string, std::vector<std::string>> needsMap;
    for (auto& kv : jobs.map) needsMap[kv.first] = get_needs_list(kv.second);

    std::vector<std::string> result;
    std::set<std::string> scheduled;
    while (result.size() < ids.size()) {
        bool progressed = false;
        for (auto& id : ids) {
            if (scheduled.count(id)) continue;
            bool ready = true;
            for (auto& dep : needsMap[id]) {
                if (!scheduled.count(dep)) { ready = false; break; }
            }
            if (ready) { result.push_back(id); scheduled.insert(id); progressed = true; }
        }
        if (!progressed) {
            for (auto& id : ids) {
                if (!scheduled.count(id)) { result.push_back(id); scheduled.insert(id); }
            }
            break;
        }
    }
    return result;
}

bool needs_all_succeeded(const YamlNode& jobNode, const std::map<std::string, std::string>& jobStatus) {
    for (auto& dep : get_needs_list(jobNode)) {
        auto it = jobStatus.find(dep);
        if (it == jobStatus.end() || it->second != "success") return false;
    }
    return true;
}

json build_needs_context(const YamlNode& jobNode, const std::map<std::string, std::string>& jobStatus,
                          const std::map<std::string, json>& jobOutputs) {
    json needs = json::object();
    for (auto& dep : get_needs_list(jobNode)) {
        json entry = json::object();
        auto sit = jobStatus.find(dep);
        entry["result"] = sit != jobStatus.end() ? sit->second : "skipped";
        auto oit = jobOutputs.find(dep);
        entry["outputs"] = oit != jobOutputs.end() ? oit->second : json::object();
        needs[dep] = entry;
    }
    return needs;
}

// ── Matrix expansion ──────────────────────────────────────────────────────────────

struct MatrixCombo {
    json matrix = json::object();
    std::string runsOn;
    bool skip = false;
    std::string skipReason;
};

void cartesian_product_rec(const std::vector<std::pair<std::string, std::vector<json>>>& axes,
                            size_t idx, json& current, std::vector<json>& out) {
    if (idx == axes.size()) { out.push_back(current); return; }
    for (auto& v : axes[idx].second) {
        current[axes[idx].first] = v;
        cartesian_product_rec(axes, idx + 1, current, out);
    }
}

bool matches_subset(const json& combo, const json& subset) {
    for (auto it = subset.begin(); it != subset.end(); ++it) {
        if (!combo.contains(it.key())) return false;
        if (combo.at(it.key()) != it.value()) return false;
    }
    return true;
}

std::string resolve_runs_on(const YamlNode& jobNode) {
    std::string runsOnRaw;
    const YamlNode& runsOnNode = jobNode.get("runs-on");
    if (runsOnNode.isSeq()) {
        for (auto& it : runsOnNode.seq) {
            if (!runsOnRaw.empty()) runsOnRaw += ",";
            runsOnRaw += it.asString();
        }
    } else {
        runsOnRaw = runsOnNode.asString();
    }
    return runsOnRaw;
}

bool runs_on_supported(const std::string& runsOn) {
    if (runsOn.empty()) return true;
    return to_lower(runsOn).find("windows") != std::string::npos;
}

std::vector<MatrixCombo> expand_matrix(const YamlNode& jobNode, const Context& ctx) {
    std::vector<MatrixCombo> result;
    std::string runsOnRaw = resolve_runs_on(jobNode);

    const YamlNode& strategy = jobNode.get("strategy");
    const YamlNode& matrix = strategy.get("matrix");

    if (!matrix.isMap()) {
        // Non-matrix jobs always run locally (e.g. via Git Bash for
        // ubuntu-latest/macos-latest) — only matrix-expanded OS variants are
        // skipped below.
        MatrixCombo c;
        c.runsOn = substitute(runsOnRaw, ctx);
        result.push_back(c);
        return result;
    }

    std::vector<std::pair<std::string, std::vector<json>>> axes;
    for (auto& kv : matrix.map) {
        if (kv.first == "include" || kv.first == "exclude") continue;
        std::vector<json> values;
        if (kv.second.isSeq()) {
            for (auto& v : kv.second.seq) values.push_back(v.toJson());
        } else {
            values.push_back(kv.second.toJson());
        }
        axes.push_back({kv.first, values});
    }

    std::vector<json> combos;
    if (!axes.empty()) {
        json current = json::object();
        cartesian_product_rec(axes, 0, current, combos);
    } else {
        combos.push_back(json::object());
    }

    const YamlNode& excludeNode = matrix.get("exclude");
    if (excludeNode.isSeq()) {
        std::vector<json> filtered;
        for (auto& c : combos) {
            bool excluded = false;
            for (auto& ex : excludeNode.seq) {
                if (matches_subset(c, ex.toJson())) { excluded = true; break; }
            }
            if (!excluded) filtered.push_back(c);
        }
        combos = filtered;
    }

    const YamlNode& includeNode = matrix.get("include");
    if (includeNode.isSeq()) {
        for (auto& inc : includeNode.seq) {
            json incJson = inc.toJson();
            bool merged = false;
            for (auto& c : combos) {
                bool hasOverlap = false;
                bool allMatch = true;
                for (auto& ax : axes) {
                    if (incJson.contains(ax.first)) {
                        hasOverlap = true;
                        if (c.value(ax.first, json()) != incJson.at(ax.first)) { allMatch = false; break; }
                    }
                }
                if (hasOverlap && allMatch) {
                    for (auto it = incJson.begin(); it != incJson.end(); ++it) c[it.key()] = it.value();
                    merged = true;
                }
            }
            if (!merged) combos.push_back(incJson);
        }
    }

    if (combos.empty()) combos.push_back(json::object());

    for (auto& m : combos) {
        MatrixCombo c;
        c.matrix = m;
        Context comboCtx = ctx;
        comboCtx.matrix = m;
        c.runsOn = substitute(runsOnRaw, comboCtx);
        if (!runs_on_supported(c.runsOn)) {
            c.skip = true;
            c.skipReason = "runs-on: " + c.runsOn + " is not supported by the local runner (host is Windows)";
        }
        result.push_back(c);
    }
    return result;
}

// ── Shell resolution ───────────────────────────────────────────────────────────────

struct ShellInfo {
    std::string kind;           // bash | pwsh | powershell | cmd | python | custom
    std::string customTemplate; // for custom shells, contains "{0}"
    std::string scriptExt;
};

const std::string& bash_exe_path() {
    static std::string cached = []() {
        const char* candidates[] = {
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        };
        std::error_code ec;
        for (auto c : candidates) {
            if (fs::exists(c, ec)) return std::string(c);
        }
        return std::string("bash");
    }();
    return cached;
}

bool pwsh_available() {
    static bool cached = []() {
        auto r = run_capture("", {"pwsh", "-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"});
        return r.code == 0;
    }();
    return cached;
}

ShellInfo resolve_shell(const std::string& explicitShell, const std::string& declaredRunsOn) {
    std::string shell = explicitShell;
    if (shell.empty()) {
        shell = (to_lower(declaredRunsOn).find("windows") != std::string::npos) ? "pwsh" : "bash";
    }
    std::string lower = to_lower(shell);
    if (lower == "bash" || lower == "sh") return {"bash", "", ".sh"};
    if (lower == "pwsh") return {"pwsh", "", ".ps1"};
    if (lower == "powershell") return {"powershell", "", ".ps1"};
    if (lower == "cmd") return {"cmd", "", ".cmd"};
    if (lower == "python") return {"python", "", ".py"};
    return {"custom", shell, ".sh"};
}

std::vector<std::string> build_shell_argv(const ShellInfo& sh, const std::string& scriptPath) {
    if (sh.kind == "bash")
        return {bash_exe_path(), "--noprofile", "--norc", "-eo", "pipefail", scriptPath};
    if (sh.kind == "pwsh") {
        std::string exe = pwsh_available() ? "pwsh" : "powershell";
        return {exe, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ". '" + scriptPath + "'"};
    }
    if (sh.kind == "powershell")
        return {"powershell", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ". '" + scriptPath + "'"};
    if (sh.kind == "cmd")
        return {"cmd", "/D", "/E:ON", "/V:OFF", "/S", "/C", "CALL \"" + scriptPath + "\""};
    if (sh.kind == "python")
        return {"python", scriptPath};

    // custom shell template, e.g. "perl {0}"
    std::vector<std::string> parts;
    std::istringstream iss(sh.customTemplate);
    std::string tok;
    while (iss >> tok) parts.push_back(tok);
    for (auto& p : parts) {
        size_t pos;
        while ((pos = p.find("{0}")) != std::string::npos) p.replace(pos, 3, scriptPath);
    }
    if (parts.empty()) parts = {bash_exe_path(), scriptPath};
    return parts;
}

// ── Streaming process runner ──────────────────────────────────────────────────────

#ifdef _WIN32
struct CIWLess {
    bool operator()(const std::wstring& a, const std::wstring& b) const {
        return _wcsicmp(a.c_str(), b.c_str()) < 0;
    }
};

std::wstring build_env_block(const std::map<std::string, std::string>& overrides) {
    std::map<std::wstring, std::wstring, CIWLess> envMap;
    LPWCH base = GetEnvironmentStringsW();
    if (base) {
        for (LPWCH p = base; *p; ) {
            std::wstring entry(p);
            auto eq = entry.find(L'=');
            if (eq != std::wstring::npos && eq > 0) envMap[entry.substr(0, eq)] = entry.substr(eq + 1);
            p += entry.size() + 1;
        }
        FreeEnvironmentStringsW(base);
    }
    for (auto& kv : overrides) envMap[to_wide(kv.first)] = to_wide(kv.second);

    std::wstring block;
    for (auto& kv : envMap) {
        block += kv.first;
        block += L'=';
        block += kv.second;
        block += L'\0';
    }
    block += L'\0';
    return block;
}

int run_streaming(const std::string& cwd, const std::vector<std::string>& argv,
                  const std::map<std::string, std::string>& env, const std::string& runId,
                  const std::string& eventName, const EmitFn& emit) {
    if (argv.empty()) return -1;
    std::string cmd = win_quote(argv[0]);
    for (size_t i = 1; i < argv.size(); i++) cmd += " " + win_quote(argv[i]);
    std::wstring wcmd = to_wide(cmd);
    std::wstring wcwd = to_wide(cwd);
    std::wstring envBlock = build_env_block(env);

    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE rd = INVALID_HANDLE_VALUE, wr = INVALID_HANDLE_VALUE;
    if (!CreatePipe(&rd, &wr, &sa, 0)) return -1;
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    si.hStdOutput = wr;
    si.hStdError = wr;
    si.hStdInput = INVALID_HANDLE_VALUE;

    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(nullptr, wcmd.data(), nullptr, nullptr, TRUE,
                             CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                             (LPVOID)envBlock.data(),
                             cwd.empty() ? nullptr : wcwd.data(), &si, &pi);
    CloseHandle(wr);
    if (!ok) { CloseHandle(rd); return -1; }
    CloseHandle(pi.hThread);

    process_registry::register_process(runId, (process_registry::ProcessHandle)pi.hProcess);

    char buf[4096];
    DWORD n;
    while (ReadFile(rd, buf, sizeof(buf), &n, nullptr) && n > 0) {
        std::string chunk(buf, n);
        std::string out; out.reserve(chunk.size() + 32);
        bool prevCr = false;
        for (char c : chunk) {
            if (c == '\n' && !prevCr) out += '\r';
            out += c;
            prevCr = (c == '\r');
        }
        emit(eventName, json(out));
    }
    CloseHandle(rd);

    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD ec = 0;
    GetExitCodeProcess(pi.hProcess, &ec);
    CloseHandle(pi.hProcess);
    process_registry::unregister_process(runId);
    return (int)ec;
}
#else
int run_streaming(const std::string& cwd, const std::vector<std::string>& argv,
                  const std::map<std::string, std::string>& /*env*/, const std::string& runId,
                  const std::string& eventName, const EmitFn& emit) {
    if (argv.empty()) return -1;
    std::string cmd = posix_quote(argv[0]);
    for (size_t i = 1; i < argv.size(); i++) cmd += " " + posix_quote(argv[i]);
    if (!cwd.empty()) cmd = "cd " + posix_quote(cwd) + " && " + cmd;
    cmd += " 2>&1";

    FILE* f = popen(cmd.c_str(), "r");
    if (!f) return -1;
    char buf[4096]; size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) emit(eventName, json(std::string(buf, n)));
    int rc = pclose(f);
    (void)runId;
    return WIFEXITED(rc) ? WEXITSTATUS(rc) : -1;
}
#endif

// ── Workflow command files (GITHUB_OUTPUT/ENV/PATH) ────────────────────────────────

json parse_kv_file(const fs::path& p) {
    json result = json::object();
    auto lines = split_lines(read_whole_file(p));
    for (size_t i = 0; i < lines.size(); i++) {
        const std::string& l = lines[i];
        if (l.empty()) continue;
        auto heredoc = l.find("<<");
        auto eq = l.find('=');
        if (heredoc != std::string::npos && (eq == std::string::npos || heredoc < eq)) {
            std::string key = l.substr(0, heredoc);
            std::string delim = l.substr(heredoc + 2);
            std::string value;
            bool first = true;
            i++;
            while (i < lines.size() && lines[i] != delim) {
                if (!first) value += "\n";
                value += lines[i];
                first = false;
                i++;
            }
            result[key] = value;
        } else if (eq != std::string::npos) {
            result[l.substr(0, eq)] = l.substr(eq + 1);
        }
    }
    return result;
}

std::vector<std::string> parse_path_file(const fs::path& p) {
    std::vector<std::string> out;
    for (auto& l : split_lines(read_whole_file(p))) {
        if (!l.empty()) out.push_back(l);
    }
    return out;
}

// ── Per-step environment ────────────────────────────────────────────────────────────

bool get_bool_field(const YamlNode& node, const Context& ctx, bool def) {
    if (!node.isScalar()) return def;
    if (node.scalar.find("${{") != std::string::npos) return substitute(node.scalar, ctx) == "true";
    return node.asBool(def);
}

json build_step_env(const Context& ctx, const YamlNode& workflowEnv, const YamlNode& jobEnv,
                     const YamlNode& stepEnv, const std::string& extraPathPrefix,
                     const std::string& runId, const std::string& jobId,
                     const fs::path& outFile, const fs::path& envFile,
                     const fs::path& pathFile, const fs::path& summaryFile) {
    json env = json::object();
    env["GITHUB_WORKSPACE"] = ctx.github.value("workspace", std::string());
    env["GITHUB_REPOSITORY"] = ctx.github.value("repository", std::string());
    env["GITHUB_REPOSITORY_OWNER"] = ctx.github.value("repository_owner", std::string());
    env["GITHUB_REF"] = ctx.github.value("ref", std::string());
    env["GITHUB_REF_NAME"] = ctx.github.value("ref_name", std::string());
    env["GITHUB_SHA"] = ctx.github.value("sha", std::string());
    env["GITHUB_ACTOR"] = ctx.github.value("actor", std::string());
    env["GITHUB_EVENT_NAME"] = ctx.github.value("event_name", std::string("push"));
    env["GITHUB_RUN_ID"] = runId;
    env["GITHUB_RUN_NUMBER"] = "1";
    env["GITHUB_JOB"] = jobId;
    env["GITHUB_ACTION"] = "";
    env["RUNNER_OS"] = "Windows";
    env["RUNNER_ARCH"] = "X64";
    env["RUNNER_TEMP"] = ctx.runner.value("temp", std::string());
    env["RUNNER_TOOL_CACHE"] = ctx.runner.value("tool_cache", std::string());
    env["CI"] = "true";
    env["GITHUB_OUTPUT"] = outFile.u8string();
    env["GITHUB_ENV"] = envFile.u8string();
    env["GITHUB_PATH"] = pathFile.u8string();
    env["GITHUB_STEP_SUMMARY"] = summaryFile.u8string();

    auto applyLayer = [&](const YamlNode& layer) {
        for (auto& kv : layer.map) env[kv.first] = substitute(kv.second.asString(), ctx);
    };
    applyLayer(workflowEnv);
    applyLayer(jobEnv);
    applyLayer(stepEnv);

    for (auto it = ctx.env.begin(); it != ctx.env.end(); ++it) {
        if (it.value().is_string()) env[it.key()] = it.value();
    }

    if (!extraPathPrefix.empty()) {
        const char* sysPath = std::getenv("PATH");
        env["PATH"] = extraPathPrefix + ";" + (sysPath ? sysPath : "");
    }
    return env;
}

// ── `uses:` shims ──────────────────────────────────────────────────────────────────

bool run_uses_shim(const std::string& usesRaw, const YamlNode& withNode, const fs::path& sandbox,
                   const Context& ctx, const std::function<void(const std::string&)>& emitOut,
                   json& outputs) {
    outputs = json::object();
    std::string ref = substitute(usesRaw, ctx);
    std::string name = ref;
    auto at = name.find('@');
    if (at != std::string::npos) name.resize(at);

    if (name == "actions/checkout") {
        emitOut("\x1b[90m  using sandbox checkout (working tree already at HEAD)\x1b[0m\r\n");
        std::string sub = withNode.get("submodules").asString();
        if (sub == "true" || sub == "recursive") {
            std::vector<std::string> argv = {"git", "submodule", "update", "--init"};
            if (sub == "recursive") argv.push_back("--recursive");
            auto r = run_capture(sandbox.u8string(), argv);
            if (r.code != 0) emitOut("\x1b[33m  warning: git submodule update failed\x1b[0m\r\n");
        }
        return true;
    }

    if (name == "actions/setup-node") {
        auto nodeV = run_capture(sandbox.u8string(), {"node", "--version"});
        auto npmV = run_capture(sandbox.u8string(), {"npm", "--version"});
        if (nodeV.code == 0) {
            emitOut("\x1b[90m  using local node " + trim(nodeV.out) + ", npm " + trim(npmV.out) + "\x1b[0m\r\n");
            std::string want = withNode.get("node-version").asString();
            if (!want.empty()) {
                std::string have = trim(nodeV.out);
                if (!have.empty() && have[0] == 'v') have = have.substr(1);
                std::string wantMajor = want.substr(0, want.find('.'));
                std::string haveMajor = have.substr(0, have.find('.'));
                if (!wantMajor.empty() && wantMajor != haveMajor) {
                    emitOut("\x1b[33m  warning: workflow requests node " + want + " but local node is " + have + "\x1b[0m\r\n");
                }
            }
        } else {
            emitOut("\x1b[33m  warning: node not found on PATH\x1b[0m\r\n");
        }
        return true;
    }

    if (name == "actions/setup-python") {
        auto pyV = run_capture(sandbox.u8string(), {"python", "--version"});
        if (pyV.code == 0) emitOut("\x1b[90m  using local " + trim(pyV.out) + "\x1b[0m\r\n");
        else emitOut("\x1b[33m  warning: python not found on PATH\x1b[0m\r\n");
        return true;
    }

    if (name == "actions/cache") {
        emitOut("\x1b[90m  actions/cache is a no-op for local runs\x1b[0m\r\n");
        return true;
    }

    emitOut("\x1b[90m  skipped: uses: " + ref + " is not supported by the local runner\x1b[0m\r\n");
    return true;
}

// ── Step execution ────────────────────────────────────────────────────────────────

using OutFn = std::function<void(const std::string&)>;
using StepFn = std::function<void(const std::string& jobId, const std::string& jobName, int stepIndex,
                                   const std::string& stepName, const std::string& status)>;

void run_job_steps(const fs::path& sandbox, const YamlNode& jobNode, const std::string& jobId,
                    const std::string& jobName, const YamlNode& workflowEnv, Context& ctx,
                    const std::string& runId, const std::string& declaredRunsOn, const EmitFn& emit,
                    const OutFn& emitOut, const StepFn& emitStep) {
    const YamlNode& steps = jobNode.get("steps");
    const YamlNode& jobEnv = jobNode.get("env");
    std::string jobShellStr = jobNode.get("defaults").get("run").get("shell").asString();

    fs::path runnerTempCmds = sandbox / "_temp" / "_runner_file_commands";
    std::error_code ec;
    fs::create_directories(runnerTempCmds, ec);

    std::string extraPathPrefix;

    for (size_t i = 0; i < steps.seq.size(); i++) {
        if (stop_requested(runId)) break;
        const YamlNode& step = steps.seq[i];
        if (!step.isMap()) continue;

        std::string stepId = step.get("id").asString();
        std::string usesRaw = step.get("uses").asString();
        std::string runRaw = step.get("run").asString();
        std::string rawName = step.get("name").asString();

        std::string displayName;
        if (!rawName.empty()) displayName = substitute(rawName, ctx);
        else if (!usesRaw.empty()) displayName = substitute(usesRaw, ctx);
        else if (!runRaw.empty()) displayName = "run";
        else displayName = "step " + std::to_string(i + 1);

        std::string ifExpr = step.get("if").asString();
        if (!eval_if(ifExpr, ctx)) {
            emitStep(jobId, jobName, (int)i, displayName, "skipped");
            continue;
        }

        emitStep(jobId, jobName, (int)i, displayName, "running");
        emitOut("\r\n\x1b[36m▶ " + displayName + "\x1b[0m\r\n");

        bool stepSuccess = true;
        int exitCode = 0;
        bool ranSomething = false;

        if (!usesRaw.empty()) {
            ranSomething = true;
            json shimOutputs;
            stepSuccess = run_uses_shim(usesRaw, step.get("with"), sandbox, ctx, emitOut, shimOutputs);
            if (!stepId.empty()) {
                ctx.steps[stepId] = {
                    {"outputs", shimOutputs},
                    {"outcome", stepSuccess ? "success" : "failure"},
                    {"conclusion", stepSuccess ? "success" : "failure"},
                };
            }
        } else if (!runRaw.empty()) {
            ranSomething = true;
            std::string explicitShell = step.get("shell").asString();
            if (explicitShell.empty()) explicitShell = jobShellStr;
            ShellInfo shellInfo = resolve_shell(explicitShell, declaredRunsOn);

            std::string scriptContent = substitute(runRaw, ctx);
            fs::path scriptPath = sandbox / "_temp" / ("step_" + runId + "_" + std::to_string(i) + shellInfo.scriptExt);
            { std::ofstream sf(scriptPath, std::ios::binary); sf << scriptContent; }

            fs::path outFile = runnerTempCmds / ("output_" + std::to_string(i));
            fs::path envFile = runnerTempCmds / ("env_" + std::to_string(i));
            fs::path pathFile = runnerTempCmds / ("path_" + std::to_string(i));
            fs::path summaryFile = runnerTempCmds / ("summary_" + std::to_string(i));
            { std::ofstream(outFile); std::ofstream(envFile); std::ofstream(pathFile); std::ofstream(summaryFile); }

            json env = build_step_env(ctx, workflowEnv, jobEnv, step.get("env"), extraPathPrefix, runId, jobId,
                                       outFile, envFile, pathFile, summaryFile);

            std::string workingDir = substitute(step.get("working-directory").asString(), ctx);
            fs::path cwd = workingDir.empty() ? sandbox : (sandbox / workingDir);

            std::map<std::string, std::string> envMap;
            for (auto it = env.begin(); it != env.end(); ++it) {
                if (it.value().is_string()) envMap[it.key()] = it.value().get<std::string>();
            }

            std::vector<std::string> argv = build_shell_argv(shellInfo, scriptPath.u8string());
            exitCode = run_streaming(cwd.u8string(), argv, envMap, runId, "workflows:output:" + runId, emit);
            stepSuccess = (exitCode == 0);

            json outputs = parse_kv_file(outFile);
            json envUpdates = parse_kv_file(envFile);
            for (auto it = envUpdates.begin(); it != envUpdates.end(); ++it) ctx.env[it.key()] = it.value();
            for (auto& p : parse_path_file(pathFile)) {
                extraPathPrefix = extraPathPrefix.empty() ? p : (p + ";" + extraPathPrefix);
            }

            if (!stepId.empty()) {
                ctx.steps[stepId] = {
                    {"outputs", outputs},
                    {"outcome", stepSuccess ? "success" : "failure"},
                    {"conclusion", stepSuccess ? "success" : "failure"},
                };
            }

            std::error_code rmEc;
            fs::remove(scriptPath, rmEc);
            fs::remove(outFile, rmEc);
            fs::remove(envFile, rmEc);
            fs::remove(pathFile, rmEc);
            fs::remove(summaryFile, rmEc);
        }

        if (!ranSomething) {
            emitStep(jobId, jobName, (int)i, displayName, "success");
            continue;
        }

        bool continueOnError = get_bool_field(step.get("continue-on-error"), ctx, false);
        if (!stepSuccess && !continueOnError) ctx.job["status"] = "failure";

        std::string finalStatus = stepSuccess ? "success" : (continueOnError ? "success" : "failure");
        emitStep(jobId, jobName, (int)i, displayName, finalStatus);

        if (stepSuccess) {
            emitOut("\x1b[32m✓ " + displayName + "\x1b[0m\r\n");
        } else if (continueOnError) {
            emitOut("\x1b[33m✗ " + displayName + " (exit " + std::to_string(exitCode) + ", continuing)\x1b[0m\r\n");
        } else {
            emitOut("\x1b[31m✗ " + displayName + " (exit " + std::to_string(exitCode) + ")\x1b[0m\r\n");
        }
    }
}

} // namespace

// ── Public API ────────────────────────────────────────────────────────────────────

void run_workflow(const std::string& path, const std::string& file, const std::string& runId, const EmitFn& emit) {
    auto emitOut = [&](const std::string& s) { emit("workflows:output:" + runId, json(s)); };
    auto emitStep = [&](const std::string& jobId, const std::string& jobName, int idx,
                         const std::string& name, const std::string& status) {
        emit("workflows:step:" + runId, json{
            {"job", jobId}, {"jobName", jobName}, {"stepIndex", idx}, {"stepName", name}, {"status", status}
        });
    };
    auto emitDone = [&](int code) { emit("workflows:done:" + runId, json{{"code", code}}); };

    {
        std::lock_guard<std::mutex> lk(g_stop_mu);
        g_stop_set.erase(runId);
    }

    if (file.find("..") != std::string::npos || file.find('/') != std::string::npos || file.find('\\') != std::string::npos) {
        emitOut("\r\n\x1b[31mInvalid workflow file\x1b[0m\r\n");
        emitDone(-1);
        return;
    }

    fs::path wfPath = fs::path(path) / ".github" / "workflows" / file;
    std::string content = read_whole_file(wfPath);
    if (content.empty()) {
        emitOut("\r\n\x1b[31mCannot read workflow file\x1b[0m\r\n");
        emitDone(-1);
        return;
    }

    YamlNode root;
    try {
        root = parse_yaml(content);
    } catch (const workflow_yaml::ParseError& e) {
        emitOut(std::string("\r\n\x1b[31mYAML parse error: ") + e.what() + "\x1b[0m\r\n");
        emitDone(-1);
        return;
    }

    fs::path sandbox = prepare_sandbox(path, runId, emit);

    try {
        Context baseCtx;
        baseCtx.github = build_github_context(path, sandbox, runId);
        baseCtx.runner = build_runner_context(sandbox);

        const YamlNode& workflowEnv = root.get("env");
        const YamlNode& jobs = root.get("jobs");

        std::vector<std::string> order = topo_sort_jobs(jobs);
        std::map<std::string, std::string> jobStatus;
        std::map<std::string, json> jobOutputs;

        for (auto& jobId : order) {
            if (stop_requested(runId)) break;
            const YamlNode& jobNode = jobs.get(jobId);

            Context jobCtx = baseCtx;
            jobCtx.needs = build_needs_context(jobNode, jobStatus, jobOutputs);
            bool needsOk = needs_all_succeeded(jobNode, jobStatus);
            jobCtx.job = json{{"status", needsOk ? "success" : "failure"}};

            std::string jobIfExpr = jobNode.get("if").asString();
            std::string jobName = substitute(jobNode.get("name").asString(jobId), jobCtx);

            if (!eval_if(jobIfExpr, jobCtx)) {
                jobStatus[jobId] = "skipped";
                emitOut("\r\n\x1b[90m⊘ " + jobName + " — skipped\x1b[0m\r\n");
                continue;
            }
            jobCtx.job = json{{"status", "success"}};

            auto combos = expand_matrix(jobNode, jobCtx);
            bool anyRan = false;
            std::string overall = "success";

            for (auto& combo : combos) {
                if (stop_requested(runId)) break;
                Context comboCtx = jobCtx;
                comboCtx.matrix = combo.matrix;
                std::string comboName = substitute(jobNode.get("name").asString(jobId), comboCtx);

                if (combo.skip) {
                    emitOut("\r\n\x1b[90m⊘ " + comboName + " — " + combo.skipReason + "\x1b[0m\r\n");
                    continue;
                }

                anyRan = true;
                comboCtx.steps = json::object();
                comboCtx.job = json{{"status", "success"}};

                emitOut("\r\n\x1b[1;34m▶▶ " + comboName + "\x1b[0m\r\n");
                run_job_steps(sandbox, jobNode, jobId, comboName, workflowEnv, comboCtx, runId, combo.runsOn,
                               emit, emitOut, emitStep);

                std::string comboStatus = comboCtx.job.value("status", std::string("success"));
                if (comboStatus == "failure") overall = "failure";

                json jo = json::object();
                for (auto& kv : jobNode.get("outputs").map) jo[kv.first] = substitute(kv.second.asString(), comboCtx);
                jobOutputs[jobId] = jo;
            }

            jobStatus[jobId] = anyRan ? overall : "skipped";
        }

        bool stopped = stop_requested(runId);
        int code = 0;
        if (stopped) {
            code = -1;
        } else {
            for (auto& kv : jobStatus) if (kv.second == "failure") code = 1;
        }

        emitOut("\r\n\x1b[90mCleaning up sandbox...\x1b[0m\r\n");
        std::error_code ec;
        fs::remove_all(sandbox, ec);

        {
            std::lock_guard<std::mutex> lk(g_stop_mu);
            g_stop_set.erase(runId);
        }
        emitDone(code);
    } catch (const std::exception& e) {
        emitOut(std::string("\r\n\x1b[31mInternal runner error: ") + e.what() + "\x1b[0m\r\n");
        std::error_code ec;
        fs::remove_all(sandbox, ec);
        {
            std::lock_guard<std::mutex> lk(g_stop_mu);
            g_stop_set.erase(runId);
        }
        emitDone(-1);
    }
}

void stop_workflow(const std::string& runId) {
    {
        std::lock_guard<std::mutex> lk(g_stop_mu);
        g_stop_set.insert(runId);
    }
    process_registry::terminate_process(runId);
}

} // namespace workflow_runner
