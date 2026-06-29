#include "session.hpp"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <filesystem>
#include <cstdlib>
#endif

#include <sqlite3.h>
#include <spdlog/spdlog.h>

#include <mutex>
#include <string>

using json = nlohmann::json;

namespace session_ops {

namespace {

// ─── Database singleton ───────────────────────────────────────────────────────

static sqlite3*    g_db = nullptr;
static std::mutex  g_db_mu;
static bool        g_db_ok = false;

#ifdef _WIN32
// %APPDATA%\Binder\sessions.db  (same directory as config.json)
static std::wstring db_path_w() {
    wchar_t appdata[MAX_PATH] = {};
    GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH);
    return std::wstring(appdata) + L"\\Binder\\sessions.db";
}
#else
// $HOME/.config/binder/sessions.db
static std::string db_path_u() {
    const char* home = getenv("HOME");
    if (!home || !*home) home = "/tmp";
    return std::string(home) + "/.config/binder/sessions.db";
}
#endif

static sqlite3* db() {
    // Double-checked initialisation inside the mutex.
    if (g_db_ok) return g_db;
    std::lock_guard<std::mutex> lk(g_db_mu);
    // cppcheck-suppress identicalConditionAfterEarlyExit ; double-checked locking, g_db_ok can change under the mutex
    if (g_db_ok) return g_db;

#ifdef _WIN32
    // Ensure directory exists.
    wchar_t appdata[MAX_PATH] = {};
    GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH);
    std::wstring dir = std::wstring(appdata) + L"\\Binder";
    CreateDirectoryW(dir.c_str(), nullptr); // no-op if exists

    std::wstring path = db_path_w();
    // sqlite3_open16 accepts UTF-16LE wchar_t on Windows.
    if (sqlite3_open16(path.c_str(), &g_db) != SQLITE_OK) {
        spdlog::error("[session] sqlite3_open16 failed: {}", sqlite3_errmsg(g_db));
        sqlite3_close(g_db);
        g_db = nullptr;
        return nullptr;
    }
#else
    // Ensure directory exists.
    std::string path = db_path_u();
    std::filesystem::create_directories(
        std::filesystem::path(path).parent_path());

    if (sqlite3_open(path.c_str(), &g_db) != SQLITE_OK) {
        spdlog::error("[session] sqlite3_open failed: {}", sqlite3_errmsg(g_db));
        sqlite3_close(g_db);
        g_db = nullptr;
        return nullptr;
    }
#endif

    // WAL mode for better concurrent read performance.
    sqlite3_exec(g_db, "PRAGMA journal_mode=WAL;", nullptr, nullptr, nullptr);
    sqlite3_exec(g_db, "PRAGMA synchronous=NORMAL;", nullptr, nullptr, nullptr);

    // Schema — table names, column names, types and constraints must be stable:
    // existing users' sessions.db must load fine after an upgrade.
    const char* schema = R"sql(
        CREATE TABLE IF NOT EXISTS sessions (
            id         TEXT    PRIMARY KEY,
            name       TEXT    NOT NULL DEFAULT '',
            tabs       TEXT    NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS command_history (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT    NOT NULL DEFAULT 'default',
            command    TEXT    NOT NULL,
            timestamp  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_history_session
            ON command_history(session_id, id DESC);
    )sql";
    char* errmsg = nullptr;
    if (sqlite3_exec(g_db, schema, nullptr, nullptr, &errmsg) != SQLITE_OK) {
        spdlog::error("[session] schema creation failed: {}", errmsg ? errmsg : "?");
        sqlite3_free(errmsg);
    }

    g_db_ok = true;
    return g_db;
}

// ─── Thin prepared-statement helpers ─────────────────────────────────────────

struct Stmt {
    sqlite3_stmt* s = nullptr;
    ~Stmt() { if (s) sqlite3_finalize(s); }
    bool prepare(sqlite3* db, const char* sql) {
        return sqlite3_prepare_v2(db, sql, -1, &s, nullptr) == SQLITE_OK;
    }
    void bind_text(int col, const std::string& v) {
        sqlite3_bind_text(s, col, v.data(), (int)v.size(), SQLITE_TRANSIENT);
    }
    void bind_int(int col, int64_t v) { sqlite3_bind_int64(s, col, v); }
    bool step() { return sqlite3_step(s) == SQLITE_DONE; }
    bool step_row() { return sqlite3_step(s) == SQLITE_ROW; }
    std::string col_text(int col) {
        const char* t = (const char*)sqlite3_column_text(s, col);
        return t ? t : "";
    }
    int64_t col_int(int col) { return sqlite3_column_int64(s, col); }
};

// ─── session.save ─────────────────────────────────────────────────────────────

static bool save_session(const std::string& sess_id, const std::string& name,
                          const std::string& tabs_json) {
    auto* d = db();
    if (!d) return false;
    std::lock_guard<std::mutex> lk(g_db_mu);

    // Preserve created_at if row already exists.
    const char* upsert = R"sql(
        INSERT INTO sessions(id, name, tabs, created_at, updated_at)
        VALUES(?, ?, ?,
            COALESCE((SELECT created_at FROM sessions WHERE id=?),
                     strftime('%s','now')),
            strftime('%s','now'))
        ON CONFLICT(id) DO UPDATE SET
            name       = excluded.name,
            tabs       = excluded.tabs,
            updated_at = excluded.updated_at;
    )sql";
    Stmt st;
    if (!st.prepare(d, upsert)) return false;
    st.bind_text(1, sess_id);
    st.bind_text(2, name);
    st.bind_text(3, tabs_json);
    st.bind_text(4, sess_id); // for the COALESCE sub-select
    return st.step();
}

