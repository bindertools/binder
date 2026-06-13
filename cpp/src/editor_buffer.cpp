#include "editor_buffer.hpp"

#include <tree_sitter/api.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

extern "C" {
const TSLanguage* tree_sitter_json(void);
const TSLanguage* tree_sitter_javascript(void);
const TSLanguage* tree_sitter_typescript(void);
const TSLanguage* tree_sitter_tsx(void);
}

using json = nlohmann::json;

namespace {

// Build a std::filesystem::path from a UTF-8 encoded string.
std::filesystem::path from_u8(const std::string& s) {
#ifdef _WIN32
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return std::filesystem::path(std::move(w));
#else
    return std::filesystem::path(s);
#endif
}

// ── Style table ───────────────────────────────────────────────────────────────
// Fixed scope list shared with the frontend. Index = styleId in line spans.
// The frontend maps scope names to theme colors; 0 is the default style.
const std::vector<std::string> kStyles = {
    "default",      // 0
    "keyword",      // 1
    "string",       // 2
    "number",       // 3
    "comment",      // 4
    "function",     // 5
    "type",         // 6
    "property",     // 7
    "constant",     // 8
    "operator",     // 9
    "punctuation",  // 10
    "variable",     // 11
    "regexp",       // 12
    "escape",       // 13
};

int style_id(const std::string& name) {
    // Capture names may be dotted ("string.escape") — match on the first segment
    // unless the full name is itself in the table.
    auto it = std::find(kStyles.begin(), kStyles.end(), name);
    if (it != kStyles.end()) return (int)(it - kStyles.begin());
    auto dot = name.find('.');
    if (dot != std::string::npos) {
        it = std::find(kStyles.begin(), kStyles.end(), name.substr(0, dot));
        if (it != kStyles.end()) return (int)(it - kStyles.begin());
    }
    return 0;
}

// ── Highlight queries ─────────────────────────────────────────────────────────
// Hand-written, predicate-free queries. Within a line, captures are painted in
// match order, so later patterns override earlier ones — order specific
// patterns after general ones.

const char* kQueryJson = R"TSQ((string) @string
(escape_sequence) @escape
(number) @number
[(true) (false) (null)] @constant
(comment) @comment
["{" "}" "[" "]" ":" ","] @punctuation
(pair key: (string) @property)
)TSQ";

const char* kQueryJavascript = R"TSQ(
(identifier) @variable
["{" "}" "(" ")" "[" "]" ";" "," "."] @punctuation
["=" "+" "-" "*" "/" "%" "==" "===" "!=" "!==" "<" ">" "<=" ">=" "&&" "||" "!"
 "??" "?" ":" "=>" "..." "++" "--" "+=" "-=" "*=" "/=" "&" "|" "^" "~" "<<" ">>"
 ">>>"] @operator
[(this) (super)] @keyword
["var" "let" "const" "function" "class" "return" "if" "else" "for" "while" "do"
 "switch" "case" "break" "continue" "new" "delete" "typeof" "instanceof" "in"
 "of" "try" "catch" "finally" "throw" "async" "await" "yield" "import" "export"
 "from" "default" "extends" "static" "get" "set" "void" "debugger"] @keyword
(property_identifier) @property
(shorthand_property_identifier) @property
(shorthand_property_identifier_pattern) @property
(call_expression function: (identifier) @function)
(call_expression function: (member_expression property: (property_identifier) @function))
(function_declaration name: (identifier) @function)
(function_expression name: (identifier) @function)
(generator_function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function)
(arrow_function parameter: (identifier) @variable)
(class_declaration name: (identifier) @type)
(new_expression constructor: (identifier) @type)
(number) @number
[(true) (false) (null) (undefined)] @constant
(string) @string
(template_string) @string
(template_substitution ["${" "}"] @punctuation)
(regex) @regexp
(escape_sequence) @escape
(comment) @comment
)TSQ";

// TypeScript/TSX-specific additions on top of the JavaScript query. The
// upstream tree-sitter-typescript highlights.scm "inherits" the javascript
// one via an editor convention; since our query engine has no such
// mechanism, concatenate them. Predicate-based rules (e.g. `#match?`) are
// omitted since matches aren't filtered by predicates here.
const char* kQueryTypescriptExtra = R"TSQ(
(type_identifier) @type
(predefined_type) @type.builtin
(type_arguments
  "<" @punctuation.bracket
  ">" @punctuation.bracket)
