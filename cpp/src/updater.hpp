#pragma once
#include <nlohmann/json.hpp>
#include <string>

namespace updater_ops {

// Dispatch an updater.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace updater_ops
