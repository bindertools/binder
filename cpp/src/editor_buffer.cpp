#include "editor_buffer.hpp"

#include <tree_sitter/api.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <regex>
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
const TSLanguage* tree_sitter_c(void);
const TSLanguage* tree_sitter_cpp(void);
const TSLanguage* tree_sitter_c_sharp(void);
const TSLanguage* tree_sitter_rust(void);
const TSLanguage* tree_sitter_go(void);
const TSLanguage* tree_sitter_java(void);
const TSLanguage* tree_sitter_lua(void);
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

// Core JS query, shared with TypeScript/TSX. Patterns here must compile
// against all of tree_sitter_javascript/typescript/tsx — fields whose node
// type differs between grammars (e.g. class_declaration's `name`, which is
// `identifier` in JS but `type_identifier` in TS) belong in the per-language
// extras below instead, since a single incompatible pattern fails the whole
// query (ts_query_new rejects the entire string on any structure error).
const char* kQueryJavascriptCore = R"TSQ(
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

// JavaScript-only addition: class_declaration's `name` field is `identifier`
// in the JS grammar but `type_identifier` in TS/TSX (already covered there by
// the generic `(type_identifier) @type` in kQueryTypescriptExtra).
const char* kQueryJavascriptExtra = R"TSQ(
(class_declaration name: (identifier) @type)
)TSQ";

const std::string kQueryJavascript = std::string(kQueryJavascriptCore) + kQueryJavascriptExtra;

// TypeScript/TSX-specific additions on top of the JavaScript core query. The
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

const std::string kQueryTypescript = std::string(kQueryJavascriptCore) + kQueryTypescriptExtra;

// C — adapted from tree-sitter-c's highlights.scm with the `#match?`
// all-caps-identifier rule dropped (predicates aren't supported here).
const char* kQueryC = R"TSQ(
(identifier) @variable

["break" "case" "const" "continue" "default" "do" "else" "enum" "extern" "for"
 "goto" "if" "inline" "register" "restrict" "return" "sizeof" "static"
 "struct" "switch" "typedef" "union" "volatile" "while" "_Atomic"] @keyword

(preproc_directive) @keyword
["#define" "#elif" "#else" "#endif" "#if" "#ifdef" "#ifndef" "#include"] @keyword

["--" "-" "-=" "->" "=" "!=" "*" "&" "&&" "+" "++" "+=" "<" "<=" "==" ">" ">="
 "||" "/" "/=" "%" "%=" "*=" "&=" "|=" "^=" "<<" ">>" "<<=" ">>=" "!" "~" "?"
] @operator

["." ";" ","] @punctuation.delimiter
["(" ")" "{" "}" "[" "]"] @punctuation.bracket

(string_literal) @string
(system_lib_string) @string
(char_literal) @string
(escape_sequence) @escape

(null) @constant
(number_literal) @number

(field_identifier) @property
(type_identifier) @type
(primitive_type) @type
(sized_type_specifier) @type

(call_expression function: (identifier) @function)
(call_expression function: (field_expression field: (field_identifier) @function))
(function_declarator declarator: (identifier) @function)
(preproc_function_def name: (identifier) @function)

(comment) @comment
)TSQ";

// C++ — C's query plus C++-specific keywords/operators/types, adapted from
// tree-sitter-cpp's highlights.scm with `#match?` predicates dropped.
const char* kQueryCppExtra = R"TSQ(
(this) @variable.builtin
["nullptr"] @constant

[
 "catch" "class" "co_await" "co_return" "co_yield" "constexpr" "constinit"
 "consteval" "delete" "explicit" "final" "friend" "mutable" "namespace"
 "noexcept" "new" "override" "private" "protected" "public" "template"
 "throw" "try" "typename" "using" "concept" "requires"
] @keyword
(virtual) @keyword

["::" "<=>" "->*" ".*" "..."] @operator

(auto) @type
(namespace_identifier) @type

(call_expression function: (qualified_identifier name: (identifier) @function))
(template_function name: (identifier) @function)
(template_method name: (field_identifier) @function)
(function_declarator declarator: (qualified_identifier name: (identifier) @function))
(function_declarator declarator: (field_identifier) @function)

(raw_string_literal) @string
)TSQ";

const std::string kQueryCpp = std::string(kQueryC) + kQueryCppExtra;

// C# — adapted from tree-sitter-c-sharp's highlights.scm with `#match?`
// predicates dropped and `interpolation_start`/`interpolation_brace` removed
// (not visible named nodes in this grammar version).
const char* kQueryCSharp = R"TSQ(
(identifier) @variable

[(real_literal) (integer_literal)] @number

[(character_literal) (string_literal) (raw_string_literal)
 (verbatim_string_literal) (interpolated_string_expression)
 (interpolation_quote)] @string
(escape_sequence) @escape

[(boolean_literal) (null_literal)] @constant

[";" "." ","] @punctuation.delimiter
["(" ")" "[" "]" "{" "}"] @punctuation.bracket

["--" "-" "-=" "&" "&=" "&&" "+" "++" "+=" "<" "<=" "<<" "<<=" "=" "=="
 "!" "!=" "=>" ">" ">=" ">>" ">>=" ">>>" ">>>=" "|" "|=" "||" "?" "??"
 "??=" "^" "^=" "~" "*" "*=" "/" "/=" "%" "%=" ":"] @operator

[(modifier) "this" (implicit_type)] @keyword
["add" "alias" "as" "base" "break" "case" "catch" "checked" "class" "continue"
 "default" "delegate" "do" "else" "enum" "event" "explicit" "extern" "finally"
 "for" "foreach" "global" "goto" "if" "implicit" "interface" "is" "lock"
 "namespace" "notnull" "operator" "params" "return" "remove" "sizeof"
 "stackalloc" "static" "struct" "switch" "throw" "try" "typeof" "unchecked"
 "using" "while" "new" "await" "in" "yield" "get" "set" "when" "out" "ref"
 "from" "where" "select" "record" "init" "with" "let"] @keyword

(predefined_type) @type

(interface_declaration name: (identifier) @type)
(class_declaration name: (identifier) @type)
(enum_declaration name: (identifier) @type)
(struct_declaration (identifier) @type)
(record_declaration (identifier) @type)
(namespace_declaration name: (identifier) @type)
(generic_name (identifier) @type)
(parameter type: (identifier) @type)
(type_argument_list (identifier) @type)
(as_expression right: (identifier) @type)
(is_expression right: (identifier) @type)
(base_list (identifier) @type)
(_ type: (identifier) @type)