// ─── session.load ─────────────────────────────────────────────────────────────

static json load_session(const std::string& sess_id) {
    auto* d = db();
    if (!d) return json::object();
    std::lock_guard<std::mutex> lk(g_db_mu);

    Stmt st;
    if (!st.prepare(d, "SELECT tabs, name, created_at, updated_at FROM sessions WHERE id=?"))
        return json::object();
    st.bind_text(1, sess_id);
    if (!st.step_row()) return json::object();

    json session;
    session["id"]         = sess_id;
    session["name"]       = st.col_text(1);
    session["created_at"] = st.col_int(2);
    session["updated_at"] = st.col_int(3);

    // Parse the tabs JSON stored as TEXT.
    try {
        session["tabs"] = json::parse(st.col_text(0));
    } catch (...) {
        session["tabs"] = json::array();
    }
    return session;
}

// ─── session.list ─────────────────────────────────────────────────────────────

static json list_sessions() {
    auto* d = db();
    if (!d) return json::array();
    std::lock_guard<std::mutex> lk(g_db_mu);

    Stmt st;
    if (!st.prepare(d,
            "SELECT id, name, created_at, updated_at FROM sessions ORDER BY updated_at DESC"))
        return json::array();

    json arr = json::array();
    while (st.step_row()) {
        arr.push_back({
            {"id",         st.col_text(0)},
            {"name",       st.col_text(1)},
            {"created_at", st.col_int(2)},
            {"updated_at", st.col_int(3)},
        });
    }
    return arr;
}

// ─── session.delete ───────────────────────────────────────────────────────────

static bool delete_session(const std::string& sess_id) {
    auto* d = db();
    if (!d) return false;
    std::lock_guard<std::mutex> lk(g_db_mu);

    sqlite3_exec(d, "BEGIN;", nullptr, nullptr, nullptr);

    Stmt st1, st2;
    bool ok = st1.prepare(d, "DELETE FROM sessions WHERE id=?") &&
              (st1.bind_text(1, sess_id), st1.step()) &&
              st2.prepare(d, "DELETE FROM command_history WHERE session_id=?") &&
              (st2.bind_text(1, sess_id), st2.step());

    sqlite3_exec(d, ok ? "COMMIT;" : "ROLLBACK;", nullptr, nullptr, nullptr);
    return ok;
}

// ─── session.history.add ──────────────────────────────────────────────────────

static bool history_add(const std::string& sess_id, const std::string& command) {
    if (command.empty()) return false;
    auto* d = db();
    if (!d) return false;
    std::lock_guard<std::mutex> lk(g_db_mu);

    Stmt st;
    if (!st.prepare(d,
            "INSERT INTO command_history(session_id, command) VALUES(?, ?)"))
        return false;
    st.bind_text(1, sess_id);
    st.bind_text(2, command);
    bool ok = st.step();

    // Prune to keep at most 10 000 entries per session.
    Stmt prune;
    if (ok && prune.prepare(d,
            "DELETE FROM command_history WHERE session_id=? AND "
            "id < (SELECT id FROM command_history WHERE session_id=? "
            "      ORDER BY id DESC LIMIT 1 OFFSET 9999)")) {
        prune.bind_text(1, sess_id);
        prune.bind_text(2, sess_id);
        prune.step();
    }
    return ok;
}

// ─── session.history.get ──────────────────────────────────────────────────────

static json history_get(const std::string& sess_id, int limit) {
    auto* d = db();
    if (!d) return json::array();
    std::lock_guard<std::mutex> lk(g_db_mu);

    Stmt st;
    if (!st.prepare(d,
            "SELECT id, command, timestamp FROM command_history "
            "WHERE session_id=? ORDER BY id DESC LIMIT ?"))
        return json::array();
    st.bind_text(1, sess_id);
    st.bind_int(2, limit);

    json arr = json::array();
    while (st.step_row()) {
        arr.push_back({
            {"id",        st.col_int(0)},
            {"command",   st.col_text(1)},
            {"timestamp", st.col_int(2)},
        });
    }
    return arr;
}

} // namespace

// ─── IPC dispatch ─────────────────────────────────────────────────────────────

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    if (type == "session.save") {
        auto sess_id   = msg.value("id",   std::string{"default"});
        auto name      = msg.value("name", std::string{});
        // tabs may arrive as a JSON array or as a pre-serialised string
        std::string tabs_json;
        if (msg.contains("tabs")) {
            const auto& t = msg["tabs"];
            tabs_json = t.is_string() ? t.get<std::string>() : t.dump();
        } else {
            tabs_json = "[]";
        }
        reply({{"ok", save_session(sess_id, name, tabs_json)}});
        return true;
    }
    if (type == "session.load") {
        auto sess_id = msg.value("id", std::string{"default"});
        reply({{"session", load_session(sess_id)}});
        return true;
    }
    if (type == "session.list") {
        reply({{"sessions", list_sessions()}});
        return true;
    }
    if (type == "session.delete") {
        auto sess_id = msg.value("id", std::string{});
        reply({{"ok", delete_session(sess_id)}});
        return true;
    }
    if (type == "session.history.add") {
        auto sess_id = msg.value("sessionId", std::string{"default"});
        auto command = msg.value("command",   std::string{});
        reply({{"ok", history_add(sess_id, command)}});
        return true;
    }
    if (type == "session.history.get") {
        auto sess_id = msg.value("sessionId", std::string{"default"});
        int  limit   = msg.value("limit",     100);
        reply({{"history", history_get(sess_id, limit)}});
        return true;
    }
    return false;
}

} // namespace session_ops