(required_parameter (identifier) @variable.parameter)
(optional_parameter (identifier) @variable.parameter)
[ "abstract" "declare" "enum" "implements" "interface" "keyof" "namespace"
  "private" "protected" "public" "type" "readonly" "override" "satisfies"
] @keyword
)TSQ";

const std::string kQueryTypescript = std::string(kQueryJavascript) + kQueryTypescriptExtra;

struct LanguageDef {
    const char* name;
    const TSLanguage* (*fn)(void);
    const char* query_src;
};

const LanguageDef kLanguages[] = {
    {"json",       tree_sitter_json,       kQueryJson},
    {"javascript", tree_sitter_javascript, kQueryJavascript},
    {"typescript", tree_sitter_typescript, kQueryTypescript.c_str()},
    {"tsx",        tree_sitter_tsx,        kQueryTypescript.c_str()},
};

const LanguageDef* language_for_path(const std::string& path) {
    auto dot = path.find_last_of('.');
    if (dot == std::string::npos) return nullptr;
    std::string ext = path.substr(dot + 1);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    if (ext == "json" || ext == "jsonc")                return &kLanguages[0];
    if (ext == "js" || ext == "mjs" || ext == "cjs" ||
        ext == "jsx")                                   return &kLanguages[1];
    if (ext == "ts" || ext == "mts" || ext == "cts")    return &kLanguages[2];
    if (ext == "tsx")                                   return &kLanguages[3];
    return nullptr;
}

// Compiled query cache (one per language, compiled on first use).
struct CompiledQuery {
    TSQuery* query = nullptr;
    std::vector<int> capture_styles; // capture index → styleId
};

CompiledQuery* compiled_query_for(const LanguageDef* lang) {
    static std::map<const LanguageDef*, std::unique_ptr<CompiledQuery>> cache;
    static std::mutex mu;
    std::lock_guard<std::mutex> lk(mu);
    auto it = cache.find(lang);
    if (it != cache.end()) return it->second.get();

    uint32_t err_offset = 0;
    TSQueryError err_type = TSQueryErrorNone;
    TSQuery* q = ts_query_new(lang->fn(), lang->query_src,
                              (uint32_t)strlen(lang->query_src),
                              &err_offset, &err_type);
    auto cq = std::make_unique<CompiledQuery>();
    if (!q) {
        spdlog::error("editor: highlight query failed for {} at offset {} (err {})",
                      lang->name, err_offset, (int)err_type);
    } else {
        cq->query = q;
        uint32_t n = ts_query_capture_count(q);
        cq->capture_styles.resize(n, 0);
        for (uint32_t i = 0; i < n; i++) {
            uint32_t len = 0;
            const char* nm = ts_query_capture_name_for_id(q, i, &len);
            cq->capture_styles[i] = style_id(std::string(nm, len));
        }
    }
    auto* raw = cq.get();
    cache[lang] = std::move(cq);
    return raw;
}

// ── Buffer ────────────────────────────────────────────────────────────────────

struct Buffer {
    int id = 0;
    std::string path;
    std::string text;                    // UTF-8
    std::vector<uint32_t> line_offsets;  // byte offset of each line start
    const LanguageDef* lang = nullptr;
    TSParser* parser = nullptr;
    TSTree* tree = nullptr;
    int version = 1;
    int refcount = 1;
    bool dirty = false;
    json view_state;                     // opaque frontend state (cursor/scroll)

    ~Buffer() {
        if (tree) ts_tree_delete(tree);
        if (parser) ts_parser_delete(parser);
    }

    void rebuild_line_offsets() {
        line_offsets.clear();
        line_offsets.push_back(0);
        for (uint32_t i = 0; i < text.size(); i++) {
            if (text[i] == '\n') line_offsets.push_back(i + 1);
        }
    }

    uint32_t line_count() const { return (uint32_t)line_offsets.size(); }

    // Byte range of a line, excluding the trailing newline.
    void line_bytes(uint32_t line, uint32_t& start, uint32_t& end) const {
        start = line_offsets[line];
        end = (line + 1 < line_offsets.size()) ? line_offsets[line + 1]
                                               : (uint32_t)text.size();
        while (end > start && (text[end - 1] == '\n' || text[end - 1] == '\r')) end--;
    }

    void parse() {
        if (!parser) return;
        TSTree* nt = ts_parser_parse_string(parser, tree, text.data(),
                                            (uint32_t)text.size());
        if (tree) ts_tree_delete(tree);
        tree = nt;
    }
};

