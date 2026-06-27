#pragma once
#include <nlohmann/json.hpp>
#include <string>

namespace fileops {

// Flat directory listing: [{name, isDir, size, mtime}, ...]
nlohmann::json readdir(const std::string& path);

// Recursive FileNode tree matching Go's fullscreen.buildTree output.
nlohmann::json tree(const std::string& path);

// Read file; returns {content:<b64>, language:<monaco-id>}.
nlohmann::json readfile(const std::string& path);

// Write base64-encoded bytes to path (creates parent dirs). Returns success.
bool writefile(const std::string& path, const std::string& b64_content);

// Remove file or directory recursively.
bool remove_path(const std::string& path);

// Rename / move.
bool rename_path(const std::string& from, const std::string& to);

// Stat: {exists, isDir, size}.
nlohmann::json stat(const std::string& path);

// Create an empty file (creates parent dirs).
bool create_file(const std::string& path);

// Create directories recursively.
bool make_dirs(const std::string& path);

// Monaco language ID — byte-for-byte match with Go's detectLanguage.
std::string detect_language(const std::string& path);

// Dispatch an fs.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace fileops
