#pragma once
#include <nlohmann/json.hpp>
#include <string>

namespace git_ops {

// Dispatch a git.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace git_ops
