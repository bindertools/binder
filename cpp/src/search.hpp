#pragma once
#include <nlohmann/json.hpp>
#include <string>

namespace search_ops {

// Dispatch a search.* or complete.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace search_ops
