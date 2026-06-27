#pragma once
#include <nlohmann/json.hpp>
#include <mutex>
#include <string>

// Config singleton — owns the in-memory config and all disk I/O.
// JSON is serialized with nlohmann::ordered_json (preserves insertion order)
// to produce the same field order as Go's struct-tag marshaling.
class Config {
public:
    static Config& instance();

    // Load from %APPDATA%\Binder\config.json; create with defaults if absent.
    bool load();

    // Overwrite all keys from incoming (preserves key order of stored data).
    bool set_all(const nlohmann::json& incoming);

    // Set a single top-level key and persist.
    bool set(const std::string& key, const nlohmann::json& value);

    // Restore defaults and persist.
    bool reset();

    // Return a copy of the current config as a plain json object.
    nlohmann::json get() const;

private:
    Config() = default;

    static nlohmann::ordered_json make_defaults();
    std::wstring config_path_w() const;
    bool save_locked(); // must hold mu_

    mutable std::mutex         mu_;
    nlohmann::ordered_json     data_;
};

// Dispatch a config.* IPC message. Fills resp; returns true if handled.
bool config_dispatch(const std::string& type, const nlohmann::json& msg,
                     const std::string& id, nlohmann::json& resp);
