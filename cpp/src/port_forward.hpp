#pragma once
#include <nlohmann/json.hpp>
#include <string>

struct BinderHostApi;

// Local-machine TCP/UDP port forwarding (a relay, not a router/UPnP/NAT
// forward — it only binds a listening socket on this machine and pumps
// bytes to another host:port reachable from this machine).
namespace port_forward {

// Must be called once before start_persisted()/dispatch() when built as the
// app_ports backend DLL -- persisted rules are read/written through this
// instead of linking config.cpp directly (see app_plugin_abi.h).
void set_host_api(const BinderHostApi* api);

// Dispatch a portforward.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

// Start any rules persisted with enabled=true. Call once at startup.
void start_persisted();

// Stop every running relay thread. Call at shutdown.
void stop_all();

} // namespace port_forward
