#include "sysinfo.hpp"
#include <spdlog/spdlog.h>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <ws2def.h>   // AF_INET — must come after windows.h, before iphlpapi.h
#include <iphlpapi.h>
#include <psapi.h>
#endif // _WIN32

#include <algorithm>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

namespace sysinfo_ops {

#ifdef _WIN32

namespace {

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Port stored in network byte order (big-endian) → host uint16.
static uint16_t net_port(DWORD dw) {
    return (uint16_t)(((dw & 0xFF) << 8) | ((dw >> 8) & 0xFF));
}

// IPv4 address stored as network-byte-order DWORD → dotted-decimal string.
static std::string ipv4_str(DWORD addr) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%u.%u.%u.%u",
        (addr & 0xFF), ((addr >> 8) & 0xFF),
        ((addr >> 16) & 0xFF), ((addr >> 24) & 0xFF));
    return buf;
}

// Wide-char string to UTF-8.
static std::string to_utf8(const wchar_t* ws, int wlen = -1) {
    if (wlen == 0) return "";
    int n = WideCharToMultiByte(CP_UTF8, 0, ws, wlen, nullptr, 0, nullptr, nullptr);
    if (n <= 0) return "";
    std::string s(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, ws, wlen, s.data(), n, nullptr, nullptr);
    return s;
}

// Exe basename for a PID (empty string on failure).
static std::string process_name(DWORD pid) {
    if (pid == 0) return "";
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!h) return "";
    wchar_t path[MAX_PATH] = {};
    DWORD size = MAX_PATH;
    std::string name;
    if (QueryFullProcessImageNameW(h, 0, path, &size)) {
        std::wstring ws(path, size);
        auto pos = ws.rfind(L'\\');
        if (pos != std::wstring::npos) ws = ws.substr(pos + 1);
        name = to_utf8(ws.data(), (int)ws.size());
    }
    CloseHandle(h);
    return name;
}

static const char* tcp_state_str(DWORD state) {
    switch (state) {
        case 2:  return "LISTEN";       // MIB_TCP_STATE_LISTEN
        case 5:  return "ESTABLISHED";  // MIB_TCP_STATE_ESTAB
        case 8:  return "CLOSE_WAIT";   // MIB_TCP_STATE_CLOSE_WAIT
        case 11: return "TIME_WAIT";    // MIB_TCP_STATE_TIME_WAIT
        default: return "";
    }
}

// ─── Ports ────────────────────────────────────────────────────────────────────

json ports_impl() {
    json results = json::array();

    // Cache PID → process name lookups (each OpenProcess is expensive).
    std::unordered_map<DWORD, std::string> pid_cache;
    auto get_name = [&](DWORD pid) -> const std::string& {
        auto it = pid_cache.find(pid);
        if (it == pid_cache.end())
            it = pid_cache.emplace(pid, process_name(pid)).first;
        return it->second;
    };

    // ── TCP (IPv4) ────────────────────────────────────────────────────────────
    {
        DWORD size = 0;
        GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
        std::vector<BYTE> buf(size + 512); // extra for TOCTOU races
        auto* table = reinterpret_cast<MIB_TCPTABLE_OWNER_PID*>(buf.data());
        if (GetExtendedTcpTable(table, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0) == NO_ERROR) {
            for (DWORD i = 0; i < table->dwNumEntries; ++i) {
                auto& row = table->table[i];
                uint16_t port = net_port(row.dwLocalPort);
                if (port == 0) continue;
                std::string addr = ipv4_str(row.dwLocalAddr) + ":" + std::to_string(port);
                results.push_back({
                    {"protocol", "tcp"},
                    {"port",     (int)port},
                    {"pid",      (int)row.dwOwningPid},
                    {"process",  get_name(row.dwOwningPid)},
                    {"address",  addr},
                    {"state",    tcp_state_str(row.dwState)},
                });
            }
        }
    }

    // ── UDP (IPv4) ────────────────────────────────────────────────────────────
    {
        DWORD size = 0;
        GetExtendedUdpTable(nullptr, &size, FALSE, AF_INET, UDP_TABLE_OWNER_PID, 0);
        std::vector<BYTE> buf(size + 512);
        auto* table = reinterpret_cast<MIB_UDPTABLE_OWNER_PID*>(buf.data());
        if (GetExtendedUdpTable(table, &size, FALSE, AF_INET, UDP_TABLE_OWNER_PID, 0) == NO_ERROR) {
            for (DWORD i = 0; i < table->dwNumEntries; ++i) {
                auto& row = table->table[i];
                uint16_t port = net_port(row.dwLocalPort);
                if (port == 0) continue;
                std::string addr = ipv4_str(row.dwLocalAddr) + ":" + std::to_string(port);
                results.push_back({
                    {"protocol", "udp"},
                    {"port",     (int)port},
                    {"pid",      (int)row.dwOwningPid},
                    {"process",  get_name(row.dwOwningPid)},
                    {"address",  addr},
                    {"state",    ""},
                });
            }
        }
    }

    return results;
}

