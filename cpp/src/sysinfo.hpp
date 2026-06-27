#pragma once
#include <nlohmann/json.hpp>
#include <string>

namespace sysinfo_ops {

// Dispatch a sysinfo.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace sysinfo_ops