(method_declaration name: (identifier) @function)
(local_function_statement name: (identifier) @function)
(constructor_declaration name: (identifier) @function)
(destructor_declaration name: (identifier) @function)
(invocation_expression (member_access_expression name: (identifier) @function))

(enum_member_declaration (identifier) @property)
(type_parameter (identifier) @property)
(type_parameter_constraints_clause (identifier) @property)
(attribute name: (identifier) @property)

(comment) @comment
)TSQ";

// ── Completion queries ────────────────────────────────────────────────────────
// Symbol-extraction queries for editor.completions: capture names classify
// each captured identifier into a completion "kind" (returned to the
// frontend for icon selection). Predicate-free, like the highlight queries;
// if a pattern doesn't compile for a given grammar the whole query fails to
// compile and tree-sitter-based symbols are simply skipped for that buffer
// (word-based fallback + keywords still work).

const char* kCompletionQueryJson = R"TSQ(
(pair key: (string) @property)
)TSQ";

const char* kCompletionQueryJavascript = R"TSQ(
(function_declaration name: (identifier) @function)
(function_expression name: (identifier) @function)
(generator_function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function)
(class_declaration name: (identifier) @class)
(variable_declarator name: (identifier) @variable)
(property_identifier) @property
(shorthand_property_identifier) @property
)TSQ";

const char* kCompletionQueryTypescript = R"TSQ(
(function_declaration name: (identifier) @function)
(function_expression name: (identifier) @function)
(generator_function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function)
(class_declaration name: (type_identifier) @class)
(interface_declaration name: (type_identifier) @type)
(type_alias_declaration name: (type_identifier) @type)
(enum_declaration name: (identifier) @type)
(variable_declarator name: (identifier) @variable)
(required_parameter pattern: (identifier) @variable)
(optional_parameter pattern: (identifier) @variable)
(property_identifier) @property
(shorthand_property_identifier) @property
)TSQ";

const char* kCompletionQueryC = R"TSQ(
(function_definition declarator: (function_declarator declarator: (identifier) @function))
(declaration declarator: (function_declarator declarator: (identifier) @function))
(struct_specifier name: (type_identifier) @class)
(union_specifier name: (type_identifier) @class)
(enum_specifier name: (type_identifier) @class)
(type_definition declarator: (type_identifier) @type)
(preproc_def name: (identifier) @constant)
(preproc_function_def name: (identifier) @function)
(declaration declarator: (identifier) @variable)
(init_declarator declarator: (identifier) @variable)
(parameter_declaration declarator: (identifier) @variable)
(field_identifier) @property
)TSQ";

const char* kCompletionQueryCpp = R"TSQ(
(function_definition declarator: (function_declarator declarator: (identifier) @function))
(function_definition declarator: (function_declarator declarator: (field_identifier) @function))
(declaration declarator: (function_declarator declarator: (identifier) @function))
(template_function name: (identifier) @function)
(template_method name: (field_identifier) @function)
(class_specifier name: (type_identifier) @class)
(struct_specifier name: (type_identifier) @class)
(union_specifier name: (type_identifier) @class)
(enum_specifier name: (type_identifier) @class)
(namespace_definition name: (namespace_identifier) @type)
(type_definition declarator: (type_identifier) @type)
(preproc_def name: (identifier) @constant)
(preproc_function_def name: (identifier) @function)
(declaration declarator: (identifier) @variable)
(init_declarator declarator: (identifier) @variable)
(parameter_declaration declarator: (identifier) @variable)
(field_identifier) @property
)TSQ";

const char* kCompletionQueryCSharp = R"TSQ(
(method_declaration name: (identifier) @function)
(local_function_statement name: (identifier) @function)
(constructor_declaration name: (identifier) @function)
(interface_declaration name: (identifier) @class)
(class_declaration name: (identifier) @class)
(struct_declaration (identifier) @class)
(record_declaration (identifier) @class)
(enum_declaration name: (identifier) @class)
(namespace_declaration name: (identifier) @type)
(enum_member_declaration (identifier) @property)
(parameter name: (identifier) @variable)
(variable_declarator (identifier) @variable)
(property_declaration name: (identifier) @property)
)TSQ";

// Rust — adapted from tree-sitter-rust's highlights.scm with `#match?`
// predicates dropped (the all-caps-constant / uppercase-type / enum-constructor
// heuristics) and `primitive_type`/`doc_comment` removed (not present in this
// grammar version).
const char* kQueryRust = R"TSQ(
(identifier) @variable

(type_identifier) @type
(field_identifier) @property

(call_expression function: (identifier) @function)
(call_expression function: (field_expression field: (field_identifier) @function))
(call_expression function: (scoped_identifier "::" name: (identifier) @function))

(generic_function function: (identifier) @function)
(generic_function function: (scoped_identifier name: (identifier) @function))
(generic_function function: (field_expression field: (field_identifier) @function))

(macro_invocation macro: (identifier) @function)

(function_item (identifier) @function)
(function_signature_item (identifier) @function)

(struct_pattern type: (scoped_type_identifier name: (type_identifier) @function))

(line_comment) @comment
(block_comment) @comment

["(" ")" "[" "]" "{" "}"] @punctuation.bracket
(type_arguments "<" @punctuation.bracket ">" @punctuation.bracket)
(type_parameters "<" @punctuation.bracket ">" @punctuation.bracket)

["::" ":" "." "," ";"] @punctuation.delimiter

(parameter (identifier) @variable)
(lifetime (identifier) @variable)

["as" "async" "await" "break" "const" "continue" "default" "dyn" "else" "enum" "extern" "fn"
 "for" "if" "impl" "in" "let" "loop" "macro_rules!" "match" "mod" "move" "pub" "ref" "return"
 "static" "struct" "trait" "type" "union" "unsafe" "use" "where" "while" "yield"] @keyword
(crate) @keyword
(mutable_specifier) @keyword
(use_list (self) @keyword)
(scoped_use_list (self) @keyword)
(scoped_identifier (self) @keyword)
(super) @keyword

(self) @variable.builtin

[(char_literal) (string_literal) (raw_string_literal)] @string
(escape_sequence) @escape

(boolean_literal) @constant
[(integer_literal) (float_literal)] @number

(attribute_item) @property
(inner_attribute_item) @property

["*" "&" "!" "'"] @operator
)TSQ";

const char* kCompletionQueryRust = R"TSQ(
(function_item name: (identifier) @function)
(function_signature_item name: (identifier) @function)
(struct_item name: (type_identifier) @class)
(enum_item name: (type_identifier) @class)
(trait_item name: (type_identifier) @class)
(mod_item name: (identifier) @type)
(type_item name: (type_identifier) @type)
(const_item name: (identifier) @constant)
(static_item name: (identifier) @variable)
(let_declaration pattern: (identifier) @variable)
(parameter pattern: (identifier) @variable)
(field_declaration name: (field_identifier) @property)
(enum_variant name: (identifier) @property)
)TSQ";

