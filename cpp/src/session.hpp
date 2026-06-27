#pragma once
#include <nlohmann/json.hpp>
#include <string>

namespace session_ops {

// Dispatch a session.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace session_ops
