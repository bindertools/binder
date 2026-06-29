#include "config.hpp"

#include <spdlog/spdlog.h>
#include <filesystem>
#include <fstream>
#include <string>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace fs = std::filesystem;
using json         = nlohmann::json;
using ordered_json = nlohmann::ordered_json;

// ─── Platform-specific config root ────────────────────────────────────────────

static fs::path GetConfigRoot() {
#ifdef _WIN32
    wchar_t appdata[MAX_PATH] = {};
    GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH);
    return fs::path(appdata) / "Binder";
#elif __APPLE__
    const char* home = getenv("HOME");
    return fs::path(home ? home : "/tmp") / "Library" / "Application Support" / "Binder";
#else  // Linux / other Unix
    const char* xdg = getenv("XDG_CONFIG_HOME");
    if (xdg && *xdg) return fs::path(xdg) / "binder";
    const char* home = getenv("HOME");
    return fs::path(home ? home : "/tmp") / ".config" / "binder";
#endif
}

static fs::path GetDataRoot() {
#ifdef _WIN32
    wchar_t localapp[MAX_PATH] = {};
    GetEnvironmentVariableW(L"LOCALAPPDATA", localapp, MAX_PATH);
    return fs::path(localapp) / "Binder";
#elif __APPLE__
    const char* home = getenv("HOME");
    return fs::path(home ? home : "/tmp") / "Library" / "Application Support" / "Binder";
#else
    const char* xdg = getenv("XDG_DATA_HOME");
    if (xdg && *xdg) return fs::path(xdg) / "binder";
    const char* home = getenv("HOME");
    return fs::path(home ? home : "/tmp") / ".local" / "share" / "binder";
#endif
}

// ─── Config singleton ─────────────────────────────────────────────────────────

Config& Config::instance() {
    static Config inst;
    return inst;
}

static fs::path GetConfigPath() { return GetConfigRoot() / "config.json"; }

std::wstring Config::config_path_w() const {
#ifdef _WIN32
    return GetConfigPath().wstring();
#else
    return {};
#endif
}

// Defaults must match Go's config.Ensure() exactly — same field names, same
// values, same order as the Go struct definition (we use ordered_json for this).
// Note: default_zoom stored as integer 1 so dump() produces "1", matching Go's
// encoding/json which serialises float64(1.0) without a decimal point.
ordered_json Config::make_defaults() {
    ordered_json d;
    d["default_directory"] = "";
    d["indent_guides"]     = false;
    d["order_directory"]   = false;
    d["minimap"]           = false;
    d["theme"]             = "dark";
    d["show_timestamps"]   = false;
    ordered_json gr;
    gr["show_git_branch"]  = false;
    d["git_recognition"]   = gr;
    d["soft_close"]        = false;
    d["zoom_insights"]     = true;
    d["minimal_pwd"]       = false;
    d["default_zoom"]      = 1;   // integer → serialises as "1" like Go
    // custom_theme omitted (Go omitempty, nil by default)
    d["command_alignment"]  = "default";  // 'default' | 'top' | 'bottom'
    d["terminal_word_wrap"] = false;
    d["file_word_wrap"]     = false;
    d["scroll_speed"]       = 3;
    d["preferred_shell"]    = "";
    d["max_history"]        = 1000;
    d["installed_apps"]     = json::array();
    d["sidebar_app_order"]  = ordered_json{{"visible", json::array()}, {"overflow", json::array()}};
    return d;
}

// The installer writes this one-shot marker with the persona-selected apps to
// pre-install; consume it once on first launch and delete it so it never
// re-applies (e.g. if the user later uninstalls those apps themselves).
static void ApplyFirstRunAppsSeed(ordered_json& data) {
    auto marker = GetDataRoot() / ".first-run-apps.json";
    if (!fs::exists(marker)) return;

    std::ifstream f(marker, std::ios::binary);
    if (f) {
        try {
            auto seed = json::parse(std::string((std::istreambuf_iterator<char>(f)), {}));
            if (seed.contains("installed_apps") && seed["installed_apps"].is_array()) {
                data["installed_apps"] = seed["installed_apps"];
            }
        } catch (const json::parse_error& e) {
            spdlog::warn("config: failed to parse first-run apps seed: {}", e.what());
        }
    }
    std::error_code ec;
    fs::remove(marker, ec);
}

