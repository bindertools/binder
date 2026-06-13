#pragma once
#include <nlohmann/json.hpp>
#include <string>

// Backend-resident editor buffers: file text, tree-sitter parse trees and
// highlight computation live here, keyed by buffer id. Buffers stay warm
// (parsed, highlighted, view state intact) independent of which frontend
// tab displays them.
//
// IPC surface (all editor.*):
//   editor.open      {path}                          → {bufferId, lineCount, language, version, styles,
//                                                        eol: "LF"|"CRLF", dirty, existing}
//   editor.lines     {bufferId, start, end}          → {version, lines: [{text, spans: [[s,e,style],…]}]}
//   editor.edit      {bufferId, edits: [{startLine,startCol,endLine,endCol,text}],
//                      cursorLine?, cursorCol?}      → {version, lineCount, dirtyStart, dirtyEnd}
//   editor.undo      {bufferId}                      → {applied, version, lineCount,
//                                                        dirtyStart, dirtyEnd, cursorLine, cursorCol}
//   editor.redo      {bufferId}                      → {applied, version, lineCount,
//                                                        dirtyStart, dirtyEnd, cursorLine, cursorCol}
//   editor.matchBracket {bufferId, line, col}        → {found, anchorLine, anchorCol,
//                                                        matchLine, matchCol} | {found: false}
//   editor.save      {bufferId}                      → {saved}
//   editor.close     {bufferId}                      → {closed}
//   editor.viewstate.set {bufferId, viewKey?, state} → {}
//   editor.viewstate.get {bufferId, viewKey?}        → {state}
//                          viewKey lets two panes showing the same buffer
//                          (editor.open refcounts by path) keep independent
//                          cursor/scroll; omitted = shared "" key.
//   editor.buffers   {}                              → {buffers: [{bufferId, path, lineCount, dirty}]}
//
// Columns in the IPC contract are UTF-16 code units (JS string indexing).

namespace editor_ops {

// Dispatch an editor.* IPC message. Fills resp; returns true if handled.
bool dispatch(const std::string& type, const nlohmann::json& msg,
              const std::string& id, nlohmann::json& resp);

} // namespace editor_ops
