#pragma once
#include <string>

// Tracks child processes spawned for in-flight workflow runs so they can be
// terminated cooperatively when the user clicks "Stop".
namespace process_registry {

#ifdef _WIN32
using ProcessHandle = void*; // HANDLE
#else
using ProcessHandle = long;  // pid_t
#endif

// Registers the running child process for `runId`. Overwrites any previous
// registration for the same runId.
void register_process(const std::string& runId, ProcessHandle handle);

// Removes the registration for `runId`. Call once the process has exited.
void unregister_process(const std::string& runId);

// Terminates the process registered for `runId`, if any. No-op if nothing
// is registered (also a no-op on non-Windows for now).
void terminate_process(const std::string& runId);

} // namespace process_registry