std::mutex g_mu;
std::map<int, std::unique_ptr<Buffer>> g_buffers;
int g_next_id = 1;

Buffer* find_buffer(int id) {
    auto it = g_buffers.find(id);
    return it == g_buffers.end() ? nullptr : it->second.get();
}

// ── UTF-8 / UTF-16 column conversion ─────────────────────────────────────────
// IPC columns are UTF-16 code units (JS string indexing); internal offsets are
// UTF-8 bytes. Fast path: pure-ASCII lines are identity.

uint32_t byte_to_u16_col(const std::string& text, uint32_t line_start,
                         uint32_t byte_off) {
    uint32_t col = 0;
    uint32_t i = line_start;
    while (i < byte_off && i < text.size()) {
        unsigned char c = (unsigned char)text[i];
        if (c < 0x80)       { i += 1; col += 1; }
        else if (c < 0xE0)  { i += 2; col += 1; }
        else if (c < 0xF0)  { i += 3; col += 1; }
        else                { i += 4; col += 2; } // astral plane → surrogate pair
    }
    return col;
}

uint32_t u16_col_to_byte(const std::string& text, uint32_t line_start,
                         uint32_t line_end, uint32_t u16_col) {
    uint32_t col = 0;
    uint32_t i = line_start;
    while (i < line_end && col < u16_col) {
        unsigned char c = (unsigned char)text[i];
        if (c < 0x80)       { i += 1; col += 1; }
        else if (c < 0xE0)  { i += 2; col += 1; }
        else if (c < 0xF0)  { i += 3; col += 1; }
        else                { i += 4; col += 2; }
    }
    return i;
}

bool line_is_ascii(const std::string& text, uint32_t start, uint32_t end) {
    for (uint32_t i = start; i < end; i++)
        if ((unsigned char)text[i] >= 0x80) return false;
    return true;
}

// ── Highlight span computation ───────────────────────────────────────────────
// Returns per-line spans for [first, last]: each line a list of
// [startCol, endCol, styleId] in UTF-16 columns. Captures are painted into a
// per-line style array in match order (later patterns win), then RLE-packed.

json compute_lines(Buffer& buf, uint32_t first, uint32_t last) {
    json lines = json::array();
    uint32_t nlines = buf.line_count();
    if (first >= nlines) return lines;
    last = std::min(last, nlines - 1);

    // Per-line style paint arrays (byte-indexed within the line)
    std::vector<std::vector<uint8_t>> paint(last - first + 1);
    std::vector<std::pair<uint32_t, uint32_t>> bounds(last - first + 1);
    for (uint32_t ln = first; ln <= last; ln++) {
        uint32_t s, e;
        buf.line_bytes(ln, s, e);
        bounds[ln - first] = {s, e};
        paint[ln - first].assign(e - s, 0);
    }

    CompiledQuery* cq = buf.lang ? compiled_query_for(buf.lang) : nullptr;
    if (cq && cq->query && buf.tree) {
        TSQueryCursor* cursor = ts_query_cursor_new();
        uint32_t range_start = bounds.front().first;
        uint32_t range_end = (last + 1 < nlines) ? buf.line_offsets[last + 1]
                                                 : (uint32_t)buf.text.size();
        ts_query_cursor_set_byte_range(cursor, range_start, range_end);
        ts_query_cursor_exec(cursor, cq->query, ts_tree_root_node(buf.tree));

        TSQueryMatch match;
        while (ts_query_cursor_next_match(cursor, &match)) {
            for (uint16_t ci = 0; ci < match.capture_count; ci++) {
                const TSQueryCapture& cap = match.captures[ci];
                int style = cq->capture_styles[cap.index];
                if (style == 0) continue;
                uint32_t ns = ts_node_start_byte(cap.node);
                uint32_t ne = ts_node_end_byte(cap.node);
                for (uint32_t ln = first; ln <= last; ln++) {
                    auto [ls, le] = bounds[ln - first];
                    uint32_t s = std::max(ns, ls), e = std::min(ne, le);
                    if (s >= e) continue;
                    std::fill(paint[ln - first].begin() + (s - ls),
                              paint[ln - first].begin() + (e - ls),
                              (uint8_t)style);
                }
            }
        }
        ts_query_cursor_delete(cursor);
    }

    // RLE-pack the paint arrays into spans, converting columns to UTF-16.
    for (uint32_t ln = first; ln <= last; ln++) {
        auto [ls, le] = bounds[ln - first];
        const auto& p = paint[ln - first];
        json spans = json::array();
        bool ascii = line_is_ascii(buf.text, ls, le);
        uint32_t i = 0;
        while (i < p.size()) {
            uint8_t st = p[i];
            uint32_t j = i;
            while (j < p.size() && p[j] == st) j++;
            if (st != 0) {
                uint32_t cs = ascii ? i : byte_to_u16_col(buf.text, ls, ls + i);
                uint32_t ce = ascii ? j : byte_to_u16_col(buf.text, ls, ls + j);
                spans.push_back({cs, ce, st});
            }
            i = j;
        }
        lines.push_back({
            {"text", std::string(buf.text.data() + ls, le - ls)},
            {"spans", std::move(spans)},
        });
    }
    return lines;
}