// Find the PID owning `port` (TCP first, then UDP) and terminate it.
// Returns a human-readable status string for display in the UI.
static std::string kill_port_impl(uint16_t port) {
    DWORD pid = 0;

    {
        DWORD size = 0;
        GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
        std::vector<BYTE> buf(size + 512);
        auto* table = reinterpret_cast<MIB_TCPTABLE_OWNER_PID*>(buf.data());
        if (GetExtendedTcpTable(table, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0) == NO_ERROR) {
            for (DWORD i = 0; i < table->dwNumEntries && !pid; ++i) {
                if (net_port(table->table[i].dwLocalPort) == port) pid = table->table[i].dwOwningPid;
            }
        }
    }
    if (!pid) {
        DWORD size = 0;
        GetExtendedUdpTable(nullptr, &size, FALSE, AF_INET, UDP_TABLE_OWNER_PID, 0);
        std::vector<BYTE> buf(size + 512);
        auto* table = reinterpret_cast<MIB_UDPTABLE_OWNER_PID*>(buf.data());
        if (GetExtendedUdpTable(table, &size, FALSE, AF_INET, UDP_TABLE_OWNER_PID, 0) == NO_ERROR) {
            for (DWORD i = 0; i < table->dwNumEntries && !pid; ++i) {
                if (net_port(table->table[i].dwLocalPort) == port) pid = table->table[i].dwOwningPid;
            }
        }
    }
    if (!pid) return "no process is listening on port " + std::to_string(port);

    std::string name  = process_name(pid);
    std::string label = name.empty() ? ("PID " + std::to_string(pid)) : (name + " (PID " + std::to_string(pid) + ")");

    HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
    if (!h) return "access denied terminating " + label;
    bool ok = TerminateProcess(h, 1);
    CloseHandle(h);
    if (!ok) return "failed to terminate " + label;
    return "terminated " + label + " (was on port " + std::to_string(port) + ")";
}

// ─── CPU (delta-based, same pattern as Go's windows.go) ───────────────────────

static LONGLONG s_last_idle   = 0;
static LONGLONG s_last_kernel = 0;
static LONGLONG s_last_user   = 0;

static double cpu_percent() {
    FILETIME idle_ft, kernel_ft, user_ft;
    if (!GetSystemTimes(&idle_ft, &kernel_ft, &user_ft)) return 0.0;

    LONGLONG i = (LONGLONG)idle_ft.dwHighDateTime   << 32 | (LONGLONG)idle_ft.dwLowDateTime;
    LONGLONG k = (LONGLONG)kernel_ft.dwHighDateTime << 32 | (LONGLONG)kernel_ft.dwLowDateTime;
    LONGLONG u = (LONGLONG)user_ft.dwHighDateTime   << 32 | (LONGLONG)user_ft.dwLowDateTime;

    LONGLONG di = i - s_last_idle;
    LONGLONG dk = k - s_last_kernel;
    LONGLONG du = u - s_last_user;
    s_last_idle = i; s_last_kernel = k; s_last_user = u;

    LONGLONG total = dk + du;
    if (total <= 0) return 0.0;
    LONGLONG busy = total - di;
    if (busy < 0) busy = 0;
    double pct = (double)busy * 100.0 / (double)total;
    return pct > 100.0 ? 100.0 : pct;
}

// ─── Memory ───────────────────────────────────────────────────────────────────

static void mem_stats(uint64_t& used, uint64_t& total, double& percent) {
    MEMORYSTATUSEX ms{};
    ms.dwLength = sizeof(ms);
    GlobalMemoryStatusEx(&ms);
    total   = ms.ullTotalPhys;
    used    = total - ms.ullAvailPhys;
    percent = (double)ms.dwMemoryLoad;
}

// ─── Disk (C:\) ───────────────────────────────────────────────────────────────

static void disk_stats(uint64_t& used, uint64_t& total, double& percent) {
    ULARGE_INTEGER free_caller{}, total_bytes{}, total_free{};
    GetDiskFreeSpaceExW(L"C:\\", &free_caller, &total_bytes, &total_free);
    total   = total_bytes.QuadPart;
    used    = total - total_free.QuadPart;
    percent = total > 0 ? (double)used * 100.0 / (double)total : 0.0;
}

