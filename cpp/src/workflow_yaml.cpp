#include "workflow_yaml.hpp"

#include <cctype>
#include <cstdlib>
#include <sstream>
#include <tuple>

namespace workflow_yaml {

using json = nlohmann::json;

// ───────────────────────────── YamlNode ────────────────────────────────────

const YamlNode& YamlNode::get(const std::string& key) const {
    static const YamlNode kNull{};
    if (type != NodeType::Mapping) return kNull;
    for (auto& kv : map) {
        if (kv.first == key) return kv.second;
    }
    return kNull;
}

bool YamlNode::has(const std::string& key) const {
    if (type != NodeType::Mapping) return false;
    for (auto& kv : map) {
        if (kv.first == key) return true;
    }
    return false;
}

std::string YamlNode::asString(const std::string& def) const {
    if (type != NodeType::Scalar) return def;
    return scalar;
}

bool YamlNode::asBool(bool def) const {
    if (type != NodeType::Scalar) return def;
    std::string lower;
    lower.reserve(scalar.size());
    for (char c : scalar) lower += (char)std::tolower((unsigned char)c);
    if (lower == "true") return true;
    if (lower == "false") return false;
    return def;
}

double YamlNode::asNumber(double def) const {
    if (type != NodeType::Scalar) return def;
    try {
        size_t consumed = 0;
        double v = std::stod(scalar, &consumed);
        if (consumed == 0) return def;
        return v;
    } catch (...) {
        return def;
    }
}

json YamlNode::toJson() const {
    switch (type) {
        case NodeType::Null:
            return nullptr;
        case NodeType::Scalar: {
            if (!quoted) {
                std::string lower;
                lower.reserve(scalar.size());
                for (char c : scalar) lower += (char)std::tolower((unsigned char)c);
                if (lower == "true") return true;
                if (lower == "false") return false;
                if (lower == "null" || lower == "~" || scalar.empty()) return nullptr;
                char* end = nullptr;
                double d = std::strtod(scalar.c_str(), &end);
                if (end && *end == '\0' && end != scalar.c_str()) return d;
            }
            return scalar;
        }
        case NodeType::Sequence: {
            json arr = json::array();
            for (auto& item : seq) arr.push_back(item.toJson());
            return arr;
        }
        case NodeType::Mapping: {
            json obj = json::object();
            for (auto& kv : map) obj[kv.first] = kv.second.toJson();
            return obj;
        }
    }
    return nullptr;
}

// ───────────────────────────── helpers ─────────────────────────────────────

namespace {

std::string rtrim(const std::string& s) {
    size_t end = s.find_last_not_of(" \t");
    if (end == std::string::npos) return "";
    return s.substr(0, end + 1);
}

std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t");
    if (a == std::string::npos) return "";
    size_t b = s.find_last_not_of(" \t");
    return s.substr(a, b - a + 1);
}

// Strips a trailing `# comment`, respecting single/double quotes. A '#'
// only starts a comment at the start of the (already-indent-stripped)
// content or when preceded by whitespace.
std::string strip_comment(const std::string& s) {
    bool inSingle = false, inDouble = false;
    for (size_t i = 0; i < s.size(); i++) {
        char c = s[i];
        if (inSingle) {
            if (c == '\'') inSingle = false;
            continue;
        }
        if (inDouble) {
            if (c == '\\' && i + 1 < s.size()) { i++; continue; }
            if (c == '"') inDouble = false;
            continue;
        }
        if (c == '\'') { inSingle = true; continue; }
        if (c == '"') { inDouble = true; continue; }
        if (c == '#' && (i == 0 || s[i - 1] == ' ' || s[i - 1] == '\t')) {
            return s.substr(0, i);
        }
    }
    return s;
}

// Finds the first top-level "key: value" colon (a colon followed by a space
// or end-of-string, outside quotes and flow brackets).
size_t find_top_level_colon(const std::string& s) {
    bool inSingle = false, inDouble = false;
    int depth = 0;
    for (size_t i = 0; i < s.size(); i++) {
        char c = s[i];
        if (inSingle) {
            if (c == '\'') inSingle = false;
            continue;
        }
        if (inDouble) {
            if (c == '\\' && i + 1 < s.size()) { i++; continue; }
            if (c == '"') inDouble = false;
            continue;
        }
        if (c == '\'') { inSingle = true; continue; }
        if (c == '"') { inDouble = true; continue; }
        if (c == '[' || c == '{') { depth++; continue; }
        if (c == ']' || c == '}') { depth--; continue; }
        if (depth == 0 && c == ':') {
            if (i + 1 == s.size() || s[i + 1] == ' ') return i;
        }
    }
    return std::string::npos;
}

// Splits on a top-level delimiter, respecting quotes and nested [] / {}.
std::vector<std::string> split_top_level(const std::string& s, char delim) {
    std::vector<std::string> out;
    bool inSingle = false, inDouble = false;
    int depth = 0;
    std::string cur;
    for (size_t i = 0; i < s.size(); i++) {
        char c = s[i];
        if (inSingle) {
            cur += c;
            if (c == '\'') inSingle = false;
            continue;
        }
        if (inDouble) {
            cur += c;
            if (c == '\\' && i + 1 < s.size()) { cur += s[++i]; continue; }
            if (c == '"') inDouble = false;
            continue;
        }
        if (c == '\'') { inSingle = true; cur += c; continue; }
        if (c == '"') { inDouble = true; cur += c; continue; }
        if (c == '[' || c == '{') { depth++; cur += c; continue; }
        if (c == ']' || c == '}') { depth--; cur += c; continue; }
        if (depth == 0 && c == delim) {
            out.push_back(cur);
            cur.clear();
            continue;
        }
        cur += c;
    }
    if (!cur.empty() || !out.empty()) out.push_back(cur);
    return out;
}

std::string unescape_double_quoted(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\\' && i + 1 < s.size()) {
            char c = s[i + 1];
            switch (c) {
                case 'n': out += '\n'; break;
                case 't': out += '\t'; break;
                case 'r': out += '\r'; break;
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                default: out += c; break;
            }
            i++;
        } else {
            out += s[i];
        }
    }
    return out;
}