// ── TSPoint helper: row + byte column for a byte offset ──────────────────────

TSPoint point_for_byte(const Buffer& buf, uint32_t byte_off) {
    auto it = std::upper_bound(buf.line_offsets.begin(), buf.line_offsets.end(),
                               byte_off);
    uint32_t row = (uint32_t)(it - buf.line_offsets.begin()) - 1;
    return {row, byte_off - buf.line_offsets[row]};
}

// ── Operations ────────────────────────────────────────────────────────────────

json op_open(const json& msg) {
    std::string path = msg.value("path", "");
    if (path.empty()) return {{"ok", false}, {"error", "path required"}};

    std::lock_guard<std::mutex> lk(g_mu);

    // Re-use an existing warm buffer for the same path.
    for (auto& kv : g_buffers) {
        if (kv.second->path == path) {
            kv.second->refcount++;
            Buffer& b = *kv.second;
            return {{"bufferId", b.id},
                    {"lineCount", b.line_count()},
                    {"language", b.lang ? b.lang->name : "plaintext"},
                    {"version", b.version}, {"styles", kStyles},
                    {"existing", true}};
        }
    }

    std::ifstream f(from_u8(path), std::ios::binary);
    if (!f) return {{"ok", false}, {"error", "cannot open file: " + path}};

    auto buf = std::make_unique<Buffer>();
    buf->id = g_next_id++;
    buf->path = path;
    buf->text.assign(std::istreambuf_iterator<char>(f),
                     std::istreambuf_iterator<char>());
    // Normalize CRLF → LF so byte offsets match what the frontend renders.
    std::string norm;
    norm.reserve(buf->text.size());
    for (size_t i = 0; i < buf->text.size(); i++) {
        if (buf->text[i] == '\r' &&
            i + 1 < buf->text.size() && buf->text[i + 1] == '\n') continue;
        norm.push_back(buf->text[i]);
    }
    buf->text = std::move(norm);
    buf->rebuild_line_offsets();

    buf->lang = language_for_path(path);
    if (buf->lang) {
        buf->parser = ts_parser_new();
        ts_parser_set_language(buf->parser, buf->lang->fn());
        buf->parse();
    }

    Buffer& b = *buf;
    g_buffers[b.id] = std::move(buf);
    spdlog::info("editor: opened {} as buffer {} ({} lines, lang={})",
                 path, b.id, b.line_count(), b.lang ? b.lang->name : "plaintext");
    return {{"bufferId", b.id}, {"lineCount", b.line_count()},
            {"language", b.lang ? b.lang->name : "plaintext"},
            {"version", b.version}, {"styles", kStyles}, {"existing", false}};
}

json op_lines(const json& msg) {
    int id = msg.value("bufferId", 0);
    uint32_t first = msg.value("start", 0u);
    uint32_t last = msg.value("end", 0u);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    return {{"version", b->version}, {"start", first},
            {"lines", compute_lines(*b, first, last)}};
}

// Apply one edit: replace [startLine:startCol, endLine:endCol) with text.
// Columns are UTF-16; converted to bytes here.
void apply_edit(Buffer& b, uint32_t sl, uint32_t sc, uint32_t el, uint32_t ec,
                const std::string& ins) {
    uint32_t nlines = b.line_count();
    sl = std::min(sl, nlines - 1);
    el = std::min(el, nlines - 1);
    uint32_t ls, le;
    b.line_bytes(sl, ls, le);
    uint32_t start_byte = u16_col_to_byte(b.text, ls, le, sc);
    b.line_bytes(el, ls, le);
    uint32_t end_byte = u16_col_to_byte(b.text, ls, le, ec);
    if (end_byte < start_byte) std::swap(start_byte, end_byte);

    TSInputEdit edit;
    edit.start_byte = start_byte;
    edit.old_end_byte = end_byte;
    edit.new_end_byte = start_byte + (uint32_t)ins.size();
    edit.start_point = point_for_byte(b, start_byte);
    edit.old_end_point = point_for_byte(b, end_byte);

    b.text.replace(start_byte, end_byte - start_byte, ins);
    b.rebuild_line_offsets();
    edit.new_end_point = point_for_byte(b, edit.new_end_byte);

    if (b.tree) ts_tree_edit(b.tree, &edit);
}

