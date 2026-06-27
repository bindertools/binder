#include "process_registry.hpp"

#include <map>
#include <mutex>

#ifdef _WIN32
#  include <windows.h>
#endif

namespace process_registry {

namespace {
std::mutex g_mu;
std::map<std::string, ProcessHandle> g_running;
} // namespace

void register_process(const std::string& runId, ProcessHandle handle) {
    std::lock_guard<std::mutex> lk(g_mu);
    g_running[runId] = handle;
}

void unregister_process(const std::string& runId) {
    std::lock_guard<std::mutex> lk(g_mu);
    g_running.erase(runId);
}

void terminate_process(const std::string& runId) {
    std::lock_guard<std::mutex> lk(g_mu);
    auto it = g_running.find(runId);
    if (it == g_running.end()) return;
#ifdef _WIN32
    TerminateProcess((HANDLE)it->second, 1);
#endif
}

} // namespace process_registry
