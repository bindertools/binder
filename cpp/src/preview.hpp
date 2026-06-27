#pragma once
#include <nlohmann/json.hpp>
#include <string>

namespace preview_ops {

// Dispatch a preview.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace preview_ops
