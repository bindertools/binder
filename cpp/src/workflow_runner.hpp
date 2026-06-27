#pragma once
#include <nlohmann/json.hpp>
#include <functional>
#include <string>

// Native local runner for GitHub Actions workflows. Replaces the old
// `act`-based runner: parses the workflow YAML (workflow_yaml), copies the
// project into an isolated temp sandbox, walks jobs/steps in dependency
// order, evaluates `${{ }}` expressions (workflow_expr), and runs `run:`
// steps via bash/pwsh/cmd/python. `uses:` steps get a small set of native
// shims (checkout/setup-node/setup-python/cache); anything else is skipped
// with an inline notice.
namespace workflow_runner {

using EmitFn = std::function<void(const std::string& event, const nlohmann::json& data)>;

// Parses `<path>/.github/workflows/<file>`, prepares an isolated sandbox
// copy of `path`, and runs its jobs/steps. Streams merged stdout/stderr via
// emit("workflows:output:<runId>", chunk), per-step status via
// emit("workflows:step:<runId>", {job, jobName, stepIndex, stepName, status}),
// and finishes with emit("workflows:done:<runId>", {"code": 0|1|-1}).
// Blocks until the run completes or is stopped via stop_workflow(). Safe to
// call from a worker thread.
void run_workflow(const std::string& path, const std::string& file,
                   const std::string& runId, const EmitFn& emit);

// Requests cooperative termination of the run identified by `runId`: sets a
// flag checked between steps and terminates any in-flight child process.
void stop_workflow(const std::string& runId);

} // namespace workflow_runner
