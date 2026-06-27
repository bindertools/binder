#pragma once
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// Minimal indentation-based YAML subset parser, sized for GitHub Actions
// workflow files. Not a general-purpose YAML implementation: no anchors/
// aliases/tags, folded scalars (`>`) are approximated, and flow collections
// only support one level of nesting in practice (enough for `matrix.include`
// and `branches: [main]`).
namespace workflow_yaml {

enum class NodeType { Null, Scalar, Sequence, Mapping };

struct YamlNode {
    NodeType type = NodeType::Null;

    // Scalar
    std::string scalar;
    bool quoted = false;

    // Sequence
    std::vector<YamlNode> seq;

    // Mapping (insertion-ordered)
    std::vector<std::pair<std::string, YamlNode>> map;

    bool isNull()    const { return type == NodeType::Null; }
    bool isScalar()  const { return type == NodeType::Scalar; }
    bool isSeq()     const { return type == NodeType::Sequence; }
    bool isMap()     const { return type == NodeType::Mapping; }

    // Returns a Null node if the key is absent or this isn't a mapping.
    const YamlNode& get(const std::string& key) const;
    bool has(const std::string& key) const;

    std::string asString(const std::string& def = "") const;
    bool asBool(bool def = false) const;
    double asNumber(double def = 0) const;

    // Converts to nlohmann::json. Unquoted scalars are coerced to
    // bool/number/null where they look like one (mirrors YAML 1.1-ish
    // behavior); quoted scalars stay strings.
    nlohmann::json toJson() const;
};

struct ParseError : std::runtime_error {
    int line;
    ParseError(const std::string& msg, int line_)
        : std::runtime_error(msg + " (line " + std::to_string(line_) + ")"), line(line_) {}
};

// Parses a full YAML document into a single root node (Mapping for workflow
// files). Throws ParseError on malformed input.
YamlNode parse_yaml(const std::string& content);

} // namespace workflow_yaml
