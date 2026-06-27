#pragma once
#include <nlohmann/json.hpp>
#include <string>

namespace pack_ops {

// Dispatch a pack.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace pack_ops
