#include "fileops.hpp"
#include "base64.hpp"

#include <spdlog/spdlog.h>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

#ifndef _WIN32
#include <sys/stat.h>  // stat() for cross-platform mtime
#endif
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace fs = std::filesystem;
using json   = nlohmann::json;

namespace fileops {

namespace {

// Build a std::filesystem::path from a UTF-8 encoded string.
fs::path from_u8(const std::string& s) {
#ifdef _WIN32
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()),
                                nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()),
                        w.data(), n);
    return fs::path(std::move(w));
#else
    // On macOS/Linux std::filesystem::path accepts UTF-8 directly.
    return fs::path(s);
#endif
}

int64_t get_mtime(const fs::path& p) {
#ifdef _WIN32
    WIN32_FILE_ATTRIBUTE_DATA fad{};
    if (!GetFileAttributesExW(p.wstring().c_str(), GetFileExInfoStandard, &fad))
        return 0;
    ULARGE_INTEGER uli{};
    uli.LowPart  = fad.ftLastWriteTime.dwLowDateTime;
    uli.HighPart = fad.ftLastWriteTime.dwHighDateTime;
    // 100-ns intervals since 1601-01-01 → Unix seconds
    return static_cast<int64_t>((uli.QuadPart - 116444736000000000ULL) / 10000000ULL);
#else
    // C++17 portable: use POSIX stat() which directly gives Unix mtime.
    struct stat st{};
    if (::stat(p.c_str(), &st) != 0) return 0;
    return static_cast<int64_t>(st.st_mtime);
#endif
}

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return s;
}

// Dirs skipped during recursive scan (shown as empty collapsed folders).
const std::unordered_set<std::string> kHeavyDirs = {
    "node_modules", ".git", ".svn", ".hg", "dist", "build",
    ".next", "__pycache__", "vendor", "target", ".cache",
    "coverage", ".angular", ".turbo", ".gradle",
};

json build_tree(const fs::path& p) {
    std::error_code ec;
    auto status = fs::status(p, ec);
    if (ec) return nullptr;

    bool is_dir = fs::is_directory(status);
    std::string ext = p.extension().u8string();
    if (!ext.empty() && ext[0] == '.') ext = ext.substr(1);

    json node;
    node["name"]  = p.filename().u8string();
    node["path"]  = p.generic_u8string(); // forward slashes, matches filepath.ToSlash
    node["isDir"] = is_dir;
    node["ext"]   = ext;

    if (!is_dir) return node;
    if (kHeavyDirs.count(lower(p.filename().u8string()))) return node;

    std::vector<fs::directory_entry> entries;
    for (auto& e : fs::directory_iterator(p, ec)) {
        entries.push_back(e);
        ec.clear();
    }

    // Dirs first, then files; both sorted case-insensitively — matches Go.
    std::sort(entries.begin(), entries.end(),
              [](const fs::directory_entry& a, const fs::directory_entry& b) {
                  bool da = a.is_directory(), db = b.is_directory();
                  if (da != db) return da;
                  return lower(a.path().filename().u8string()) <
                         lower(b.path().filename().u8string());
              });

    json children = json::array();
    for (auto& e : entries) {
        auto child = build_tree(e.path());
        if (!child.is_null()) children.push_back(std::move(child));
    }
    if (!children.empty()) node["children"] = std::move(children);

    return node;
}

} // namespace

// ─── Public API ───────────────────────────────────────────────────────────────

std::string detect_language(const std::string& path) {
    // Extension map — byte-for-byte copy of Go's detectLanguage in utils.go.
    static const std::unordered_map<std::string, std::string> kExtMap = {
        {".js","javascript"}, {".mjs","javascript"}, {".cjs","javascript"},
        {".jsx","javascriptreact"},
        {".ts","typescript"}, {".mts","typescript"},
        {".tsx","typescriptreact"},
        {".py","python"}, {".go","go"}, {".rs","rust"},
        {".java","java"}, {".kt","kotlin"}, {".scala","scala"},
        {".c","c"}, {".cpp","cpp"}, {".cc","cpp"}, {".cxx","cpp"},
        {".h","cpp"}, {".hpp","cpp"},
        {".cs","csharp"}, {".vb","vb"},
        {".html","html"}, {".htm","html"}, {".vue","html"}, {".svelte","html"},
        {".css","css"}, {".scss","scss"}, {".less","less"},
        {".json","json"}, {".yaml","yaml"}, {".yml","yaml"}, {".toml","ini"},
        {".md","markdown"}, {".mdx","markdown"},
        {".sh","shell"}, {".bash","shell"}, {".zsh","shell"}, {".fish","shell"},
        {".ps1","powershell"},
        {".sql","sql"}, {".xml","xml"}, {".svg","xml"},
        {".swift","swift"}, {".rb","ruby"}, {".php","php"},
        {".lua","lua"}, {".r","r"},
        {".tf","hcl"}, {".hcl","hcl"},
        {".proto","protobuf"},
        {".dart","dart"}, {".ex","elixir"}, {".exs","elixir"},
    };
    fs::path p = from_u8(path);
    auto it = kExtMap.find(lower(p.extension().string()));
    if (it != kExtMap.end()) return it->second;
    std::string base = lower(p.filename().string());
    if (base == "dockerfile")                    return "dockerfile";
    if (base == "makefile" || base == "gnumakefile") return "makefile";
    return "plaintext";
}