// Go — adapted from tree-sitter-go's highlights.scm with the
// `#match?`-predicated builtin-function pattern dropped.
const char* kQueryGo = R"TSQ(
(call_expression function: (identifier) @function)
(call_expression function: (selector_expression field: (field_identifier) @function))

(function_declaration name: (identifier) @function)
(method_declaration name: (field_identifier) @function)

(type_identifier) @type
(field_identifier) @property
(identifier) @variable

[
 "--" "-" "-=" ":=" "!" "!=" "..." "*" "*=" "/" "/=" "&" "&&" "&=" "%" "%=" "^"
 "^=" "+" "++" "+=" "<-" "<" "<<" "<<=" "<=" "=" "==" ">" ">=" ">>" ">>=" "|"
 "|=" "||" "~"
] @operator

[
 "break" "case" "chan" "const" "continue" "default" "defer" "else" "fallthrough"
 "for" "func" "go" "goto" "if" "import" "interface" "map" "package" "range"
 "return" "select" "struct" "switch" "type" "var"
] @keyword

[(interpreted_string_literal) (raw_string_literal) (rune_literal)] @string
(escape_sequence) @escape

[(int_literal) (float_literal) (imaginary_literal)] @number

[(true) (false) (nil) (iota)] @constant

(comment) @comment
)TSQ";

const char* kCompletionQueryGo = R"TSQ(
(function_declaration name: (identifier) @function)
(method_declaration name: (field_identifier) @function)
(type_spec name: (type_identifier) @class)
(const_spec name: (identifier) @constant)
(var_spec name: (identifier) @variable)
(parameter_declaration name: (identifier) @variable)
(field_declaration name: (field_identifier) @property)
(import_spec name: (package_identifier) @type)
)TSQ";

// Java — adapted from tree-sitter-java's highlights.scm with `#match?`
// predicates dropped (field/scoped-identifier/method "looks like a type"
// heuristics and the all-caps-constant heuristic).
const char* kQueryJava = R"TSQ(
(identifier) @variable

(method_declaration name: (identifier) @function)
(method_invocation name: (identifier) @function)
(super) @function.builtin

(annotation name: (identifier) @property)
(marker_annotation name: (identifier) @property)
"@" @operator

(type_identifier) @type

(interface_declaration name: (identifier) @type)
(class_declaration name: (identifier) @type)
(enum_declaration name: (identifier) @type)
(constructor_declaration name: (identifier) @type)

[(boolean_type) (integral_type) (floating_point_type) (void_type)] @type

(this) @variable.builtin

[(hex_integer_literal) (decimal_integer_literal) (octal_integer_literal)
 (decimal_floating_point_literal) (hex_floating_point_literal)] @number

[(character_literal) (string_literal)] @string
(escape_sequence) @escape

[(true) (false) (null_literal)] @constant

[(line_comment) (block_comment)] @comment

[
 "abstract" "assert" "break" "case" "catch" "class" "continue" "default" "do"
 "else" "enum" "exports" "extends" "final" "finally" "for" "if" "implements"
 "import" "instanceof" "interface" "module" "native" "new" "non-sealed" "open"
 "opens" "package" "private" "protected" "provides" "public" "requires" "record"
 "return" "sealed" "static" "strictfp" "switch" "synchronized" "throw" "throws"
 "to" "transient" "transitive" "try" "uses" "volatile" "while" "with"
] @keyword
)TSQ";

const char* kCompletionQueryJava = R"TSQ(
(method_declaration name: (identifier) @function)
(constructor_declaration name: (identifier) @function)
(class_declaration name: (identifier) @class)
(interface_declaration name: (identifier) @class)
(enum_declaration name: (identifier) @class)
(record_declaration name: (identifier) @class)
(annotation_type_declaration name: (identifier) @class)
(enum_constant name: (identifier) @property)
(formal_parameter name: (identifier) @variable)
(local_variable_declaration declarator: (variable_declarator name: (identifier) @variable))
(field_declaration declarator: (variable_declarator name: (identifier) @property))
)TSQ";

// Lua — adapted from tree-sitter-lua's highlights.scm with `#eq?`/`#match?`/
// `#any-of?` predicates dropped (the "self" builtin, all-caps-constant, and
// builtin-function heuristics).
const char* kQueryLua = R"TSQ(
"return" @keyword

["goto" "in" "local"] @keyword

(label_statement) @variable

(break_statement) @keyword

(do_statement ["do" "end"] @keyword)

(while_statement ["while" "do" "end"] @keyword)

(repeat_statement ["repeat" "until"] @keyword)

(if_statement ["if" "elseif" "else" "then" "end"] @keyword)

(elseif_statement ["elseif" "then" "end"] @keyword)

(else_statement ["else" "end"] @keyword)

(for_statement ["for" "do" "end"] @keyword)

(function_declaration ["function" "end"] @keyword)

(function_definition ["function" "end"] @keyword)

["and" "not" "or"] @keyword

[
  "+" "-" "*" "/" "%" "^" "#" "==" "~=" "<=" ">=" "<" ">" "=" "&" "~" "|" "<<" ">>" "//" ".."
] @operator

[";" ":" "," "."] @punctuation.delimiter

["(" ")" "[" "]" "{" "}"] @punctuation.bracket

(identifier) @variable

(variable_list
  (attribute
    "<" @punctuation.bracket
    (identifier) @property
    ">" @punctuation.bracket))

(vararg_expression) @constant

(nil) @constant

[(false) (true)] @constant

(field name: (identifier) @property)

(dot_index_expression field: (identifier) @property)

(parameters (identifier) @variable)

(function_declaration
  name: [
    (identifier) @function
    (dot_index_expression
      field: (identifier) @function)
  ])

(function_declaration
  name: (method_index_expression
    method: (identifier) @function))

(assignment_statement
  (variable_list .
    name: [
      (identifier) @function
      (dot_index_expression
        field: (identifier) @function)
    ])
  (expression_list .
    value: (function_definition)))

(table_constructor
  (field
    name: (identifier) @function
    value: (function_definition)))

(function_call
  name: [
    (identifier) @function
    (dot_index_expression
      field: (identifier) @function)
    (method_index_expression
      method: (identifier) @function)
  ])

(comment) @comment

(hash_bang_line) @comment

(number) @number

(string) @string

(escape_sequence) @escape
)TSQ";