std::string unescape_single_quoted(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\'' && i + 1 < s.size() && s[i + 1] == '\'') {
            out += '\'';
            i++;
        } else {
            out += s[i];
        }
    }
    return out;
}

// ───────────────────────────── parser ──────────────────────────────────────

class Parser {
public:
    explicit Parser(std::vector<std::string> rawLines) : lines_(std::move(rawLines)) {}

    YamlNode parseDocument() {
        if (eof()) return YamlNode{};
        auto [indent, text] = peek();
        return parseBlock(indent);
    }

private:
    std::vector<std::string> lines_;
    size_t pos_ = 0;

    // Returns {indent, content} for line `i`, or {-1, ""} if it's blank,
    // a full-line comment, or a document marker (---/...).
    static std::tuple<int, std::string> analyze(const std::string& raw) {
        size_t i = 0;
        while (i < raw.size() && raw[i] == ' ') i++;
        std::string rest = raw.substr(i);
        if (rest.empty() || rest[0] == '#') return {-1, ""};
        if (rest == "---" || rest == "..." || rest.rfind("--- ", 0) == 0) return {-1, ""};
        std::string stripped = rtrim(strip_comment(rest));
        if (stripped.empty()) return {-1, ""};
        return {(int)i, stripped};
    }

    void skipNoise() {
        while (pos_ < lines_.size()) {
            auto [indent, text] = analyze(lines_[pos_]);
            if (indent >= 0) return;
            pos_++;
        }
    }

    bool eof() {
        skipNoise();
        return pos_ >= lines_.size();
    }

    std::pair<int, std::string> peek() {
        skipNoise();
        auto [indent, text] = analyze(lines_[pos_]);
        return {indent, text};
    }

    int currentLineNo() const { return (int)pos_ + 1; }

    // Parses a scalar token: quoted string, or bare scalar text.
    static YamlNode parseScalarToken(const std::string& text) {
        YamlNode n;
        n.type = NodeType::Scalar;
        if (text.size() >= 2 && text.front() == '"' && text.back() == '"') {
            n.quoted = true;
            n.scalar = unescape_double_quoted(text.substr(1, text.size() - 2));
        } else if (text.size() >= 2 && text.front() == '\'' && text.back() == '\'') {
            n.quoted = true;
            n.scalar = unescape_single_quoted(text.substr(1, text.size() - 2));
        } else {
            n.quoted = false;
            n.scalar = text;
        }
        return n;
    }