// ─── Network (cumulative bytes via GetIfTable, skip loopback) ─────────────────

static void net_stats(uint64_t& sent, uint64_t& recv) {
    sent = recv = 0;
    DWORD size = 0;
    GetIfTable(nullptr, &size, FALSE);
    std::vector<BYTE> buf(size + 256);
    auto* table = reinterpret_cast<MIB_IFTABLE*>(buf.data());
    if (GetIfTable(table, &size, FALSE) == NO_ERROR) {
        for (DWORD i = 0; i < table->dwNumEntries; ++i) {
            auto& row = table->table[i];
            if (row.dwType == MIB_IF_TYPE_LOOPBACK) continue;
            sent += row.dwOutOctets;
            recv += row.dwInOctets;
        }
    }
}

// ─── GPU (nvidia-smi → wmic fallback, same as Go) ─────────────────────────────

// Spawn a no-window process and capture its stdout into `out`. Returns false on
// failure to launch; always closes handles before returning.
static bool run_capture(std::wstring cmd, std::string& out, DWORD timeout_ms = 5000) {
    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE rd = INVALID_HANDLE_VALUE, wr = INVALID_HANDLE_VALUE;
    if (!CreatePipe(&rd, &wr, &sa, 0)) return false;
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si{};
    si.cb         = sizeof(si);
    si.dwFlags    = STARTF_USESTDHANDLES;
    si.hStdOutput = wr;
    si.hStdError  = INVALID_HANDLE_VALUE;
    si.hStdInput  = INVALID_HANDLE_VALUE;

    PROCESS_INFORMATION pi{};
    if (!CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, TRUE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        CloseHandle(rd); CloseHandle(wr);
        return false;
    }
    CloseHandle(wr);
    CloseHandle(pi.hThread);

    char buf[4096] = {};
    DWORD n = 0;
    ReadFile(rd, buf, sizeof(buf) - 1, &n, nullptr);
    CloseHandle(rd);
    WaitForSingleObject(pi.hProcess, timeout_ms);
    CloseHandle(pi.hProcess);

    out.assign(buf, n);
    return n > 0;
}

static void gpu_stats(double& percent, std::string& name, bool& available) {
    percent = 0.0; name = ""; available = false;

    // Try nvidia-smi
    std::string out;
    if (run_capture(L"nvidia-smi --query-gpu=utilization.gpu,name --format=csv,noheader",
                    out, 3000)) {
        // Trim trailing whitespace/newline
        while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' '))
            out.pop_back();
        auto comma = out.find(',');
        if (comma != std::string::npos) {
            std::string pstr = out.substr(0, comma);
            // Strip trailing " %" as Go does
            while (!pstr.empty() && (pstr.back() == ' ' || pstr.back() == '%'))
                pstr.pop_back();
            // Trim leading spaces
            while (!pstr.empty() && pstr.front() == ' ') pstr.erase(pstr.begin());
            try {
                percent   = std::stod(pstr);
                name      = out.substr(comma + 1);
                while (!name.empty() && name.front() == ' ') name.erase(name.begin());
                available = true;
                return;
            } catch (...) {}
        }
    }

    // Fall back to wmic for GPU name only (same as Go)
    std::string wmic_out;
    if (run_capture(L"wmic path Win32_VideoController get Name /value", wmic_out, 5000)) {
        std::istringstream ss(wmic_out);
        std::string line;
        while (std::getline(ss, line)) {
            while (!line.empty() && (line.back() == '\r' || line.back() == '\n'))
                line.pop_back();
            if (line.size() > 5 && line.substr(0, 5) == "Name=") {
                name = line.substr(5);
                break;
            }
        }
    }
}

// ─── Perf snapshot ───────────────────────────────────────────────────────────

json perf_impl() {
    uint64_t mem_used, mem_total; double mem_pct;
    mem_stats(mem_used, mem_total, mem_pct);

    uint64_t disk_used, disk_total; double disk_pct;
    disk_stats(disk_used, disk_total, disk_pct);

    uint64_t net_sent, net_recv;
    net_stats(net_sent, net_recv);

    double gpu_pct; std::string gpu_name; bool gpu_avail;
    gpu_stats(gpu_pct, gpu_name, gpu_avail);

    return {
        {"cpu_percent",    cpu_percent()},
        {"mem_used",       mem_used},
        {"mem_total",      mem_total},
        {"mem_percent",    mem_pct},
        {"disk_used",      disk_used},
        {"disk_total",     disk_total},
        {"disk_percent",   disk_pct},
        {"net_bytes_sent", net_sent},
        {"net_bytes_recv", net_recv},
        {"gpu_percent",    gpu_pct},
        {"gpu_name",       gpu_name},
        {"gpu_available",  gpu_avail},
    };
}