const char* kCompletionQueryLua = R"TSQ(
(function_declaration name: (identifier) @function)
(function_declaration name: (dot_index_expression field: (identifier) @function))
(function_declaration name: (method_index_expression method: (identifier) @function))
(variable_list name: (identifier) @variable)
(parameters (identifier) @variable)
(field name: (identifier) @property)
)TSQ";

// Per-language static keyword tables (mirrors the keyword lists in the
// highlight queries above).
const std::map<std::string, std::vector<std::string>> kKeywords = {
    {"json", {"true", "false", "null"}},
    {"javascript", {
        "var", "let", "const", "function", "class", "return", "if", "else", "for", "while", "do",
        "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof", "in", "of",
        "try", "catch", "finally", "throw", "async", "await", "yield", "import", "export", "from",
        "default", "extends", "static", "get", "set", "void", "debugger", "this", "super",
        "true", "false", "null", "undefined",
    }},
    {"typescript", {
        "var", "let", "const", "function", "class", "return", "if", "else", "for", "while", "do",
        "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof", "in", "of",
        "try", "catch", "finally", "throw", "async", "await", "yield", "import", "export", "from",
        "default", "extends", "static", "get", "set", "void", "debugger", "this", "super",
        "true", "false", "null", "undefined",
        "abstract", "declare", "enum", "implements", "interface", "keyof", "namespace",
        "private", "protected", "public", "type", "readonly", "override", "satisfies",
    }},
    {"tsx", {
        "var", "let", "const", "function", "class", "return", "if", "else", "for", "while", "do",
        "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof", "in", "of",
        "try", "catch", "finally", "throw", "async", "await", "yield", "import", "export", "from",
        "default", "extends", "static", "get", "set", "void", "debugger", "this", "super",
        "true", "false", "null", "undefined",
        "abstract", "declare", "enum", "implements", "interface", "keyof", "namespace",
        "private", "protected", "public", "type", "readonly", "override", "satisfies",
    }},
    {"c", {
        "break", "case", "const", "continue", "default", "do", "else", "enum", "extern", "for",
        "goto", "if", "inline", "register", "restrict", "return", "sizeof", "static",
        "struct", "switch", "typedef", "union", "volatile", "while", "_Atomic",
        "auto", "char", "double", "float", "int", "long", "short", "signed", "unsigned", "void",
        "true", "false", "NULL",
    }},
    {"cpp", {
        "break", "case", "const", "continue", "default", "do", "else", "enum", "extern", "for",
        "goto", "if", "inline", "register", "return", "sizeof", "static",
        "struct", "switch", "typedef", "union", "volatile", "while",
        "auto", "char", "double", "float", "int", "long", "short", "signed", "unsigned", "void",
        "true", "false", "nullptr",
        "catch", "class", "co_await", "co_return", "co_yield", "constexpr", "constinit",
        "consteval", "delete", "explicit", "final", "friend", "mutable", "namespace",
        "noexcept", "new", "override", "private", "protected", "public", "template",
        "throw", "try", "typename", "using", "concept", "requires", "virtual",
        "this", "operator",
    }},
    {"csharp", {
        "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked",
        "class", "const", "continue", "decimal", "default", "delegate", "do", "double", "else",
        "enum", "event", "explicit", "extern", "false", "finally", "fixed", "float", "for",
        "foreach", "goto", "if", "implicit", "in", "int", "interface", "internal", "is", "lock",
        "long", "namespace", "new", "null", "object", "operator", "out", "override", "params",
        "private", "protected", "public", "readonly", "ref", "return", "sbyte", "sealed", "short",
        "sizeof", "stackalloc", "static", "string", "struct", "switch", "this", "throw", "true",
        "try", "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort", "using", "virtual",
        "void", "volatile", "while",
        "add", "alias", "ascending", "async", "await", "by", "descending", "dynamic", "equals",
        "from", "get", "global", "group", "init", "into", "join", "let", "nameof", "notnull",
        "on", "orderby", "partial", "record", "remove", "select", "set", "value", "var", "when",
        "where", "with", "yield",
    }},
    {"rust", {
        "as", "async", "await", "break", "const", "continue", "default", "dyn", "else", "enum",
        "extern", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "pub",
        "ref", "return", "static", "struct", "trait", "type", "union", "unsafe", "use", "where",
        "while", "yield", "crate", "self", "Self", "super",
        "bool", "char", "str", "i8", "i16", "i32", "i64", "i128", "isize",
        "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64",
        "true", "false", "Some", "None", "Ok", "Err", "Vec", "String", "Box", "Option", "Result",
    }},
    {"go", {
        "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough",
        "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range",
        "return", "select", "struct", "switch", "type", "var",
        "true", "false", "nil", "iota",
        "bool", "byte", "complex64", "complex128", "error", "float32", "float64",
        "int", "int8", "int16", "int32", "int64", "rune", "string",
        "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
        "append", "cap", "close", "complex", "copy", "delete", "imag", "len", "make", "new",
        "panic", "print", "println", "real", "recover",
    }},
    {"java", {
        "abstract", "assert", "break", "case", "catch", "class", "continue", "default", "do",
        "else", "enum", "exports", "extends", "final", "finally", "for", "if", "implements",
        "import", "instanceof", "interface", "module", "native", "new", "open", "opens",
        "package", "private", "protected", "provides", "public", "requires", "record",
        "return", "sealed", "static", "strictfp", "switch", "synchronized", "throw", "throws",
        "to", "transient", "transitive", "try", "uses", "volatile", "while", "with",
        "boolean", "byte", "char", "double", "float", "int", "long", "short", "void",
        "true", "false", "null", "this", "super",
        "String", "Integer", "Long", "Double", "Float", "Boolean", "Character", "Object",
        "List", "Map", "Set", "ArrayList", "HashMap", "HashSet", "System",
    }},
    {"lua", {
        "and", "break", "do", "else", "elseif", "end", "for", "function", "goto", "if", "in",
        "local", "not", "or", "repeat", "return", "then", "until", "while",
        "true", "false", "nil", "self",
        "assert", "collectgarbage", "dofile", "error", "getmetatable", "ipairs", "load",
        "loadfile", "next", "pairs", "pcall", "print", "rawequal", "rawget", "rawset",
        "require", "select", "setmetatable", "tonumber", "tostring", "type", "xpcall",
        "string", "table", "math", "io", "os", "coroutine",
    }},
};

struct LanguageDef {
    const char* name;
    const TSLanguage* (*fn)(void);
    const char* query_src;
    // Symbol-extraction query for editor.completions. Empty = skip
    // tree-sitter completions for this language (word-based + keyword
    // completions still work).
    const char* completion_query_src = "";
};