json readdir(const std::string& path) {
    auto p = from_u8(path);
    std::error_code ec;
    json entries = json::array();
    for (auto& e : fs::directory_iterator(p, ec)) {
        if (ec) { ec.clear(); continue; }
        int64_t sz = e.is_regular_file(ec) ? static_cast<int64_t>(e.file_size(ec)) : 0;
        entries.push_back({
            {"name",  e.path().filename().u8string()},
            {"isDir", e.is_directory()},
            {"size",  sz},
            {"mtime", get_mtime(e.path())},
        });
        ec.clear();
    }
    return entries;
}

json tree(const std::string& path) {
    return build_tree(from_u8(path));
}

json readfile(const std::string& path) {
    std::ifstream f(from_u8(path), std::ios::binary);
    if (!f) return {{"error", "cannot open file"}};
    std::vector<char> data((std::istreambuf_iterator<char>(f)), {});
    return {
        {"content",  base64::encode(data.data(), data.size())},
        {"language", detect_language(path)},
    };
}

bool writefile(const std::string& path, const std::string& b64_content) {
    auto p = from_u8(path);
    std::error_code ec;
    fs::create_directories(p.parent_path(), ec);
    std::ofstream f(p, std::ios::binary | std::ios::trunc);
    if (!f) return false;
    std::string raw = base64::decode(b64_content);
    f.write(raw.data(), static_cast<std::streamsize>(raw.size()));
    return f.good();
}

bool remove_path(const std::string& path) {
    std::error_code ec;
    fs::remove_all(from_u8(path), ec);
    return !ec;
}

bool rename_path(const std::string& from, const std::string& to) {
    std::error_code ec;
    fs::rename(from_u8(from), from_u8(to), ec);
    return !ec;
}

json stat(const std::string& path) {
    auto p = from_u8(path);
    std::error_code ec;
    auto status = fs::status(p, ec);
    if (ec || !fs::exists(status))
        return {{"exists", false}, {"isDir", false}, {"size", 0}};
    int64_t sz = fs::is_regular_file(status)
                     ? static_cast<int64_t>(fs::file_size(p, ec)) : 0;
    return {{"exists", true}, {"isDir", fs::is_directory(status)}, {"size", sz}};
}

bool create_file(const std::string& path) {
    auto p = from_u8(path);
    std::error_code ec;
    fs::create_directories(p.parent_path(), ec);
    std::ofstream f(p);
    return f.good();
}

bool make_dirs(const std::string& path) {
    std::error_code ec;
    fs::create_directories(from_u8(path), ec);
    return !ec;
}

// ─── IPC dispatch ─────────────────────────────────────────────────────────────

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    if (type == "fs.readdir") {
        reply({{"entries", readdir(msg.value("path", std::string{}))}});
        return true;
    }
    if (type == "fs.tree") {
        auto t = tree(msg.value("path", std::string{}));
        if (t.is_null()) {
            reply({{"error", "not found"}});
        } else {
            t["type"] = "fs.tree.resp";
            t["id"]   = id;
            resp = std::move(t);
        }
        return true;
    }
    if (type == "fs.readfile") {
        reply(readfile(msg.value("path", std::string{})));
        return true;
    }
    if (type == "fs.writefile") {
        reply({{"ok", writefile(msg.value("path",    std::string{}),
                                msg.value("content", std::string{}))}});
        return true;
    }
    if (type == "fs.delete") {
        reply({{"ok", remove_path(msg.value("path", std::string{}))}});
        return true;
    }
    if (type == "fs.rename") {
        reply({{"ok", rename_path(msg.value("from", std::string{}),
                                  msg.value("to",   std::string{}))}});
        return true;
    }
    if (type == "fs.stat") {
        reply(stat(msg.value("path", std::string{})));
        return true;
    }
    if (type == "fs.create") {
        reply({{"ok", create_file(msg.value("path", std::string{}))}});
        return true;
    }
    if (type == "fs.mkdir") {
        reply({{"ok", make_dirs(msg.value("path", std::string{}))}});
        return true;
    }
    return false;
}

} // namespace fileops