// ─── Process list ─────────────────────────────────────────────────────────────

json processes_impl(int max_results) {
    // Grow the PID buffer until it's large enough.
    std::vector<DWORD> pids(256);
    DWORD bytes_returned = 0;
    while (true) {
        if (!EnumProcesses(pids.data(), (DWORD)(pids.size() * sizeof(DWORD)), &bytes_returned))
            return json::array();
        if (bytes_returned < (DWORD)(pids.size() * sizeof(DWORD))) break;
        pids.resize(pids.size() * 2);
    }
    DWORD count = bytes_returned / sizeof(DWORD);

    json results = json::array();
    for (DWORD i = 0; i < count && (int)results.size() < max_results; ++i) {
        DWORD pid = pids[i];
        if (pid == 0) continue;

        HANDLE h = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, pid);
        if (!h) continue;

        // Name
        wchar_t path[MAX_PATH] = {};
        DWORD sz = MAX_PATH;
        std::string name;
        if (QueryFullProcessImageNameW(h, 0, path, &sz)) {
            std::wstring ws(path, sz);
            auto pos = ws.rfind(L'\\');
            if (pos != std::wstring::npos) ws = ws.substr(pos + 1);
            name = to_utf8(ws.data(), (int)ws.size());
        }

        // Working set (resident memory)
        PROCESS_MEMORY_COUNTERS_EX pmc{};
        pmc.cb = sizeof(pmc);
        uint64_t mem_bytes = 0;
        if (GetProcessMemoryInfo(h, (PROCESS_MEMORY_COUNTERS*)&pmc, sizeof(pmc)))
            mem_bytes = pmc.WorkingSetSize;

        CloseHandle(h);

        if (!name.empty()) {
            results.push_back({
                {"pid",       (int)pid},
                {"name",      name},
                {"mem_bytes", mem_bytes},
            });
        }
    }
    return results;
}

// ─── CPU baseline init ────────────────────────────────────────────────────────

// Called once at static-init time to seed the delta baseline, matching
// Go's init() in windows.go that seeds lastIdleTime/lastKernelTime/lastUserTime.
const bool _cpu_init = []() -> bool {
    FILETIME idle_ft, kernel_ft, user_ft;
    if (GetSystemTimes(&idle_ft, &kernel_ft, &user_ft)) {
        s_last_idle   = (LONGLONG)idle_ft.dwHighDateTime   << 32 | (LONGLONG)idle_ft.dwLowDateTime;
        s_last_kernel = (LONGLONG)kernel_ft.dwHighDateTime << 32 | (LONGLONG)kernel_ft.dwLowDateTime;
        s_last_user   = (LONGLONG)user_ft.dwHighDateTime   << 32 | (LONGLONG)user_ft.dwLowDateTime;
    }
    return true;
}();

} // namespace

// ─── IPC dispatch ─────────────────────────────────────────────────────────────

bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    if (type == "sysinfo.ports") {
        reply({{"ports", ports_impl()}});
        return true;
    }
    if (type == "sysinfo.ports.kill") {
        int port = 0;
        if (msg.contains("port")) {
            const auto& pv = msg["port"];
            if (pv.is_string())      port = std::atoi(pv.get<std::string>().c_str());
            else if (pv.is_number()) port = pv.get<int>();
        }
        reply({{"result", kill_port_impl((uint16_t)port)}});
        return true;
    }
    if (type == "sysinfo.perf") {
        reply({{"perf", perf_impl()}});
        return true;
    }
    if (type == "sysinfo.processes") {
        int max = msg.value("maxResults", 200);
        reply({{"processes", processes_impl(max)}});
        return true;
    }
    return false;
}

#else // not _WIN32

// ── Unix stub implementations (Phase K.3 adds full macOS/Linux implementations) ─
bool dispatch(const std::string& type, const json& msg,
              const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };
    if (type == "sysinfo.ports")     { reply({{"ports", json::array()}}); return true; }
    if (type == "sysinfo.ports.kill"){ reply({{"result", "not supported on this platform"}}); return true; }
    if (type == "sysinfo.perf")      { reply({{"perf",  json::object()}}); return true; }
    if (type == "sysinfo.processes") { reply({{"processes", json::array()}}); return true; }
    return false;
}

#endif // _WIN32

} // namespace sysinfo_ops
