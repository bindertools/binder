#pragma once
#include <nlohmann/json.hpp>
#include <string>

// SQLite read/write for the Database app (browse + inline cell/row/column
// edits). Originally inlined directly in Dispatcher::dispatch_worker; each
// handler ran its own work on a freshly spawned detached thread because the
// IPC call itself wasn't guaranteed to already be off the UI thread at the
// time. The dispatch() entry point here runs synchronously instead -- the
// host (and the app_plugin_loader DLL dispatch path) already calls it from
// a per-request worker thread, so a second nested thread was redundant.
namespace database_ops {

// Dispatch a db.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace database_ops
