#pragma once
#include <nlohmann/json.hpp>
#include <functional>
#include <string>

namespace workflows_ops {

// Dispatch a workflows.* IPC message (list/read/checkRunner). Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

using EmitFn = std::function<void(const std::string& event, const nlohmann::json& data)>;

} // namespace workflows_ops