const LanguageDef kLanguages[] = {
    {"json",       tree_sitter_json,       kQueryJson,               kCompletionQueryJson},
    {"javascript", tree_sitter_javascript, kQueryJavascript.c_str(), kCompletionQueryJavascript},
    {"typescript", tree_sitter_typescript, kQueryTypescript.c_str(), kCompletionQueryTypescript},
    {"tsx",        tree_sitter_tsx,        kQueryTypescript.c_str(), kCompletionQueryTypescript},
    {"c",          tree_sitter_c,          kQueryC,                  kCompletionQueryC},
    {"cpp",        tree_sitter_cpp,        kQueryCpp.c_str(),        kCompletionQueryCpp},
    {"csharp",     tree_sitter_c_sharp,    kQueryCSharp,             kCompletionQueryCSharp},
    {"rust",       tree_sitter_rust,       kQueryRust,               kCompletionQueryRust},
    {"go",         tree_sitter_go,         kQueryGo,                 kCompletionQueryGo},
    {"java",       tree_sitter_java,       kQueryJava,               kCompletionQueryJava},
    {"lua",        tree_sitter_lua,        kQueryLua,                kCompletionQueryLua},
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
    if (ext == "c" || ext == "h")                       return &kLanguages[4];
    if (ext == "cpp" || ext == "cc" || ext == "cxx" || ext == "c++" ||
        ext == "hpp" || ext == "hh" || ext == "hxx" || ext == "h++" ||
        ext == "ino" || ext == "tpp")                   return &kLanguages[5];
    if (ext == "cs")                                    return &kLanguages[6];
    if (ext == "rs")                                    return &kLanguages[7];
    if (ext == "go")                                    return &kLanguages[8];
    if (ext == "java")                                  return &kLanguages[9];
    if (ext == "lua")                                   return &kLanguages[10];
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
        size_t len = strlen(lang->query_src);
        size_t s = err_offset > 20 ? err_offset - 20 : 0;
        size_t e = std::min(len, (size_t)err_offset + 30);
        spdlog::error("editor: highlight query failed for {} at offset {} (err {}): ...{}...",
                      lang->name, err_offset, (int)err_type,
                      std::string(lang->query_src + s, e - s));
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

// Compiled completion-query cache (one per language, compiled on first use).
// Unlike CompiledQuery, capture names are kept verbatim as completion "kinds"
// (function/class/type/variable/property/...) rather than mapped to styleIds.
struct CompiledCompletionQuery {
    TSQuery* query = nullptr;
    std::vector<std::string> capture_kinds; // capture index → kind name
};

CompiledCompletionQuery* completion_query_for(const LanguageDef* lang) {
    static std::map<const LanguageDef*, std::unique_ptr<CompiledCompletionQuery>> cache;
    static std::mutex mu;
    std::lock_guard<std::mutex> lk(mu);
    auto it = cache.find(lang);
    if (it != cache.end()) return it->second.get();

    const char* src = lang->completion_query_src;
    auto cq = std::make_unique<CompiledCompletionQuery>();
    uint32_t err_offset = 0;
    TSQueryError err_type = TSQueryErrorNone;
    TSQuery* q = ts_query_new(lang->fn(), src, (uint32_t)strlen(src), &err_offset, &err_type);
    if (!q) {
        spdlog::error("editor: completion query failed for {} at offset {} (err {})",
                      lang->name, err_offset, (int)err_type);
    } else {
        cq->query = q;
        uint32_t n = ts_query_capture_count(q);
        cq->capture_kinds.resize(n);
        for (uint32_t i = 0; i < n; i++) {
            uint32_t len = 0;
            const char* nm = ts_query_capture_name_for_id(q, i, &len);
            cq->capture_kinds[i] = std::string(nm, len);
        }
    }
    auto* raw = cq.get();
    cache[lang] = std::move(cq);
    return raw;
}

// ── Undo/redo ─────────────────────────────────────────────────────────────────
// Each EditEntry records one applied edit in its pre-edit (forward) form:
// replacing [sl,sc, el,ec) with new_text, where old_text is what was removed.
// Undo replays the inverse (the range new_text now occupies, restoring
// old_text); redo replays the original [sl,sc,el,ec) -> new_text edit.

enum class EditKind : uint8_t { Other, Insert, Whitespace, Delete };

struct EditEntry {
    uint32_t sl, sc, el, ec;
    std::string old_text;
    std::string new_text;
};

struct EditGroup {
    std::vector<EditEntry> entries;
    EditKind kind = EditKind::Other;
    uint32_t cur_before_line = 0, cur_before_col = 0;
    uint32_t cur_after_line = 0,  cur_after_col = 0;
};

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
    std::string eol = "LF";              // "LF" or "CRLF", detected on open
    std::map<std::string, json> view_states; // per viewKey ("" = default): opaque cursor/scroll state
    std::vector<EditGroup> undo_stack;
    std::vector<EditGroup> redo_stack;
    std::map<std::string, std::string> completion_symbols; // name -> kind, cached per version
    int completion_symbols_version = -1;

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

// Length of a UTF-8 string in UTF-16 code units.
uint32_t utf16_length(const std::string& s) {
    uint32_t len = 0;
    for (size_t i = 0; i < s.size(); ) {
        unsigned char c = (unsigned char)s[i];
        if (c < 0x80)      { i += 1; len += 1; }
        else if (c < 0xE0) { i += 2; len += 1; }
        else if (c < 0xF0) { i += 3; len += 1; }
        else               { i += 4; len += 2; } // astral plane -> surrogate pair
    }
    return len;
}

// Position immediately after inserting `text` at (line, col).
std::pair<uint32_t, uint32_t> end_of_insertion(uint32_t line, uint32_t col,
                                               const std::string& text) {
    uint32_t extra_lines = 0;
    size_t last_nl = std::string::npos;
    for (size_t i = 0; i < text.size(); i++) {
        if (text[i] == '\n') { extra_lines++; last_nl = i; }
    }
    if (extra_lines == 0) return {line, col + utf16_length(text)};
    return {line + extra_lines, utf16_length(text.substr(last_nl + 1))};
}

// Classify a single edit for undo-group coalescing ("typing"/"deleting"
// runs collapse into one undo step, VS Code-style).
EditKind classify_edit(const EditEntry& e) {
    bool pure_insert = e.old_text.empty() && !e.new_text.empty();
    bool pure_delete = e.new_text.empty() && !e.old_text.empty();
    if (pure_insert && e.sl == e.el && e.sc == e.ec && utf16_length(e.new_text) == 1) {
        return (e.new_text == " " || e.new_text == "\t" || e.new_text == "\n")
                   ? EditKind::Whitespace : EditKind::Insert;
    }
    if (pure_delete && e.sl == e.el && utf16_length(e.old_text) == 1) {
        return EditKind::Delete;
    }
    return EditKind::Other;
}

// Whether `cur` continues the same typing/deleting motion as `prev` (the
// last entry of the current undo group), so they can share one undo step.
bool coalesce_check(const EditEntry& prev, EditKind kind, const EditEntry& cur) {
    if (kind == EditKind::Insert || kind == EditKind::Whitespace) {
        auto [pel, pec] = end_of_insertion(prev.sl, prev.sc, prev.new_text);
        return cur.sl == pel && cur.sc == pec;
    }
    if (kind == EditKind::Delete) {
        bool backward = (cur.el == prev.sl && cur.ec == prev.sc); // Backspace chain
        bool forward  = (cur.sl == prev.sl && cur.sc == prev.sc); // Delete chain
        return backward || forward;
    }
    return false;
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

        // Collect all captures first: tree-sitter doesn't emit matches in
        // pattern-declaration order (overlapping captures for the same node
        // can arrive in either order), so painting as matches stream in would
        // make the override outcome order-dependent. Instead paint afterwards
        // in pattern-declaration order, so later patterns reliably override
        // earlier ones as documented above.
        struct PaintEntry { uint32_t pattern_index, ns, ne; uint8_t style; };
        std::vector<PaintEntry> entries;

        TSQueryMatch match;
        while (ts_query_cursor_next_match(cursor, &match)) {
            for (uint16_t ci = 0; ci < match.capture_count; ci++) {
                const TSQueryCapture& cap = match.captures[ci];
                int style = cq->capture_styles[cap.index];
                if (style == 0) continue;
                entries.push_back({match.pattern_index,
                                    ts_node_start_byte(cap.node),
                                    ts_node_end_byte(cap.node),
                                    (uint8_t)style});
            }
        }
        ts_query_cursor_delete(cursor);

        std::stable_sort(entries.begin(), entries.end(),
                          [](const PaintEntry& a, const PaintEntry& b) {
                              return a.pattern_index < b.pattern_index;
                          });

        for (const auto& ent : entries) {
            for (uint32_t ln = first; ln <= last; ln++) {
                auto [ls, le] = bounds[ln - first];
                uint32_t s = std::max(ent.ns, ls), e = std::min(ent.ne, le);
                if (s >= e) continue;
                std::fill(paint[ln - first].begin() + (s - ls),
                          paint[ln - first].begin() + (e - ls),
                          ent.style);
            }
        }
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
                    {"eol", b.eol}, {"dirty", b.dirty},
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
    // Normalize CRLF → LF so byte offsets match what the frontend renders,
    // remembering whether the file used CRLF for the status bar.
    std::string norm;
    norm.reserve(buf->text.size());
    bool has_crlf = false;
    for (size_t i = 0; i < buf->text.size(); i++) {
        if (buf->text[i] == '\r' &&
            i + 1 < buf->text.size() && buf->text[i + 1] == '\n') {
            has_crlf = true;
            continue;
        }
        norm.push_back(buf->text[i]);
    }
    buf->text = std::move(norm);
    buf->eol = has_crlf ? "CRLF" : "LF";
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
            {"version", b.version}, {"styles", kStyles},
            {"eol", b.eol}, {"dirty", b.dirty}, {"existing", false}};
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
// Columns are UTF-16; converted to bytes here. Returns the text removed, so
// callers can build the inverse edit for undo.
std::string apply_edit(Buffer& b, uint32_t sl, uint32_t sc, uint32_t el, uint32_t ec,
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

    std::string old_text = b.text.substr(start_byte, end_byte - start_byte);

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
    return old_text;
}

// Incrementally re-parse after one or more apply_edit() calls and refine
// [dirty_start, dirty_end] (initially the conservative range from the edits
// themselves) using the parser's changed-ranges, which can extend dirtiness
// beyond the edited text (e.g. opening a block comment).
std::pair<uint32_t, uint32_t> reparse_and_dirty(Buffer& b, uint32_t dirty_start, uint32_t dirty_end) {
    if (b.parser) {
        TSTree* old_tree = b.tree;
        b.tree = nullptr;
        TSTree* nt = ts_parser_parse_string(b.parser, old_tree, b.text.data(),
                                            (uint32_t)b.text.size());
        if (old_tree) {
            uint32_t nranges = 0;
            TSRange* ranges = ts_tree_get_changed_ranges(old_tree, nt, &nranges);
            for (uint32_t i = 0; i < nranges; i++) {
                dirty_start = std::min(dirty_start, ranges[i].start_point.row);
                dirty_end = std::max(dirty_end == b.line_count() - 1 ? 0 : dirty_end,
                                     ranges[i].end_point.row);
            }
            if (nranges > 0) free(ranges);
            ts_tree_delete(old_tree);
        }
        b.tree = nt;
    }
    if (dirty_start == UINT32_MAX) dirty_start = 0;
    dirty_end = std::min(std::max(dirty_end, dirty_start), b.line_count() - 1);
    return {dirty_start, dirty_end};
}

json op_edit(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    if (!msg.contains("edits") || !msg["edits"].is_array())
        return {{"ok", false}, {"error", "edits array required"}};

    uint32_t dirty_start = UINT32_MAX, dirty_end = 0;
    std::vector<EditEntry> new_entries;
    for (const auto& e : msg["edits"]) {
        uint32_t sl = e.value("startLine", 0u), sc = e.value("startCol", 0u);
        uint32_t el = e.value("endLine", 0u),   ec = e.value("endCol", 0u);
        std::string text = e.value("text", "");
        uint32_t nlines = b->line_count();
        sl = std::min(sl, nlines - 1);
        el = std::min(el, nlines - 1);
        if (el < sl || (el == sl && ec < sc)) { std::swap(sl, el); std::swap(sc, ec); }
        std::string old_text = apply_edit(*b, sl, sc, el, ec, text);
        new_entries.push_back({sl, sc, el, ec, old_text, text});
        dirty_start = std::min(dirty_start, sl);
        dirty_end = b->line_count() - 1; // conservative; refined below via tree
    }

    auto [ds, de] = reparse_and_dirty(*b, dirty_start, dirty_end);

    if (!new_entries.empty()) {
        EditKind kind = new_entries.size() == 1 ? classify_edit(new_entries[0]) : EditKind::Other;
        auto [ca_line, ca_col] = end_of_insertion(new_entries.back().sl, new_entries.back().sc,
                                                   new_entries.back().new_text);
        bool coalesced = false;
        if (kind != EditKind::Other && !b->undo_stack.empty()) {
            EditGroup& top = b->undo_stack.back();
            if (top.kind == kind && coalesce_check(top.entries.back(), kind, new_entries[0])) {
                top.entries.push_back(new_entries[0]);
                top.cur_after_line = ca_line;
                top.cur_after_col = ca_col;
                coalesced = true;
            }
        }
        if (!coalesced) {
            EditGroup g;
            g.kind = kind;
            g.cur_before_line = msg.value("cursorLine", new_entries[0].sl);
            g.cur_before_col  = msg.value("cursorCol",  new_entries[0].sc);
            g.cur_after_line = ca_line;
            g.cur_after_col  = ca_col;
            g.entries = std::move(new_entries);
            b->undo_stack.push_back(std::move(g));
        }
        b->redo_stack.clear();
    }

    b->version++;
    b->dirty = true;
    return {{"version", b->version}, {"lineCount", b->line_count()},
            {"dirtyStart", ds}, {"dirtyEnd", de}};
}

json op_undo(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    if (b->undo_stack.empty())
        return {{"applied", false}, {"version", b->version}, {"lineCount", b->line_count()}};

    EditGroup g = std::move(b->undo_stack.back());
    b->undo_stack.pop_back();

    uint32_t dirty_start = UINT32_MAX, dirty_end = 0;
    for (auto it = g.entries.rbegin(); it != g.entries.rend(); ++it) {
        auto [iel, iec] = end_of_insertion(it->sl, it->sc, it->new_text);
        apply_edit(*b, it->sl, it->sc, iel, iec, it->old_text);
        dirty_start = std::min(dirty_start, it->sl);
        dirty_end = b->line_count() - 1;
    }
    auto [ds, de] = reparse_and_dirty(*b, dirty_start, dirty_end);

    uint32_t cur_line = g.cur_before_line, cur_col = g.cur_before_col;
    b->redo_stack.push_back(std::move(g));

    b->version++;
    b->dirty = true;
    return {{"applied", true}, {"version", b->version}, {"lineCount", b->line_count()},
            {"dirtyStart", ds}, {"dirtyEnd", de},
            {"cursorLine", cur_line}, {"cursorCol", cur_col}};
}

json op_redo(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    if (b->redo_stack.empty())
        return {{"applied", false}, {"version", b->version}, {"lineCount", b->line_count()}};

    EditGroup g = std::move(b->redo_stack.back());
    b->redo_stack.pop_back();

    uint32_t dirty_start = UINT32_MAX, dirty_end = 0;
    for (auto& e : g.entries) {
        apply_edit(*b, e.sl, e.sc, e.el, e.ec, e.new_text);
        dirty_start = std::min(dirty_start, e.sl);
        dirty_end = b->line_count() - 1;
    }
    auto [ds, de] = reparse_and_dirty(*b, dirty_start, dirty_end);

    uint32_t cur_line = g.cur_after_line, cur_col = g.cur_after_col;
    b->undo_stack.push_back(std::move(g));

    b->version++;
    b->dirty = true;
    return {{"applied", true}, {"version", b->version}, {"lineCount", b->line_count()},
            {"dirtyStart", ds}, {"dirtyEnd", de},
            {"cursorLine", cur_line}, {"cursorCol", cur_col}};
}

// ── Bracket matching ──────────────────────────────────────────────────────────
// Plain stack-based scan over the byte text — no tree-sitter, so brackets
// inside strings/comments are matched the same as code (acceptable v1
// approximation; the result is purely cosmetic highlighting).

json op_match_bracket(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};

    uint32_t line = msg.value("line", 0u);
    uint32_t col = msg.value("col", 0u);
    if (line >= b->line_count()) return {{"found", false}};

    const std::string& text = b->text;
    uint32_t ls, le;
    b->line_bytes(line, ls, le);
    uint32_t pos = u16_col_to_byte(text, ls, le, col);

    static const std::string kOpen  = "([{";
    static const std::string kClose = ")]}";

    auto bracket_at = [&](uint32_t p) -> int {
        if (p >= text.size()) return -1;
        size_t o = kOpen.find(text[p]);
        if (o != std::string::npos) return (int)o;
        size_t c = kClose.find(text[p]);
        if (c != std::string::npos) return -(int)c - 2; // encode close as -2-idx
        return -1;
    };

    // Prefer the character to the right of the cursor, then to the left.
    uint32_t anchor = UINT32_MAX;
    int kind = -1;
    if ((kind = bracket_at(pos)) != -1) {
        anchor = pos;
    } else if (pos > 0 && (kind = bracket_at(pos - 1)) != -1) {
        anchor = pos - 1;
    }
    if (anchor == UINT32_MAX) return {{"found", false}};

    uint32_t match = UINT32_MAX;
    if (kind >= 0) {
        // Opening bracket — scan forward.
        char open = kOpen[(size_t)kind], close = kClose[(size_t)kind];
        int depth = 0;
        for (uint32_t i = anchor; i < text.size(); i++) {
            if (text[i] == open) depth++;
            else if (text[i] == close) { if (--depth == 0) { match = i; break; } }
        }
    } else {
        // Closing bracket — scan backward.
        size_t idx = (size_t)(-kind - 2);
        char open = kOpen[idx], close = kClose[idx];
        int depth = 0;
        for (uint32_t i = anchor + 1; i-- > 0; ) {
            if (text[i] == close) depth++;
            else if (text[i] == open) { if (--depth == 0) { match = i; break; } }
        }
    }
    if (match == UINT32_MAX) return {{"found", false}};

    auto to_pos = [&](uint32_t byte_off) -> std::pair<uint32_t, uint32_t> {
        TSPoint p = point_for_byte(*b, byte_off);
        uint32_t line_start = b->line_offsets[p.row];
        return {p.row, byte_to_u16_col(text, line_start, byte_off)};
    };
    auto [aLine, aCol] = to_pos(anchor);
    auto [mLine, mCol] = to_pos(match);
    return {{"found", true},
            {"anchorLine", aLine}, {"anchorCol", aCol},
            {"matchLine", mLine}, {"matchCol", mCol}};
}

