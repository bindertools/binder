#pragma once
#include <nlohmann/json.hpp>
#include <string>

// Local-machine TCP/UDP port forwarding (a relay, not a router/UPnP/NAT
// forward — it only binds a listening socket on this machine and pumps
// bytes to another host:port reachable from this machine).
namespace port_forward {

// Dispatch a portforward.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

// Start any rules persisted with enabled=true. Call once at startup.
void start_persisted();

// Stop every running relay thread. Call at shutdown.
void stop_all();

} // namespace port_forward
