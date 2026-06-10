#pragma once
#include <nlohmann/json.hpp>
#include <functional>
#include <string>

namespace workflows_ops {

// Dispatch a workflows.* IPC message (list/read/checkAct). Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

using EmitFn = std::function<void(const std::string& event, const nlohmann::json& data)>;

// Run `act` for a workflow file, streaming merged stdout/stderr via
// emit("workflows:output:<runId>", chunk) and finishing with
// emit("workflows:done:<runId>", {"code": exitCode}). Blocks until the
// process exits or is stopped via stop_act(). Safe to call from a worker thread.
void run_act(const std::string& path, const std::string& file,
              const std::string& runId, const EmitFn& emit);

// Terminate a running act process started by run_act(), if any.
void stop_act(const std::string& runId);

} // namespace workflows_ops
