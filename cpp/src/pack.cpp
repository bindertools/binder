#include "pack.hpp"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

#include <zip.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace fs = std::filesystem;
using json   = nlohmann::json;

namespace pack_ops {

namespace {

// ─── Helpers ──────────────────────────────────────────────────────────────────

#ifdef _WIN32
static std::wstring to_wpath(const std::string& s) {
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

static fs::path from_u8(const std::string& s) { return fs::path(to_wpath(s)); }
#else
static fs::path from_u8(const std::string& s) { return fs::path(s); }
#endif

static std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

// ─── Entry collection — mirrors Go's pack.CollectEntries exactly ──────────────
// Skips: hidden files/dirs (leading '.'), node_modules, vendor, .git,
//        dist, build, __pycache__

struct Entry {
    std::string rel_path; // forward-slash relative path (matches Go's filepath.ToSlash)
    int64_t     size;
};

static const std::unordered_set<std::string> kSkip = {
    "node_modules", "vendor", ".git", "dist", "build", "__pycache__",
};

static std::vector<Entry> collect_entries(const fs::path& root,
                                          const std::vector<std::string>& extra_exclude) {
    // Build combined skip set (extra_exclude adds path components on top of kSkip).
    std::unordered_set<std::string> skip = kSkip;
    for (auto& ex : extra_exclude) {
        // Treat each extra exclusion as a single path component.
        auto last = ex.rfind('/');
        skip.insert(last == std::string::npos ? ex : ex.substr(last + 1));
    }

    std::vector<Entry> result;
    std::error_code ec;

    std::function<void(const fs::path&)> walk = [&](const fs::path& dir) {
        for (auto& e : fs::directory_iterator(dir, ec)) {
            ec.clear();
            auto name = e.path().filename().u8string();
            if (name.empty()) continue;

            // Skip hidden
            if (name[0] == '.') {
                continue; // hidden file or dir
            }

            if (e.is_directory(ec)) {
                if (skip.count(name)) continue;
                walk(e.path());
                continue;
            }
            if (!e.is_regular_file(ec)) continue;

            // Forward-slash relative path (matches Go's filepath.ToSlash)
            std::error_code rec;
            auto rel = fs::relative(e.path(), root, rec).generic_u8string();
            if (rec) continue;

            result.push_back({rel, (int64_t)e.file_size(ec)});
        }
    };

    walk(root);

    // Deterministic sort (matches Go's filepath.Walk lexicographic order).
    std::sort(result.begin(), result.end(),
              [](const Entry& a, const Entry& b) { return a.rel_path < b.rel_path; });
    return result;
}

// ─── Zip creation — mirrors Go's pack.CreateZip (Deflate, relative names) ────

static bool create_zip(const fs::path& root, const std::string& out_path_utf8,
                       const std::vector<Entry>& entries, std::string& err_msg) {
    // All file data is read into memory first so zip_source_buffer lifetime
    // is guaranteed through zip_close.  Skip files > 50 MB.
    static constexpr int64_t kMaxFileBytes = 50LL * 1024 * 1024;

    int zip_err = 0;
#ifdef _WIN32
    // libzip on Windows: zip_open takes a UTF-8 path but internally uses the
    // system codepage.  Convert to wide and use a short canonical path to
    // guarantee ASCII safety for the output path.
    std::wstring wout = to_wpath(out_path_utf8);
    wchar_t canon_wout[MAX_PATH] = {};
    GetFullPathNameW(wout.c_str(), MAX_PATH, canon_wout, nullptr);
    // Short path (8.3) is always ASCII-safe for libzip's ANSI open.
    wchar_t short_wout[MAX_PATH] = {};
    if (!GetShortPathNameW(canon_wout, short_wout, MAX_PATH)) {
        // 8.3 not available — fall back to trying directly.
        wcscpy_s(short_wout, MAX_PATH, canon_wout);
    }
    // Convert the (possibly short) wide path to the system codepage for libzip.
    char ansi_out[MAX_PATH] = {};
    WideCharToMultiByte(CP_ACP, 0, short_wout, -1, ansi_out, MAX_PATH, nullptr, nullptr);
    zip_t* z = zip_open(ansi_out, ZIP_CREATE | ZIP_TRUNCATE, &zip_err);
#else
    zip_t* z = zip_open(out_path_utf8.c_str(), ZIP_CREATE | ZIP_TRUNCATE, &zip_err);
#endif
    if (!z) {
        zip_error_t ze;
        zip_error_init_with_code(&ze, zip_err);
        err_msg = zip_error_strerror(&ze);
        zip_error_fini(&ze);
        return false;
    }

    // Keep all file data alive until zip_close.
    std::vector<std::string> data_store;
    data_store.reserve(entries.size());

    for (auto& e : entries) {
        if (e.size > kMaxFileBytes) {
            spdlog::warn("[pack] skipping large file: {}", e.rel_path);
            continue;
        }

        fs::path abs = root / from_u8(e.rel_path);

#ifdef _WIN32
        std::wstring wabs = abs.wstring();

        // Read file via Win32 (handles Unicode paths correctly).
        HANDLE h = CreateFileW(wabs.c_str(), GENERIC_READ, FILE_SHARE_READ,
                               nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (h == INVALID_HANDLE_VALUE) continue;

        LARGE_INTEGER fsize{};
        GetFileSizeEx(h, &fsize);
        std::string content((size_t)fsize.QuadPart, '\0');
        DWORD bytes_read = 0;
        ReadFile(h, content.data(), (DWORD)fsize.QuadPart, &bytes_read, nullptr);
        CloseHandle(h);
        content.resize(bytes_read);
#else
        std::ifstream fh(abs, std::ios::binary);
        if (!fh) continue;
        std::string content((std::istreambuf_iterator<char>(fh)), {});
#endif

        data_store.push_back(std::move(content));
        const auto& buf = data_store.back();

        zip_source_t* src = zip_source_buffer(z, buf.data(), buf.size(), 0 /*don't free*/);
        if (!src) {
            data_store.pop_back();
            continue;
        }

        // Use the forward-slash relative path as the zip entry name (Go behaviour).
        zip_int64_t idx = zip_file_add(z, e.rel_path.c_str(), src,
                                       ZIP_FL_OVERWRITE | ZIP_FL_ENC_UTF_8);
        if (idx < 0) {
            zip_source_free(src);
            data_store.pop_back();
            continue;
        }
        // Request Deflate compression (mirrors Go's zip.Deflate).
        zip_set_file_compression(z, (zip_uint64_t)idx, ZIP_CM_DEFLATE, 0);
    }

    if (zip_close(z) != 0) {
        // zip_close failed — the archive was not written.
        err_msg = "zip_close failed";
        return false;
    }
    // data_store freed here — safe after zip_close.
    return true;
}

} // namespace

// ─── IPC dispatch ─────────────────────────────────────────────────────────────

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    if (type != "pack.create") return false;

    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    auto source_path = msg.value("sourcePath", std::string{});
    auto output_path = msg.value("outputPath", std::string{});
    std::vector<std::string> exclude;
    if (msg.contains("exclude") && msg["exclude"].is_array()) {
        for (auto& ex : msg["exclude"]) {
            if (ex.is_string()) exclude.push_back(ex.get<std::string>());
        }
    }

    if (source_path.empty() || output_path.empty()) {
        reply({{"ok", false}, {"error", "sourcePath and outputPath are required"}});
        return true;
    }

    fs::path root = from_u8(source_path);
    auto entries  = collect_entries(root, exclude);

    std::string err_msg;
    if (!create_zip(root, output_path, entries, err_msg)) {
        reply({{"ok", false}, {"error", err_msg}});
        return true;
    }

    // Get output file size in MB.
    double size_mb = 0.0;
    std::error_code ec;
    auto sz = fs::file_size(from_u8(output_path), ec);
    if (!ec) size_mb = (double)sz / (1024.0 * 1024.0);

    reply({
        {"ok",         true},
        {"outputPath", output_path},
        {"fileCount",  (int)entries.size()},
        {"sizeMB",     size_mb},
    });
    return true;
}

} // namespace pack_ops
