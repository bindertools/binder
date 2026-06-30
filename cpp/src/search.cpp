#include "search.hpp"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

#include <spdlog/spdlog.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace fs = std::filesystem;
using json   = nlohmann::json;

namespace search_ops {

namespace {

// Slash commands exposed for tab-completion — matches terminal.go's help list.
static const std::vector<std::string> kCommands = {
    "/help", "/clear", "/version", "/search", "/preview",
    "/config", "/themes", "/kill", "/ports", "/performance",
    "/plugins", "/fullscreen", "/explorer", "/pack", "/debug", "/problems",
};

static const std::unordered_set<std::string> kSkipDirs = {
    "node_modules", "vendor", ".git", "dist", "build", "__pycache__",
};

static const std::unordered_set<std::string> kBinaryExts = {
    ".exe",".dll",".so",".dylib",".bin",".obj",".o",".a",
    ".png",".jpg",".jpeg",".gif",".ico",".webp",".bmp",
    ".zip",".tar",".gz",".rar",".7z",
    ".pdf",".doc",".docx",".xls",".xlsx",
    ".mp3",".mp4",".wav",".avi",".mov",
    ".wasm",".node",
};

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return s;
}

#ifdef _WIN32
fs::path from_u8(const std::string& s) {
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return fs::path(std::move(w));
}
#else
fs::path from_u8(const std::string& s) { return fs::path(s); }
#endif

bool is_binary(const std::string& ext_lower) {
    return kBinaryExts.count(ext_lower) > 0;
}

// Combined filename + content search — matches Go's search.Files.
json query_impl(const std::string& root_path, const std::string& query, int max_results) {
    auto query_l = lower(query);
    json results = json::array();
    int count = 0;

    std::function<void(const fs::path&)> walk = [&](const fs::path& dir) {
        if (count >= max_results) return;
        std::error_code ec;
        std::vector<fs::directory_entry> entries;
        for (auto& e : fs::directory_iterator(dir, ec)) entries.push_back(e);
        ec.clear();
        // Sort for deterministic order
        std::sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) {
            return lower(a.path().filename().u8string()) < lower(b.path().filename().u8string());
        });

        for (auto& e : entries) {
            if (count >= max_results) return;
            auto name = e.path().filename().u8string();
            if (!name.empty() && name[0] == '.') {
                if (e.is_directory()) continue;  // skip hidden dirs
                continue;                         // skip hidden files
            }
            if (e.is_directory()) {
                if (kSkipDirs.count(name)) continue;
                walk(e.path());
                continue;
            }
            if (!e.is_regular_file()) continue;

            std::error_code fec;
            auto rel_generic = fs::relative(e.path(), from_u8(root_path), fec).generic_u8string();

            // Filename match
            if (lower(name).find(query_l) != std::string::npos) {
                results.push_back({
                    {"path", rel_generic}, {"line", 0}, {"content", ""}, {"is_name", true},
                });
                ++count;
                continue;
            }

            // Content match (skip binary / large files)
            auto ext = lower(e.path().extension().u8string());
            auto size = e.file_size(fec);
            if (is_binary(ext) || size > (1 << 20)) continue;

            std::ifstream f(e.path());
            if (!f) continue;
            int line_num = 0;
            std::string line;
            while (std::getline(f, line) && count < max_results) {
                ++line_num;
                if (lower(line).find(query_l) != std::string::npos) {
                    // Trim and cap at 120 chars
                    auto trimmed = line;
                    auto start = trimmed.find_first_not_of(" \t\r");
                    if (start != std::string::npos) trimmed = trimmed.substr(start);
                    auto end = trimmed.find_last_not_of(" \t\r");
                    if (end != std::string::npos) trimmed = trimmed.substr(0, end + 1);
                    if (trimmed.size() > 120) trimmed = trimmed.substr(0, 120) + "...";
                    results.push_back({
                        {"path", rel_generic}, {"line", line_num},
                        {"content", trimmed}, {"is_name", false},
                    });
                    ++count;
                }
            }
        }
    };

    walk(from_u8(root_path));
    return results;
}

