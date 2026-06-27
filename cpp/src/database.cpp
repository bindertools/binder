#include "database.hpp"

#include <sqlite3.h>
#include <cstdint>
#include <vector>

using json = nlohmann::json;

namespace database_ops {

namespace {

json read_database(const std::string& path, std::string& error) {
    sqlite3* db = nullptr;
    int rc = sqlite3_open_v2(path.c_str(), &db,
                             SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nullptr);
    if (rc != SQLITE_OK) {
        error = db ? sqlite3_errmsg(db) : "cannot open database";
        if (db) sqlite3_close(db);
        return json();
    }

    // Enumerate user tables (skip sqlite_ internals)
    std::vector<std::string> table_names;
    {
        sqlite3_stmt* stmt = nullptr;
        const char* sql =
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name";
        if (sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr) == SQLITE_OK) {
            while (sqlite3_step(stmt) == SQLITE_ROW) {
                const unsigned char* n = sqlite3_column_text(stmt, 0);
                if (n) table_names.emplace_back(reinterpret_cast<const char*>(n));
            }
            sqlite3_finalize(stmt);
        }
    }

    json tables_arr = json::array();
    static constexpr int kRowLimit = 500;

    for (const auto& tname : table_names) {
        json tobj;
        tobj["name"] = tname;

        // Column info via PRAGMA table_info
        json cols = json::array();
        {
            std::string sql = "PRAGMA table_info(\"" + tname + "\")";
            sqlite3_stmt* stmt = nullptr;
            if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
                while (sqlite3_step(stmt) == SQLITE_ROW) {
                    json col;
                    auto cn = sqlite3_column_text(stmt, 1);
                    auto ct = sqlite3_column_text(stmt, 2);
                    col["name"]    = cn ? std::string(reinterpret_cast<const char*>(cn)) : "";
                    col["type"]    = ct ? std::string(reinterpret_cast<const char*>(ct)) : "";
                    col["notnull"] = sqlite3_column_int(stmt, 3) != 0;
                    col["pk"]      = sqlite3_column_int(stmt, 5) != 0;
                    cols.push_back(col);
                }
                sqlite3_finalize(stmt);
            }
        }
        tobj["columns"] = cols;

        // Row count
        int64_t row_count = 0;
        {
            std::string sql = "SELECT COUNT(*) FROM \"" + tname + "\"";
            sqlite3_stmt* stmt = nullptr;
            if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
                if (sqlite3_step(stmt) == SQLITE_ROW)
                    row_count = sqlite3_column_int64(stmt, 0);
                sqlite3_finalize(stmt);
            }
        }
        tobj["row_count"] = row_count;

        // Rows (capped at kRowLimit). Try to also fetch the implicit rowid so
        // the frontend can address specific rows for editing; WITHOUT ROWID
        // tables don't have one, so fall back gracefully.
        json rows   = json::array();
        json rowids = json::array();
        bool has_rowid = true;
        {
            std::string sql = "SELECT rowid AS __rowid__, * FROM \"" + tname +
                              "\" LIMIT " + std::to_string(kRowLimit);
            sqlite3_stmt* stmt = nullptr;
            if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
                has_rowid = false;
                sql = "SELECT * FROM \"" + tname + "\" LIMIT " + std::to_string(kRowLimit);
                sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);
            }
            if (stmt) {
                int ncols    = sqlite3_column_count(stmt);
                int col_base = has_rowid ? 1 : 0;
                while (sqlite3_step(stmt) == SQLITE_ROW) {
                    if (has_rowid) rowids.push_back(sqlite3_column_int64(stmt, 0));
                    json row = json::array();
                    for (int i = col_base; i < ncols; ++i) {
                        switch (sqlite3_column_type(stmt, i)) {
                            case SQLITE_NULL:
                                row.push_back(nullptr);
                                break;
                            case SQLITE_INTEGER:
                                row.push_back(sqlite3_column_int64(stmt, i));
                                break;
                            case SQLITE_FLOAT:
                                row.push_back(sqlite3_column_double(stmt, i));
                                break;
                            default: {
                                auto t = sqlite3_column_text(stmt, i);
                                row.push_back(t ? std::string(
                                    reinterpret_cast<const char*>(t)) : "");
                                break;
                            }
                        }
                    }
                    rows.push_back(row);
                }
                sqlite3_finalize(stmt);
            }
        }
        tobj["rows"]      = rows;
        tobj["has_rowid"] = has_rowid;
        if (has_rowid) tobj["rowids"] = rowids;

        tables_arr.push_back(tobj);
    }

    sqlite3_close(db);
    return json{{"tables", tables_arr}};
}

json exec_database(const std::string& path, const std::string& sql,
                   const json& params, std::string& error) {
    sqlite3* db = nullptr;
    int rc = sqlite3_open_v2(path.c_str(), &db,
                             SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOMUTEX, nullptr);
    if (rc != SQLITE_OK) {
        error = db ? sqlite3_errmsg(db) : "cannot open database";
        if (db) sqlite3_close(db);
        return json();
    }

    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        error = sqlite3_errmsg(db);
        sqlite3_close(db);
        return json();
    }

    int idx = 1;
    for (const auto& p : params) {
        if (p.is_null()) {
            sqlite3_bind_null(stmt, idx);
        } else if (p.is_boolean()) {
            sqlite3_bind_int(stmt, idx, p.get<bool>() ? 1 : 0);
        } else if (p.is_number_integer()) {
            sqlite3_bind_int64(stmt, idx, p.get<int64_t>());
        } else if (p.is_number_float()) {
            sqlite3_bind_double(stmt, idx, p.get<double>());
        } else {
            sqlite3_bind_text(stmt, idx, p.get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        }
        ++idx;
    }

    int step_rc = sqlite3_step(stmt);
    if (step_rc != SQLITE_DONE && step_rc != SQLITE_ROW) {
        error = sqlite3_errmsg(db);
        sqlite3_finalize(stmt);
        sqlite3_close(db);
        return json();
    }

    int changes = sqlite3_changes(db);
    sqlite3_finalize(stmt);
    sqlite3_close(db);
    return json{{"changes", changes}};
}

} // namespace

bool dispatch(const std::string& type, const json& msg, const std::string& /*id*/, json& resp) {
    if (type == "db.read") {
        std::string db_path = msg.value("path", msg.value("key", std::string{}));
        if (db_path.empty()) { resp = {{"ok", false}, {"error", "db.read: no path specified"}}; return true; }

        std::string error;
        json result = read_database(db_path, error);
        if (!error.empty()) resp = {{"ok", false}, {"error", "Cannot open database: " + error}};
        else resp = result;
        return true;
    }

    if (type == "db.exec") {
        std::string db_path = msg.value("path", std::string{});
        std::string sql     = msg.value("sql", std::string{});
        json params         = msg.value("params", json::array());
        if (db_path.empty() || sql.empty()) {
            resp = {{"ok", false}, {"error", "db.exec: missing path or sql"}};
            return true;
        }

        std::string error;
        json result = exec_database(db_path, sql, params, error);
        if (!error.empty()) resp = {{"ok", false}, {"error", error}};
        else resp = result;
        return true;
    }

    return false;
}

} // namespace database_ops