// ── Search ────────────────────────────────────────────────────────────────────
// Literal queries are escaped into an ECMAScript regex so wholeWord (\b...\b)
// is handled the same way for both modes. Runs over the whole (CRLF-normalized)
// buffer text, so multi-line regex matches work; capped to avoid huge results
// on accidental whole-file matches.

json op_search(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::string query = msg.value("query", "");
    bool is_regex = msg.value("regex", false);
    bool case_sensitive = msg.value("caseSensitive", false);
    bool whole_word = msg.value("wholeWord", false);

    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    if (query.empty()) return {{"matches", json::array()}};

    std::string pattern;
    if (is_regex) {
        pattern = query;
    } else {
        static const std::string special = "\\^$.|?*+()[]{}";
        pattern.reserve(query.size());
        for (char c : query) {
            if (special.find(c) != std::string::npos) pattern.push_back('\\');
            pattern.push_back(c);
        }
    }
    if (whole_word) pattern = "\\b(?:" + pattern + ")\\b";

    auto flags = std::regex::ECMAScript;
    if (!case_sensitive) flags |= std::regex::icase;

    std::regex re;
    try {
        re = std::regex(pattern, flags);
    } catch (const std::regex_error&) {
        return {{"ok", false}, {"error", "invalid pattern"}};
    }

    auto to_pos = [&](uint32_t byte_off) -> std::pair<uint32_t, uint32_t> {
        TSPoint p = point_for_byte(*b, byte_off);
        uint32_t line_start = b->line_offsets[p.row];
        return {p.row, byte_to_u16_col(b->text, line_start, byte_off)};
    };

    const std::string& text = b->text;
    json matches = json::array();
    const size_t kMaxMatches = 10000;
    auto it = std::sregex_iterator(text.begin(), text.end(), re);
    auto end = std::sregex_iterator();
    for (; it != end; ++it) {
        uint32_t s = (uint32_t)it->position(0);
        uint32_t e = s + (uint32_t)it->length(0);
        auto [sl, sc] = to_pos(s);
        auto [el, ec] = to_pos(e);
        matches.push_back({{"startLine", sl}, {"startCol", sc},
                           {"endLine", el}, {"endCol", ec}});
        if (matches.size() >= kMaxMatches) break;
    }
    return {{"matches", matches}};
}