bool Config::load() {
    std::lock_guard<std::mutex> lk(mu_);
    data_ = make_defaults();

    auto path = GetConfigPath();

    // Create config dir and write defaults if file is absent.
    if (!fs::exists(path)) {
        std::error_code ec;
        fs::create_directories(path.parent_path(), ec);
        if (ec) {
            spdlog::warn("config: cannot create dir: {}", ec.message());
            return false;
        }
        ApplyFirstRunAppsSeed(data_);
        return save_locked();
    }

    std::ifstream f(path, std::ios::binary);
    if (!f) {
        spdlog::warn("config: cannot open config.json");
        return false;
    }
    std::string raw((std::istreambuf_iterator<char>(f)), {});

    try {
        auto parsed = ordered_json::parse(raw);

        // Merge parsed values into defaults (preserves defaults for missing keys).
        for (auto& [k, v] : parsed.items()) data_[k] = v;

        // Apply late-arriving field defaults (matches Go's load() logic).
        if (!parsed.contains("zoom_insights")) data_["zoom_insights"] = true;
        if (!parsed.contains("default_zoom"))  data_["default_zoom"]  = 1;
        if (!parsed.contains("scroll_speed"))  data_["scroll_speed"]  = 3;
        if (data_["theme"].get<std::string>().empty()) data_["theme"] = "dark";

        // Re-save so the file always has all current fields.
        save_locked();
    } catch (const json::parse_error& e) {
        spdlog::warn("config: parse error: {}", e.what());
        return false;
    }
    return true;
}

bool Config::save_locked() {
    auto path = GetConfigPath();
    auto tmp  = fs::path(path.string() + ".tmp");

    std::string text = data_.dump(2);

    std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
    if (!f) { spdlog::warn("config: cannot write tmp file"); return false; }
    f << text;
    f.close();

    // Atomic replace via filesystem rename
    std::error_code ec;
    fs::rename(tmp, path, ec);
    if (ec) {
        // Fallback: copy then delete (some platforms don't support cross-device rename)
        fs::copy_file(tmp, path, fs::copy_options::overwrite_existing, ec);
        fs::remove(tmp, ec);
        if (ec) {
            spdlog::warn("config: save failed: {}", ec.message());
            return false;
        }
    }
    return true;
}

json Config::get() const {
    std::lock_guard<std::mutex> lk(mu_);
    return json(data_); // convert ordered_json → regular json for IPC embedding
}

bool Config::set_all(const json& incoming) {
    std::lock_guard<std::mutex> lk(mu_);
    for (auto& [k, v] : incoming.items()) data_[k] = v;
    // Honour omitempty: remove custom_theme if null or empty object.
    if (data_.contains("custom_theme")) {
        auto& ct = data_["custom_theme"];
        if (ct.is_null() || (ct.is_object() && ct.empty())) data_.erase("custom_theme");
    }
    return save_locked();
}

bool Config::set(const std::string& key, const json& value) {
    std::lock_guard<std::mutex> lk(mu_);
    data_[key] = value;
    return save_locked();
}

bool Config::reset() {
    std::lock_guard<std::mutex> lk(mu_);
    data_ = make_defaults();
    return save_locked();
}

// ─── IPC dispatch ─────────────────────────────────────────────────────────────

bool config_dispatch(const std::string& type, const json& msg,
                     const std::string& id, json& resp) {
    auto& cfg = Config::instance();

    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    if (type == "config.get") {
        auto data = cfg.get();
        data["type"] = "config.get.resp";
        data["id"]   = id;
        resp = std::move(data);
        return true;
    }
    if (type == "config.setall") {
        auto incoming = msg.contains("config") ? msg["config"] : json{};
        reply({{"ok", cfg.set_all(incoming)}});
        return true;
    }
    if (type == "config.set") {
        auto key = msg.value("key", std::string{});
        auto val = msg.contains("value") ? msg["value"] : json{};
        reply({{"ok", cfg.set(key, val)}});
        return true;
    }
    if (type == "config.reset") {
        reply({{"ok", cfg.reset()}});
        return true;
    }
    return false;
}
