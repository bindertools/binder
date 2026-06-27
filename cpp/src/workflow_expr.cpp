#include "workflow_expr.hpp"

#include <cctype>
#include <cmath>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace workflow_expr {

using json = nlohmann::json;

namespace {

std::string to_lower(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) out += (char)std::tolower((unsigned char)c);
    return out;
}

std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return "";
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

} // namespace

bool is_truthy(const json& v) {
    if (v.is_null()) return false;
    if (v.is_boolean()) return v.get<bool>();
    if (v.is_number()) {
        double d = v.get<double>();
        return d != 0.0 && !std::isnan(d);
    }
    if (v.is_string()) return !v.get<std::string>().empty();
    return true; // arrays/objects
}

std::string to_display_string(const json& v) {
    if (v.is_null()) return "";
    if (v.is_string()) return v.get<std::string>();
    if (v.is_boolean()) return v.get<bool>() ? "true" : "false";
    if (v.is_number()) {
        double d = v.get<double>();
        if (std::isnan(d)) return "NaN";
        if (d == (double)(long long)d && std::abs(d) < 1e15) {
            return std::to_string((long long)d);
        }
        std::ostringstream ss;
        ss << d;
        return ss.str();
    }
    return v.dump();
}

double to_number(const json& v) {
    if (v.is_number()) return v.get<double>();
    if (v.is_boolean()) return v.get<bool>() ? 1.0 : 0.0;
    if (v.is_null()) return 0.0;
    if (v.is_string()) {
        const std::string& s = v.get<std::string>();
        std::string t = trim(s);
        if (t.empty()) return std::numeric_limits<double>::quiet_NaN();
        try {
            size_t consumed = 0;
            double d = std::stod(t, &consumed);
            if (consumed == t.size()) return d;
        } catch (...) {
        }
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::numeric_limits<double>::quiet_NaN();
}

namespace {

bool loose_equals(const json& a, const json& b) {
    if (a.type() == b.type()) {
        if (a.is_string()) return to_lower(a.get<std::string>()) == to_lower(b.get<std::string>());
        if (a.is_number()) return a.get<double>() == b.get<double>();
        return a == b;
    }
    if (a.is_null() || b.is_null()) return false;
    double da = to_number(a), db = to_number(b);
    if (std::isnan(da) || std::isnan(db)) return false;
    return da == db;
}

json json_member(const json& val, const std::string& key) {
    if (!val.is_object()) return nullptr;
    if (val.contains(key)) return val.at(key);
    std::string lowerKey = to_lower(key);
    for (auto it = val.begin(); it != val.end(); ++it) {
        if (to_lower(it.key()) == lowerKey) return it.value();
    }
    return nullptr;
}

json json_index(const json& val, const json& idx) {
    if (val.is_array()) {
        double n = to_number(idx);
        if (!std::isnan(n)) {
            long long i = (long long)n;
            if (i >= 0 && i < (long long)val.size()) return val[(size_t)i];
        }
        return nullptr;
    }
    if (val.is_object()) return json_member(val, to_display_string(idx));
    return nullptr;
}

json resolve_context(const Context& ctx, const std::string& nameLower) {
    if (nameLower == "env") return ctx.env;
    if (nameLower == "github") return ctx.github;
    if (nameLower == "runner") return ctx.runner;
    if (nameLower == "matrix") return ctx.matrix;
    if (nameLower == "steps") return ctx.steps;
    if (nameLower == "secrets") return ctx.secrets;
    if (nameLower == "vars") return ctx.vars;
    if (nameLower == "inputs") return ctx.inputs;
    if (nameLower == "needs") return ctx.needs;
    if (nameLower == "strategy") return ctx.strategy;
    if (nameLower == "job") return ctx.job;
    return nullptr;
}

bool job_status_is(const Context& ctx, const char* status) {
    return ctx.job.value("status", std::string("success")) == status;
}

json call_function(const Context& ctx, const std::string& name, const std::vector<json>& args) {
    std::string lower = to_lower(name);

    if (lower == "success") return !job_status_is(ctx, "failure") && !job_status_is(ctx, "cancelled");
    if (lower == "failure") return job_status_is(ctx, "failure");
    if (lower == "always") return true;
    if (lower == "cancelled") return false;

    if (lower == "contains") {
        if (args.size() < 2) return false;
        const json& hay = args[0];
        if (hay.is_array()) {
            for (auto& item : hay) {
                if (loose_equals(item, args[1])) return true;
            }
            return false;
        }
        std::string h = to_lower(to_display_string(hay));
        std::string n = to_lower(to_display_string(args[1]));
        return h.find(n) != std::string::npos;
    }

    if (lower == "startswith") {
        if (args.size() < 2) return false;
        std::string s = to_lower(to_display_string(args[0]));
        std::string p = to_lower(to_display_string(args[1]));
        return s.size() >= p.size() && s.compare(0, p.size(), p) == 0;
    }

    if (lower == "endswith") {
        if (args.size() < 2) return false;
        std::string s = to_lower(to_display_string(args[0]));
        std::string p = to_lower(to_display_string(args[1]));
        return s.size() >= p.size() && s.compare(s.size() - p.size(), p.size(), p) == 0;
    }

    if (lower == "format") {
        if (args.empty()) return std::string();
        const std::string fmt = to_display_string(args[0]);
        std::string out;
        out.reserve(fmt.size());
        for (size_t i = 0; i < fmt.size(); i++) {
            char c = fmt[i];
            if (c == '{' && i + 1 < fmt.size() && fmt[i + 1] == '{') { out += '{'; i++; continue; }
            if (c == '}' && i + 1 < fmt.size() && fmt[i + 1] == '}') { out += '}'; i++; continue; }
            if (c == '{') {
                size_t end = fmt.find('}', i + 1);
                if (end != std::string::npos) {
                    std::string idxStr = fmt.substr(i + 1, end - i - 1);
                    try {
                        size_t idx = (size_t)std::stoul(idxStr);
                        if (idx + 1 < args.size()) out += to_display_string(args[idx + 1]);
                        i = end;
                        continue;
                    } catch (...) {
                    }
                }
            }
            out += c;
        }
        return out;
    }

    if (lower == "join") {
        if (args.empty()) return std::string();
        std::string sep = args.size() > 1 ? to_display_string(args[1]) : ",";
        if (!args[0].is_array()) return to_display_string(args[0]);
        std::string out;
        for (size_t i = 0; i < args[0].size(); i++) {
            if (i) out += sep;
            out += to_display_string(args[0][i]);
        }
        return out;
    }

    if (lower == "tojson") {
        if (args.empty()) return std::string();
        return args[0].dump(2);
    }

    if (lower == "fromjson") {
        if (args.empty()) return nullptr;
        try {
            return json::parse(to_display_string(args[0]));
        } catch (...) {
            return nullptr;
        }
    }

    return nullptr;
}

// ───────────────────────────── lexer ───────────────────────────────────────

struct Token {
    enum Type { Number, String, Ident, LParen, RParen, LBracket, RBracket, Dot, Comma, Op, End };
    Type type = End;
    std::string text;
    double num = 0;
};

class Lexer {
public:
    explicit Lexer(const std::string& src) : src_(src) {}

    Token next() {
        skipWs();
        if (pos_ >= src_.size()) return {Token::End, "", 0};
        char c = src_[pos_];

        if (c == '(') { pos_++; return {Token::LParen, "(", 0}; }
        if (c == ')') { pos_++; return {Token::RParen, ")", 0}; }
        if (c == '[') { pos_++; return {Token::LBracket, "[", 0}; }
        if (c == ']') { pos_++; return {Token::RBracket, "]", 0}; }
        if (c == '.') { pos_++; return {Token::Dot, ".", 0}; }
        if (c == ',') { pos_++; return {Token::Comma, ",", 0}; }
        if (c == '\'') return lexString();
        if (std::isdigit((unsigned char)c) ||
            (c == '-' && pos_ + 1 < src_.size() && std::isdigit((unsigned char)src_[pos_ + 1]))) {
            return lexNumber();
        }
        if (std::isalpha((unsigned char)c) || c == '_') return lexIdent();

        if (c == '=' && peekAt(1) == '=') { pos_ += 2; return {Token::Op, "==", 0}; }
        if (c == '!' && peekAt(1) == '=') { pos_ += 2; return {Token::Op, "!=", 0}; }
        if (c == '<' && peekAt(1) == '=') { pos_ += 2; return {Token::Op, "<=", 0}; }
        if (c == '>' && peekAt(1) == '=') { pos_ += 2; return {Token::Op, ">=", 0}; }
        if (c == '&' && peekAt(1) == '&') { pos_ += 2; return {Token::Op, "&&", 0}; }
        if (c == '|' && peekAt(1) == '|') { pos_ += 2; return {Token::Op, "||", 0}; }
        if (c == '<') { pos_++; return {Token::Op, "<", 0}; }
        if (c == '>') { pos_++; return {Token::Op, ">", 0}; }
        if (c == '!') { pos_++; return {Token::Op, "!", 0}; }

        throw std::runtime_error(std::string("unexpected character in expression: '") + c + "'");
    }

private:
    const std::string& src_;
    size_t pos_ = 0;

    char peekAt(size_t offset) const {
        size_t i = pos_ + offset;
        return i < src_.size() ? src_[i] : '\0';
    }

    void skipWs() {
        while (pos_ < src_.size() && std::isspace((unsigned char)src_[pos_])) pos_++;
    }

    Token lexNumber() {
        size_t start = pos_;
        if (src_[pos_] == '-') pos_++;
        while (pos_ < src_.size() && std::isdigit((unsigned char)src_[pos_])) pos_++;
        if (pos_ < src_.size() && src_[pos_] == '.') {
            pos_++;
            while (pos_ < src_.size() && std::isdigit((unsigned char)src_[pos_])) pos_++;
        }
        if (pos_ < src_.size() && (src_[pos_] == 'e' || src_[pos_] == 'E')) {
            size_t save = pos_;
            pos_++;
            if (pos_ < src_.size() && (src_[pos_] == '+' || src_[pos_] == '-')) pos_++;
            if (pos_ < src_.size() && std::isdigit((unsigned char)src_[pos_])) {
                while (pos_ < src_.size() && std::isdigit((unsigned char)src_[pos_])) pos_++;
            } else {
                pos_ = save;
            }
        }
        std::string text = src_.substr(start, pos_ - start);
        Token t;
        t.type = Token::Number;
        t.text = text;
        t.num = std::stod(text);
        return t;
    }

    Token lexString() {
        pos_++; // opening '
        std::string out;
        while (pos_ < src_.size()) {
            char c = src_[pos_];
            if (c == '\'') {
                if (pos_ + 1 < src_.size() && src_[pos_ + 1] == '\'') {
                    out += '\'';
                    pos_ += 2;
                    continue;
                }
                pos_++;
                break;
            }
            out += c;
            pos_++;
        }
        Token t;
        t.type = Token::String;
        t.text = out;
        return t;
    }

    Token lexIdent() {
        size_t start = pos_;
        while (pos_ < src_.size() &&
               (std::isalnum((unsigned char)src_[pos_]) || src_[pos_] == '_' || src_[pos_] == '-')) {
            pos_++;
        }
        Token t;
        t.type = Token::Ident;
        t.text = src_.substr(start, pos_ - start);
        return t;
    }
};

// ───────────────────────────── parser ──────────────────────────────────────

class ExprParser {
public:
    ExprParser(const std::string& src, const Context& ctx) : lex_(src), ctx_(ctx) { advance(); }

    json parse() {
        json result = parseOr();
        if (cur_.type != Token::End) throw std::runtime_error("unexpected trailing tokens in expression");
        return result;
    }

private:
    Lexer lex_;
    const Context& ctx_;
    Token cur_;

    void advance() { cur_ = lex_.next(); }

    bool isOp(const char* op) const { return cur_.type == Token::Op && cur_.text == op; }

    json parseOr() {
        json left = parseAnd();
        while (isOp("||")) {
            advance();
            json right = parseAnd();
            left = is_truthy(left) ? left : right;
        }
        return left;
    }

    json parseAnd() {
        json left = parseEquality();
        while (isOp("&&")) {
            advance();
            json right = parseEquality();
            left = is_truthy(left) ? right : left;
        }
        return left;
    }

    json parseEquality() {
        json left = parseRelational();
        while (isOp("==") || isOp("!=")) {
            bool eq = cur_.text == "==";
            advance();
            json right = parseRelational();
            bool result = loose_equals(left, right);
            left = eq ? result : !result;
        }
        return left;
    }

    json parseRelational() {
        json left = parseUnary();
        while (isOp("<") || isOp("<=") || isOp(">") || isOp(">=")) {
            std::string op = cur_.text;
            advance();
            json right = parseUnary();
            double a = to_number(left), b = to_number(right);
            bool result = false;
            if (!std::isnan(a) && !std::isnan(b)) {
                if (op == "<") result = a < b;
                else if (op == "<=") result = a <= b;
                else if (op == ">") result = a > b;
                else result = a >= b;
            }
            left = result;
        }
        return left;
    }

    json parseUnary() {
        if (isOp("!")) {
            advance();
            json v = parseUnary();
            return !is_truthy(v);
        }
        return parsePostfix();
    }

    json parsePostfix() {
        json val = parsePrimary();
        while (true) {
            if (cur_.type == Token::Dot) {
                advance();
                if (cur_.type != Token::Ident) throw std::runtime_error("expected identifier after '.'");
                std::string key = cur_.text;
                advance();
                val = json_member(val, key);
            } else if (cur_.type == Token::LBracket) {
                advance();
                json idx = parseOr();
                if (cur_.type != Token::RBracket) throw std::runtime_error("expected ']'");
                advance();
                val = json_index(val, idx);
            } else {
                break;
            }
        }
        return val;
    }

    json parsePrimary() {
        if (cur_.type == Token::Number) {
            double n = cur_.num;
            advance();
            return n;
        }
        if (cur_.type == Token::String) {
            std::string s = cur_.text;
            advance();
            return s;
        }
        if (cur_.type == Token::LParen) {
            advance();
            json v = parseOr();
            if (cur_.type != Token::RParen) throw std::runtime_error("expected ')'");
            advance();
            return v;
        }
        if (cur_.type == Token::Ident) {
            std::string name = cur_.text;
            advance();
            if (cur_.type == Token::LParen) {
                advance();
                std::vector<json> args;
                if (cur_.type != Token::RParen) {
                    args.push_back(parseOr());
                    while (cur_.type == Token::Comma) {
                        advance();
                        args.push_back(parseOr());
                    }
                }
                if (cur_.type != Token::RParen) throw std::runtime_error("expected ')'");
                advance();
                return call_function(ctx_, name, args);
            }
            std::string lower = to_lower(name);
            if (lower == "true") return true;
            if (lower == "false") return false;
            if (lower == "null") return nullptr;
            return resolve_context(ctx_, lower);
        }
        throw std::runtime_error("unexpected token in expression");
    }
};

} // namespace

json eval_expression(const std::string& exprSrc, const Context& ctx) {
    ExprParser parser(exprSrc, ctx);
    return parser.parse();
}

std::string substitute(const std::string& text, const Context& ctx) {
    std::string out;
    size_t i = 0;
    while (i < text.size()) {
        size_t start = text.find("${{", i);
        if (start == std::string::npos) {
            out += text.substr(i);
            break;
        }
        out += text.substr(i, start - i);
        size_t end = text.find("}}", start + 3);
        if (end == std::string::npos) {
            out += text.substr(start);
            break;
        }
        std::string exprSrc = trim(text.substr(start + 3, end - (start + 3)));
        try {
            out += to_display_string(eval_expression(exprSrc, ctx));
        } catch (...) {
            // Leave unresolvable expressions empty rather than failing.
        }
        i = end + 2;
    }
    return out;
}

bool eval_if(const std::string& ifExpr, const Context& ctx) {
    std::string trimmed = trim(ifExpr);
    if (trimmed.empty()) {
        return !job_status_is(ctx, "failure") && !job_status_is(ctx, "cancelled");
    }
    if (trimmed.size() >= 5 && trimmed.compare(0, 3, "${{") == 0 &&
        trimmed.compare(trimmed.size() - 2, 2, "}}") == 0) {
        trimmed = trim(trimmed.substr(3, trimmed.size() - 5));
    }
    try {
        return is_truthy(eval_expression(trimmed, ctx));
    } catch (...) {
        return true;
    }
}

} // namespace workflow_expr
