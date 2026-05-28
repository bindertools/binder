#pragma once
#include <array>
#include <string>

// Header-only base64 encode/decode (RFC 4648, no line breaks).
namespace base64 {

inline std::string encode(const char* data, size_t len) {
    static constexpr char kAlpha[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        auto b0 = static_cast<uint8_t>(data[i]);
        auto b1 = (i + 1 < len) ? static_cast<uint8_t>(data[i + 1]) : 0;
        auto b2 = (i + 2 < len) ? static_cast<uint8_t>(data[i + 2]) : 0;
        uint32_t v = (b0 << 16) | (b1 << 8) | b2;
        out += kAlpha[(v >> 18) & 0x3F];
        out += kAlpha[(v >> 12) & 0x3F];
        out += (i + 1 < len) ? kAlpha[(v >> 6) & 0x3F] : '=';
        out += (i + 2 < len) ? kAlpha[v & 0x3F]        : '=';
    }
    return out;
}

inline std::string encode(const std::string& s) {
    return encode(s.data(), s.size());
}

inline std::string decode(const std::string& s) {
    static const auto kDec = [] {
        std::array<int8_t, 256> t{};
        t.fill(-1);
        const char* alpha =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < 64; ++i)
            t[static_cast<uint8_t>(alpha[i])] = static_cast<int8_t>(i);
        t[static_cast<uint8_t>('=')] = -2; // padding sentinel
        return t;
    }();

    std::string out;
    out.reserve((s.size() / 4) * 3);
    int val = 0, bits = -8;
    for (unsigned char c : s) {
        int8_t v = kDec[c];
        if (v == -1) continue;   // skip non-alphabet chars
        if (v == -2) { bits -= 6; continue; } // padding
        val = (val << 6) + v;
        bits += 6;
        if (bits >= 0) {
            out += static_cast<char>((val >> bits) & 0xFF);
            bits -= 8;
        }
    }
    return out;
}

} // namespace base64