// Filename-only search.
json files_impl(const std::string& root_path, const std::string& query, int max_results) {
    auto query_l = lower(query);
    json results = json::array();
    std::error_code ec;
    for (auto it = fs::recursive_directory_iterator(from_u8(root_path), ec);
         it != fs::recursive_directory_iterator(); ++it) {
        if (ec) { ec.clear(); continue; }
        if ((int)results.size() >= max_results) break;
        auto name = it->path().filename().u8string();
        if (!name.empty() && name[0] == '.') {
            if (it->is_directory()) it.disable_recursion_pending();
            continue;
        }
        if (it->is_directory() && kSkipDirs.count(name)) {
            it.disable_recursion_pending();
            continue;
        }
        if (!it->is_regular_file()) continue;
        if (lower(name).find(query_l) != std::string::npos) {
            std::error_code rec;
            results.push_back({
                {"path",     fs::relative(it->path(), from_u8(root_path), rec).generic_u8string()},
                {"abs_path", it->path().u8string()},
                {"name",     name},
                {"is_name",  true},
            });
        }
    }
    return results;
}

// Content search via ripgrep subprocess; falls back to empty results if rg not found.
json content_impl(const std::string& root_path, const std::string& query,
                  int max_results, std::string& warning) {
    json results = json::array();

    std::string output;

#ifdef _WIN32
    // Check if rg is available
    wchar_t rg_path[MAX_PATH] = {};
    if (!SearchPathW(nullptr, L"rg.exe", nullptr, MAX_PATH, rg_path, nullptr)) {
        warning = "ripgrep not found";
        return results;
    }

    // Build command: rg --json --max-count=1 <query> <path>
    std::wstring cmd = L"\"";
    cmd += rg_path;
    cmd += L"\" --json --max-count=1 ";
    // Escape query (basic, no shell special chars handling)
    auto wq = from_u8(query).wstring();
    cmd += L"\"" + wq + L"\" ";
    cmd += L"\"" + from_u8(root_path).wstring() + L"\"";

    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE rd = INVALID_HANDLE_VALUE, wr = INVALID_HANDLE_VALUE;
    CreatePipe(&rd, &wr, &sa, 0);
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si{};
    si.cb          = sizeof(si);
    si.dwFlags     = STARTF_USESTDHANDLES;
    si.hStdOutput  = wr;
    si.hStdError   = INVALID_HANDLE_VALUE;
    si.hStdInput   = INVALID_HANDLE_VALUE;

    PROCESS_INFORMATION pi{};
    std::wstring cmdBuf = cmd;
    if (!CreateProcessW(nullptr, cmdBuf.data(), nullptr, nullptr, TRUE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        CloseHandle(rd); CloseHandle(wr);
        warning = "ripgrep not found";
        return results;
    }
    CloseHandle(wr); // close write end so ReadFile returns when process exits
    CloseHandle(pi.hThread);

    // Read output
    char buf[4096];
    DWORD n;
    while (ReadFile(rd, buf, sizeof(buf), &n, nullptr) && n > 0)
        output.append(buf, n);
    CloseHandle(rd);
    WaitForSingleObject(pi.hProcess, 5000);
    CloseHandle(pi.hProcess);
#else
    // Build command: rg --json --max-count=1 <query> <path>
    // Basic shell-quoting: wrap in single quotes, escape embedded single quotes.
    auto shell_quote = [](const std::string& s) -> std::string {
        std::string r = "'";
        for (char c : s) { if (c == '\'') r += "'\\''"; else r += c; }
        r += "'";
        return r;
    };
    std::string cmd = "rg --json --max-count=1 " +
                      shell_quote(query) + " " + shell_quote(root_path) + " 2>/dev/null";
    FILE* f = popen(cmd.c_str(), "r");
    if (!f) {
        warning = "ripgrep not found";
        return results;
    }
    char buf[4096];
    while (fgets(buf, sizeof(buf), f)) output += buf;
    int rc = pclose(f);
    // rg exits 1 when no matches, 2 on error
    if (rc == 2 * 256 /* WEXITSTATUS(rc)==2 */ || output.empty()) {
        // Check if rg is actually missing vs just no results
        FILE* check = popen("rg --version 2>/dev/null", "r");
        if (!check || fgets(buf, sizeof(buf), check) == nullptr) {
            if (check) pclose(check);
            warning = "ripgrep not found";
            return results;
        }
        pclose(check);
    }
#endif

    // Parse NDJSON (shared between platforms)
    std::istringstream ss(output);
    std::string line;
    while (std::getline(ss, line) && (int)results.size() < max_results) {
        if (line.empty()) continue;
        try {
            auto obj = json::parse(line);
            if (obj.value("type", std::string{}) != "match") continue;
            auto& data = obj["data"];
            std::string path = data["path"].value("text", std::string{});
            // Make relative
            std::error_code ec;
            auto rel = fs::relative(from_u8(path), from_u8(root_path), ec).generic_u8string();
            int line_no = data.value("line_number", 0);
            std::string text = data["lines"].value("text", std::string{});
            // Trim trailing newline
            if (!text.empty() && (text.back() == '\n' || text.back() == '\r'))
                text.pop_back();
            if (!text.empty() && text.back() == '\r') text.pop_back();
            results.push_back({
                {"path", rel}, {"line", line_no}, {"text", text},
            });
        } catch (...) {}
    }
    return results;
}

// Run ripgrep and return raw NDJSON output. Returns empty string + sets
// warning if rg is not found. extra_flags are appended before the pattern.
std::string run_rg(const std::string& root_path, const std::string& extra_flags,
                   const std::string& pattern, std::string& warning) {
    std::string output;
#ifdef _WIN32
    wchar_t rg_path[MAX_PATH] = {};
    if (!SearchPathW(nullptr, L"rg.exe", nullptr, MAX_PATH, rg_path, nullptr)) {
        warning = "ripgrep not found";
        return output;
    }
    std::wstring cmd = L"\"";
    cmd += rg_path;
    cmd += L"\" --json ";
    // Append extra_flags as wide string
    if (!extra_flags.empty()) {
        int nf = MultiByteToWideChar(CP_UTF8, 0, extra_flags.data(), (int)extra_flags.size(), nullptr, 0);
        std::wstring wf(nf, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, extra_flags.data(), (int)extra_flags.size(), wf.data(), nf);
        cmd += wf + L" ";
    }
    auto wq = from_u8(pattern).wstring();
    cmd += L"\"" + wq + L"\" ";
    cmd += L"\"" + from_u8(root_path).wstring() + L"\"";

    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE rd = INVALID_HANDLE_VALUE, wr = INVALID_HANDLE_VALUE;
    CreatePipe(&rd, &wr, &sa, 0);
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = wr;
    si.hStdError  = INVALID_HANDLE_VALUE;
    si.hStdInput  = INVALID_HANDLE_VALUE;
    PROCESS_INFORMATION pi{};
    std::wstring cmdBuf = cmd;
    if (!CreateProcessW(nullptr, cmdBuf.data(), nullptr, nullptr, TRUE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        CloseHandle(rd); CloseHandle(wr);
        warning = "ripgrep not found";
        return output;
    }
    CloseHandle(wr);
    CloseHandle(pi.hThread);
    char buf[4096]; DWORD n;
    while (ReadFile(rd, buf, sizeof(buf), &n, nullptr) && n > 0) output.append(buf, n);
    CloseHandle(rd);
    WaitForSingleObject(pi.hProcess, 10000);
    CloseHandle(pi.hProcess);
#else
    auto shell_quote = [](const std::string& s) -> std::string {
        std::string r = "'";
        for (char c : s) { if (c == '\'') r += "'\\''"; else r += c; }
        r += "'";
        return r;
    };
    std::string cmd = "rg --json " + extra_flags + " " +
                      shell_quote(pattern) + " " + shell_quote(root_path) + " 2>/dev/null";
    FILE* f = popen(cmd.c_str(), "r");
    if (!f) { warning = "ripgrep not found"; return output; }
    char buf[4096];
    while (fgets(buf, sizeof(buf), f)) output += buf;
    pclose(f);
#endif
    return output;
}

// Parse run_rg output into [{path, line, text}] relative to root_path.
json parse_rg_results(const std::string& output, const std::string& root_path, int max_results) {
    json results = json::array();
    std::istringstream ss(output);
    std::string line;
    while (std::getline(ss, line) && (int)results.size() < max_results) {
        if (line.empty()) continue;
        try {
            auto obj = json::parse(line);
            if (obj.value("type", std::string{}) != "match") continue;
            auto& data = obj["data"];
            std::string path = data["path"].value("text", std::string{});
            std::error_code ec;
            auto rel = fs::relative(from_u8(path), from_u8(root_path), ec).generic_u8string();
            int line_no = data.value("line_number", 0);
            std::string text = data["lines"].value("text", std::string{});
            if (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
            if (!text.empty() && text.back() == '\r') text.pop_back();
            results.push_back({{"path", rel}, {"line", line_no}, {"text", text}});
        } catch (...) {}
    }
    return results;
}

// Go to Definition: search for declaration patterns for the given symbol.
json definition_impl(const std::string& root_path, const std::string& symbol,
                     std::string& warning) {
    // Pattern matches common declaration keywords before the symbol name
    std::string pattern =
        "\\b(?:function|class|const|let|var|type|interface|enum|struct|fn|def|sub|func|proc|macro)\\s+" +
        symbol + "\\b";
    std::string flags = "--max-count=5 --pcre2";
    auto output = run_rg(root_path, flags, pattern, warning);
    if (!warning.empty()) return json::array();
    return parse_rg_results(output, root_path, 50);
}

// Go to References: search for all word-boundary occurrences of the symbol.
json references_impl(const std::string& root_path, const std::string& symbol,
                     std::string& warning) {
    std::string flags = "--word-regexp --max-count=200";
    auto output = run_rg(root_path, flags, symbol, warning);
    if (!warning.empty()) return json::array();
    return parse_rg_results(output, root_path, 200);
}

// Path completion — matches Go's search.Completions.
json complete_path_impl(const std::string& cwd, const std::string& dir,
                        const std::string& prefix) {
    auto look = from_u8(cwd);
    if (!dir.empty()) {
        auto d = from_u8(dir);
        if (d.is_absolute()) {
            look = d;
        } else {
            look = from_u8(cwd) / d;
        }
    }

    std::error_code ec;
    json completions = json::array();
    auto prefix_l = lower(prefix);

    for (auto& e : fs::directory_iterator(look, ec)) {
        auto name = e.path().filename().u8string();
        if (!name.empty() && name[0] == '.') continue;
        if (prefix.empty() ||
            lower(name).substr(0, prefix_l.size()) == prefix_l) {
            if (e.is_directory()) name += "/";
            completions.push_back(name);
        }
        ec.clear();
    }
    return completions;
}

json complete_command_impl(const std::string& prefix) {
    auto prefix_l = lower(prefix);
    json completions = json::array();
    for (auto& cmd : kCommands) {
        if (prefix.empty() || lower(cmd).substr(0, prefix_l.size()) == prefix_l)
            completions.push_back(cmd);
    }
    return completions;
}

} // namespace

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    if (type == "search.query") {
        auto path    = msg.value("path",       std::string{});
        auto query   = msg.value("query",      std::string{});
        int  max     = msg.value("maxResults", 100);
        reply({{"results", query_impl(path, query, max)}});
        return true;
    }
    if (type == "search.files") {
        auto path  = msg.value("path",       std::string{});
        auto query = msg.value("query",      std::string{});
        int  max   = msg.value("maxResults", 50);
        reply({{"results", files_impl(path, query, max)}});
        return true;
    }
    if (type == "search.content") {
        auto path  = msg.value("path",       std::string{});
        auto query = msg.value("query",      std::string{});
        int  max   = msg.value("maxResults", 50);
        std::string warning;
        auto results = content_impl(path, query, max, warning);
        json body = {{"results", results}};
        if (!warning.empty()) body["warning"] = warning;
        reply(body);
        return true;
    }
    if (type == "search.definition") {
        auto path   = msg.value("path",   std::string{});
        auto symbol = msg.value("symbol", std::string{});
        std::string warning;
        auto results = definition_impl(path, symbol, warning);
        json body = {{"results", results}};
        if (!warning.empty()) body["warning"] = warning;
        reply(body);
        return true;
    }
    if (type == "search.references") {
        auto path   = msg.value("path",   std::string{});
        auto symbol = msg.value("symbol", std::string{});
        std::string warning;
        auto results = references_impl(path, symbol, warning);
        json body = {{"results", results}};
        if (!warning.empty()) body["warning"] = warning;
        reply(body);
        return true;
    }
    if (type == "complete.path") {
        auto cwd    = msg.value("cwd",    std::string{});
        auto dir    = msg.value("dir",    std::string{});
        auto prefix = msg.value("prefix", std::string{});
        reply({{"completions", complete_path_impl(cwd, dir, prefix)}});
        return true;
    }
    if (type == "complete.command") {
        auto prefix = msg.value("prefix", std::string{});
        reply({{"completions", complete_command_impl(prefix)}});
        return true;
    }
    return false;
}

} // namespace search_ops