    YamlNode parseFlowSeq(const std::string& text) {
        size_t open = text.find('[');
        size_t close = text.rfind(']');
        if (open == std::string::npos || close == std::string::npos || close <= open) {
            return parseScalarToken(text);
        }
        std::string inner = text.substr(open + 1, close - open - 1);
        YamlNode node;
        node.type = NodeType::Sequence;
        for (auto& item : split_top_level(inner, ',')) {
            std::string t = trim(item);
            if (t.empty()) continue;
            if (t[0] == '{') node.seq.push_back(parseFlowMap(t));
            else if (t[0] == '[') node.seq.push_back(parseFlowSeq(t));
            else node.seq.push_back(parseScalarToken(t));
        }
        return node;
    }

    YamlNode parseFlowMap(const std::string& text) {
        size_t open = text.find('{');
        size_t close = text.rfind('}');
        if (open == std::string::npos || close == std::string::npos || close <= open) {
            return parseScalarToken(text);
        }
        std::string inner = text.substr(open + 1, close - open - 1);
        YamlNode node;
        node.type = NodeType::Mapping;
        for (auto& item : split_top_level(inner, ',')) {
            std::string t = trim(item);
            if (t.empty()) continue;
            size_t colon = find_top_level_colon(t);
            if (colon == std::string::npos) continue;
            YamlNode key = parseScalarToken(trim(t.substr(0, colon)));
            YamlNode val = parseScalarToken(trim(t.substr(colon + 1)));
            node.map.emplace_back(key.scalar, std::move(val));
        }
        return node;
    }

    // Consumes a `|` or `>` block scalar. `pos_` must point at the first
    // raw line after the "key: |" line; `parentIndent` is that key line's
    // indentation.
    std::string consumeBlockScalar(int parentIndent, char style, char chomp) {
        std::vector<std::string> contentLines;
        int blockIndent = -1;
        std::vector<std::string> pendingBlank;

        while (pos_ < lines_.size()) {
            const std::string& raw = lines_[pos_];
            size_t sp = 0;
            while (sp < raw.size() && raw[sp] == ' ') sp++;
            bool isBlank = (sp == raw.size());

            if (isBlank) {
                pendingBlank.push_back("");
                pos_++;
                continue;
            }

            int ind = (int)sp;
            if (blockIndent == -1) {
                if (ind <= parentIndent) break; // empty block scalar
                blockIndent = ind;
            }
            if (ind < blockIndent) break;

            for (auto& b : pendingBlank) contentLines.push_back(b);
            pendingBlank.clear();

            contentLines.push_back(raw.substr(blockIndent));
            pos_++;
        }

        std::string result;
        if (style == '|') {
            for (auto& line : contentLines) {
                result += line;
                result += '\n';
            }
        } else { // '>' folded (approximate)
            for (size_t k = 0; k < contentLines.size(); k++) {
                if (contentLines[k].empty()) {
                    result += '\n';
                    continue;
                }
                result += contentLines[k];
                bool last = (k + 1 >= contentLines.size());
                bool nextBlank = !last && contentLines[k + 1].empty();
                result += (last || nextBlank) ? '\n' : ' ';
            }
        }

        if (chomp == '-') {
            while (!result.empty() && result.back() == '\n') result.pop_back();
        } else if (chomp == '+') {
            // keep as-is
        } else {
            if (contentLines.empty()) {
                result.clear();
            } else {
                while (!result.empty() && result.back() == '\n') result.pop_back();
                result += '\n';
            }
        }
        return result;
    }

    // Parses the value portion after "key:" (or a sequence item's scalar).
    // `parentIndent` is the indentation of the key/item line.
    YamlNode parseValue(const std::string& valueText, int parentIndent) {
        if (valueText.empty()) {
            if (eof()) return YamlNode{};
            auto [ind, text] = peek();
            if (ind > parentIndent) {
                return parseBlock(parentIndent + 1);
            }
            if (ind == parentIndent && (text == "-" || text.rfind("- ", 0) == 0)) {
                // A block sequence may align with its parent key's indentation.
                return parseBlock(parentIndent);
            }
            return YamlNode{};
        }
        if (valueText[0] == '|' || valueText[0] == '>') {
            char style = valueText[0];
            char chomp = 0;
            if (valueText.size() > 1 && (valueText[1] == '-' || valueText[1] == '+')) {
                chomp = valueText[1];
            }
            YamlNode n;
            n.type = NodeType::Scalar;
            n.quoted = false;
            n.scalar = consumeBlockScalar(parentIndent, style, chomp);
            return n;
        }
        if (valueText[0] == '[') return parseFlowSeq(valueText);
        if (valueText[0] == '{') return parseFlowMap(valueText);
        return parseScalarToken(valueText);
    }