json op_edit(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    if (!msg.contains("edits") || !msg["edits"].is_array())
        return {{"ok", false}, {"error", "edits array required"}};

    uint32_t dirty_start = UINT32_MAX, dirty_end = 0;
    for (const auto& e : msg["edits"]) {
        uint32_t sl = e.value("startLine", 0u), sc = e.value("startCol", 0u);
        uint32_t el = e.value("endLine", 0u),   ec = e.value("endCol", 0u);
        std::string text = e.value("text", "");
        apply_edit(*b, sl, sc, el, ec, text);
        dirty_start = std::min(dirty_start, sl);
        dirty_end = b->line_count() - 1; // conservative; refined below via tree
    }

    if (b->parser) {
        TSTree* old_tree = b->tree;
        b->tree = nullptr;
        TSTree* nt = ts_parser_parse_string(b->parser, old_tree, b->text.data(),
                                            (uint32_t)b->text.size());
        if (old_tree) {
            uint32_t nranges = 0;
            TSRange* ranges = ts_tree_get_changed_ranges(old_tree, nt, &nranges);
            // Use the tree's changed ranges to bound re-highlighting precisely;
            // structural changes (e.g. opening a block comment) can dirty lines
            // far beyond the text edit itself.
            for (uint32_t i = 0; i < nranges; i++) {
                dirty_start = std::min(dirty_start, ranges[i].start_point.row);
                dirty_end = std::max(dirty_end == b->line_count() - 1 ? 0 : dirty_end,
                                     ranges[i].end_point.row);
            }
            if (nranges > 0) free(ranges);
            ts_tree_delete(old_tree);
        }
        b->tree = nt;
    }

    b->version++;
    b->dirty = true;
    if (dirty_start == UINT32_MAX) dirty_start = 0;
    dirty_end = std::min(std::max(dirty_end, dirty_start), b->line_count() - 1);
    return {{"version", b->version}, {"lineCount", b->line_count()},
            {"dirtyStart", dirty_start}, {"dirtyEnd", dirty_end}};
}

json op_save(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    std::ofstream f(from_u8(b->path), std::ios::binary | std::ios::trunc);
    if (!f) return {{"ok", false}, {"error", "cannot write file: " + b->path}};
    f.write(b->text.data(), (std::streamsize)b->text.size());
    b->dirty = false;
    return {{"saved", true}};
}

json op_close(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    if (--b->refcount <= 0) g_buffers.erase(id);
    return {{"closed", true}};
}

json op_viewstate_set(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    b->view_state = msg.value("state", json::object());
    return json::object();
}

json op_viewstate_get(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    return {{"state", b->view_state}};
}

json op_buffers(const json&) {
    std::lock_guard<std::mutex> lk(g_mu);
    json arr = json::array();
    for (auto& kv : g_buffers) {
        arr.push_back({{"bufferId", kv.first}, {"path", kv.second->path},
                       {"lineCount", kv.second->line_count()},
                       {"dirty", kv.second->dirty},
                       {"version", kv.second->version}});
    }
    return {{"buffers", arr}};
}

} // namespace

namespace editor_ops {

bool dispatch(const std::string& type, const json& msg,
              const std::string& /*id*/, json& resp) {
    if (type.rfind("editor.", 0) != 0) return false;
    if      (type == "editor.open")          resp = op_open(msg);
    else if (type == "editor.lines")         resp = op_lines(msg);
    else if (type == "editor.edit")          resp = op_edit(msg);
    else if (type == "editor.save")          resp = op_save(msg);
    else if (type == "editor.close")         resp = op_close(msg);
    else if (type == "editor.viewstate.set") resp = op_viewstate_set(msg);
    else if (type == "editor.viewstate.get") resp = op_viewstate_get(msg);
    else if (type == "editor.buffers")       resp = op_buffers(msg);
    else return false;
    return true;
}

} // namespace editor_ops
