#pragma once
#include <nlohmann/json.hpp>
#include <string>

// Evaluator for the GitHub Actions `${{ }}` expression language, sized for
// the constructs that actually show up in this repo's workflows: context
// property access (`steps.x.outputs.y`, `matrix.os`, `github.event...`),
// comparisons, `&&`/`||`/`!`, and the common built-in functions.
namespace workflow_expr {

// Snapshot of the GitHub Actions contexts an expression can reference.
// All fields default to empty objects except `job`, which carries a
// `status` field ("success" | "failure" | "cancelled") used by
// success()/failure()/cancelled().
struct Context {
    nlohmann::json env      = nlohmann::json::object();
    nlohmann::json github   = nlohmann::json::object();
    nlohmann::json runner   = nlohmann::json::object();
    nlohmann::json matrix   = nlohmann::json::object();
    nlohmann::json steps    = nlohmann::json::object();
    nlohmann::json secrets  = nlohmann::json::object();
    nlohmann::json vars     = nlohmann::json::object();
    nlohmann::json inputs   = nlohmann::json::object();
    nlohmann::json needs    = nlohmann::json::object();
    nlohmann::json strategy = nlohmann::json::object();
    nlohmann::json job      = nlohmann::json{{"status", "success"}};
};

// Evaluates a bare expression (the contents of `${{ ... }}`, without the
// delimiters). Throws std::runtime_error on syntax errors.
nlohmann::json eval_expression(const std::string& exprSrc, const Context& ctx);

// Replaces every `${{ ... }}` occurrence in `text` with the
// to_display_string() of its evaluated result. An expression that fails to
// parse/evaluate is replaced with an empty string rather than throwing.
std::string substitute(const std::string& text, const Context& ctx);

// Evaluates an `if:` condition. An empty condition defaults to success().
// The condition may optionally be wrapped in `${{ }}`. Falls back to `true`
// (run the step) if the expression can't be parsed/evaluated.
bool eval_if(const std::string& ifExpr, const Context& ctx);

// GitHub Actions truthiness: false for null, false, 0, NaN, or "";
// true otherwise (including empty arrays/objects).
bool is_truthy(const nlohmann::json& v);

// Renders a value the way GitHub Actions does when interpolating it into a
// string: null -> "", booleans -> "true"/"false", numbers without
// unnecessary trailing zeros, arrays/objects -> compact JSON.
std::string to_display_string(const nlohmann::json& v);

// Converts a value to a number for relational comparisons (numbers as-is,
// booleans 0/1, null 0, numeric strings parsed). Returns NaN (check with
// std::isnan) if the value can't be converted.
double to_number(const nlohmann::json& v);

} // namespace workflow_expr