    // Parses a sequence item that begins with "key: value" (after the
    // leading "- " has been stripped), including any further "key: value"
    // lines indented to align with the first key (i.e. at `seqIndent + 2`).
    YamlNode parseInlineMapItem(const std::string& itemText, int seqIndent) {
        YamlNode node;
        node.type = NodeType::Mapping;
        int itemIndent = seqIndent + 2;

        size_t colon = find_top_level_colon(itemText);
        std::string key = trim(itemText.substr(0, colon));
        std::string val = trim(itemText.substr(colon + 1));
        YamlNode keyNode = parseScalarToken(key);
        YamlNode valueNode = parseValue(val, itemIndent);
        node.map.emplace_back(keyNode.scalar, std::move(valueNode));

        while (!eof()) {
            auto [ind, text] = peek();
            if (ind != itemIndent) break;
            if (text == "-" || text.rfind("- ", 0) == 0) break;
            size_t c = find_top_level_colon(text);
            if (c == std::string::npos) break;
            std::string k = trim(text.substr(0, c));
            std::string v = trim(text.substr(c + 1));
            YamlNode kn = parseScalarToken(k);
            pos_++;
            YamlNode vn = parseValue(v, itemIndent);
            node.map.emplace_back(kn.scalar, std::move(vn));
        }
        return node;
    }

    // Parses a block (sequence or mapping) whose lines must be indented
    // at least `minIndent`. The actual indentation level is taken from the
    // first line found.
    YamlNode parseBlock(int minIndent) {
        if (eof()) return YamlNode{};
        auto [indent, text] = peek();
        if (indent < minIndent) return YamlNode{};

        if (text == "-" || text.rfind("- ", 0) == 0) {
            YamlNode node;
            node.type = NodeType::Sequence;
            int seqIndent = indent;
            while (!eof()) {
                auto [ind, t] = peek();
                if (ind != seqIndent) break;
                if (!(t == "-" || t.rfind("- ", 0) == 0)) break;

                std::string itemText = (t == "-") ? "" : trim(t.substr(2));
                pos_++;

                if (itemText.empty()) {
                    node.seq.push_back(parseBlock(seqIndent + 1));
                } else if (find_top_level_colon(itemText) != std::string::npos) {
                    node.seq.push_back(parseInlineMapItem(itemText, seqIndent));
                } else {
                    node.seq.push_back(parseValue(itemText, seqIndent));
                }
            }
            return node;
        }

        YamlNode node;
        node.type = NodeType::Mapping;
        int mapIndent = indent;
        while (!eof()) {
            auto [ind, t] = peek();
            if (ind != mapIndent) break;
            if (t == "-" || t.rfind("- ", 0) == 0) break;

            size_t colon = find_top_level_colon(t);
            if (colon == std::string::npos) {
                throw ParseError("expected ':' in mapping line: " + t, currentLineNo());
            }
            std::string keyText = trim(t.substr(0, colon));
            std::string valText = trim(t.substr(colon + 1));
            YamlNode keyNode = parseScalarToken(keyText);

            pos_++;

            YamlNode valueNode = parseValue(valText, mapIndent);
            node.map.emplace_back(keyNode.scalar, std::move(valueNode));
        }
        return node;
    }
};

} // namespace

YamlNode parse_yaml(const std::string& content) {
    std::vector<std::string> rawLines;
    {
        std::istringstream ss(content);
        std::string raw;
        int lineNo = 0;
        while (std::getline(ss, raw)) {
            lineNo++;
            if (!raw.empty() && raw.back() == '\r') raw.pop_back();
            size_t i = 0;
            while (i < raw.size() && raw[i] == ' ') i++;
            if (i < raw.size() && raw[i] == '\t') {
                throw ParseError("tabs are not allowed for indentation", lineNo);
            }
            rawLines.push_back(raw);
        }
    }
    Parser parser(std::move(rawLines));
    return parser.parseDocument();
}

} // namespace workflow_yaml