// ── Completions ───────────────────────────────────────────────────────────────
// Symbol table is rebuilt lazily on version change: a word-based pass over the
// whole buffer (covers plaintext/unsupported languages and anything the
// tree-sitter query misses), then a tree-sitter pass that overrides the kind
// for declaration-classified identifiers (function/class/type/property/...).

void rebuild_completion_symbols(Buffer& b) {
    b.completion_symbols.clear();

    static const std::regex word_re(R"(\b[A-Za-z_][A-Za-z0-9_]*\b)");
    auto wit = std::sregex_iterator(b.text.begin(), b.text.end(), word_re);
    auto wend = std::sregex_iterator();
    for (; wit != wend && b.completion_symbols.size() < 2000; ++wit) {
        std::string w = wit->str();
        if (w.size() < 2) continue;
        b.completion_symbols.emplace(w, "variable");
    }

    if (b.lang && b.tree) {
        CompiledCompletionQuery* cq = completion_query_for(b.lang);
        if (cq->query) {
            TSQueryCursor* cursor = ts_query_cursor_new();
            ts_query_cursor_exec(cursor, cq->query, ts_tree_root_node(b.tree));
            TSQueryMatch match;
            while (ts_query_cursor_next_match(cursor, &match)) {
                for (uint16_t ci = 0; ci < match.capture_count; ci++) {
                    const TSQueryCapture& cap = match.captures[ci];
                    uint32_t s = ts_node_start_byte(cap.node);
                    uint32_t e = ts_node_end_byte(cap.node);
                    if (e <= s || e > b.text.size()) continue;
                    std::string name = b.text.substr(s, e - s);
                    // JSON object keys are captured as quoted strings.
                    if (name.size() >= 2 && name.front() == '"' && name.back() == '"')
                        name = name.substr(1, name.size() - 2);
                    if (name.empty()) continue;
                    b.completion_symbols[name] = cq->capture_kinds[cap.index];
                }
            }
            ts_query_cursor_delete(cursor);
        }
    }
    b.completion_symbols_version = b.version;
}

