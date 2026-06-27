#pragma once

#include <nlohmann/json.hpp>
#include <functional>
#include <string>

// Native recursive directory-tree watcher.
//
// Windows: a single recursive ReadDirectoryChangesW watch on the given root,
// running on a background thread. Changes are debounced (~200ms) and
// deduped by containing directory, then emitted as "fs:changed"
// {"dirs": [...]} (forward-slash absolute paths) via the supplied callback.
//
// Other platforms: explicit no-op stub — deferred, see file_watcher.cpp.
namespace file_watcher {

using EmitFn = std::function<void(const std::string& event, const nlohmann::json& data)>;

// (Re)start watching `path` recursively, replacing any previous watch.
void start(const std::string& path, EmitFn emit);

// Stop the active watch, if any. Safe to call even if nothing is running.
void stop();

} // namespace file_watcher