json op_completions(const json& msg) {
    int id = msg.value("bufferId", 0);
    uint32_t line = msg.value("line", 0u);
    uint32_t col = msg.value("col", 0u);

    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    if (line >= b->line_count()) return {{"items", json::array()}};

    uint32_t ls, le;
    b->line_bytes(line, ls, le);
    uint32_t pos = u16_col_to_byte(b->text, ls, le, col);
    uint32_t start = pos;
    while (start > ls) {
        unsigned char c = (unsigned char)b->text[start - 1];
        bool word_char = c == '_' || (c >= '0' && c <= '9') ||
                         (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
        if (!word_char) break;
        start--;
    }
    std::string prefix = b->text.substr(start, pos - start);

    if (b->completion_symbols_version != b->version) rebuild_completion_symbols(*b);

    std::map<std::string, std::string> matches; // sorted by name, dedup'd

    if (b->lang) {
        auto kwit = kKeywords.find(b->lang->name);
        if (kwit != kKeywords.end()) {
            for (const auto& kw : kwit->second) {
                if (kw != prefix && kw.rfind(prefix, 0) == 0)
                    matches.emplace(kw, "keyword");
            }
        }
    }

    for (const auto& [name, kind] : b->completion_symbols) {
        if (matches.size() >= 200) break;
        if (name != prefix && name.rfind(prefix, 0) == 0)
            matches.emplace(name, kind);
    }

    json items = json::array();
    for (const auto& [name, kind] : matches) {
        items.push_back({{"label", name}, {"kind", kind}, {"insertText", name}});
        if (items.size() >= 50) break;
    }
    return {{"items", items}};
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
    std::string view_key = msg.value("viewKey", "");
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    b->view_states[view_key] = msg.value("state", json::object());
    return json::object();
}

json op_viewstate_get(const json& msg) {
    int id = msg.value("bufferId", 0);
    std::string view_key = msg.value("viewKey", "");
    std::lock_guard<std::mutex> lk(g_mu);
    Buffer* b = find_buffer(id);
    if (!b) return {{"ok", false}, {"error", "unknown buffer"}};
    auto it = b->view_states.find(view_key);
    return {{"state", it != b->view_states.end() ? it->second : json::object()}};
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
    else if (type == "editor.undo")          resp = op_undo(msg);
    else if (type == "editor.redo")          resp = op_redo(msg);
    else if (type == "editor.matchBracket")  resp = op_match_bracket(msg);
    else if (type == "editor.search")        resp = op_search(msg);
    else if (type == "editor.completions")   resp = op_completions(msg);
    else if (type == "editor.save")          resp = op_save(msg);
    else if (type == "editor.close")         resp = op_close(msg);
    else if (type == "editor.viewstate.set") resp = op_viewstate_set(msg);
    else if (type == "editor.viewstate.get") resp = op_viewstate_get(msg);
    else if (type == "editor.buffers")       resp = op_buffers(msg);
    else return false;
    return true;
}

} // namespace editor_ops
