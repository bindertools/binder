#include "port_forward.hpp"
#include "config.hpp"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <map>
#include <memory>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#endif

using json = nlohmann::json;

namespace port_forward {

#ifdef _WIN32
namespace {

// ── Winsock lifecycle ───────────────────────────────────────────────────────

void ensure_winsock() {
    static std::once_flag once;
    std::call_once(once, [] {
        WSADATA wsa;
        WSAStartup(MAKEWORD(2, 2), &wsa);
    });
}

std::string new_id() {
    static std::mt19937_64 rng{std::random_device{}()};
    auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                   std::chrono::system_clock::now().time_since_epoch())
                   .count();
    return "pf_" + std::to_string(now) + "_" + std::to_string(rng() & 0xffffff);
}

// ── Rule + runtime state ─────────────────────────────────────────────────────

struct ForwardRule {
    std::string id;
    std::string name;
    std::string protocol;     // "tcp" | "udp" | "both"
    int         listen_port  = 0;
    std::string target_host;
    int         target_port  = 0;
    bool        enabled      = true;
};

ForwardRule rule_from_json(const json& j) {
    ForwardRule r;
    r.id          = j.value("id", std::string{});
    r.name        = j.value("name", std::string{});
    r.protocol    = j.value("protocol", std::string{"tcp"});
    r.listen_port = j.value("listen_port", 0);
    r.target_host = j.value("target_host", std::string{"127.0.0.1"});
    r.target_port = j.value("target_port", 0);
    r.enabled     = j.value("enabled", true);
    return r;
}

json rule_to_json(const ForwardRule& r) {
    return {
        {"id", r.id}, {"name", r.name}, {"protocol", r.protocol},
        {"listen_port", r.listen_port}, {"target_host", r.target_host},
        {"target_port", r.target_port}, {"enabled", r.enabled},
    };
}

struct RunningRelay {
    std::thread       tcp_thread;
    std::thread       udp_thread;
    std::atomic<bool> stop_flag{false};
    SOCKET            tcp_listen_sock = INVALID_SOCKET;
    SOCKET            udp_sock        = INVALID_SOCKET;
    std::atomic<bool> running{false};
    std::string       last_error;
};

// ── TCP relay ─────────────────────────────────────────────────────────────────

void pump(SOCKET from, SOCKET to) {
    char buf[16 * 1024];
    for (;;) {
        int n = recv(from, buf, sizeof(buf), 0);
        if (n <= 0) break;
        int sent = 0;
        while (sent < n) {
            int s = send(to, buf + sent, n - sent, 0);
            if (s <= 0) return;
            sent += s;
        }
    }
    shutdown(to, SD_SEND);
}

void handle_tcp_connection(SOCKET client, std::string target_host, int target_port) {
    addrinfo hints{};
    hints.ai_family   = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res = nullptr;
    std::string port_str = std::to_string(target_port);
    if (getaddrinfo(target_host.c_str(), port_str.c_str(), &hints, &res) != 0 || !res) {
        closesocket(client);
        return;
    }
    SOCKET target = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    bool connected = target != INVALID_SOCKET &&
                      connect(target, res->ai_addr, (int)res->ai_addrlen) == 0;
    freeaddrinfo(res);

    if (!connected) {
        if (target != INVALID_SOCKET) closesocket(target);
        closesocket(client);
        return;
    }

    std::thread t1(pump, client, target);
    pump(target, client);
    t1.join();

    closesocket(client);
    closesocket(target);
}

void tcp_accept_loop(RunningRelay* relay, std::string target_host, int target_port) {
    for (;;) {
        SOCKET client = accept(relay->tcp_listen_sock, nullptr, nullptr);
        if (client == INVALID_SOCKET) break; // listener closed -> stop requested
        std::thread(handle_tcp_connection, client, target_host, target_port).detach();
    }
}

bool start_tcp(RunningRelay* relay, int listen_port, std::string target_host, int target_port,
               std::string& err) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) { err = "socket() failed"; return false; }

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_port        = htons((u_short)listen_port);
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");

    if (bind(s, (sockaddr*)&addr, sizeof(addr)) != 0) {
        err = "bind failed on port " + std::to_string(listen_port) + " (in use?)";
        closesocket(s);
        return false;
    }
    if (listen(s, SOMAXCONN) != 0) {
        err = "listen() failed";
        closesocket(s);
        return false;
    }

    relay->tcp_listen_sock = s;
    relay->tcp_thread = std::thread(tcp_accept_loop, relay, target_host, target_port);
    return true;
}

// ── UDP relay ─────────────────────────────────────────────────────────────────
// Connectionless: track one upstream socket per distinct client address so
// replies from the target can be routed back to the right client.

void udp_reply_pump(SOCKET listen_sock, SOCKET upstream, sockaddr_in client_addr) {
    char buf[16 * 1024];
    for (;;) {
        int n = recv(upstream, buf, sizeof(buf), 0);
        if (n <= 0) break;
        sendto(listen_sock, buf, n, 0, (sockaddr*)&client_addr, sizeof(client_addr));
    }
    closesocket(upstream);
}

void udp_relay_loop(RunningRelay* relay, std::string target_host, int target_port) {
    std::mutex clients_mu;
    std::map<std::string, SOCKET> clients; // "ip:port" -> upstream socket connected to target
    std::vector<std::thread> reply_threads;

    addrinfo hints{};
    hints.ai_family   = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;
    addrinfo* res = nullptr;
    std::string port_str = std::to_string(target_port);
    bool resolved = getaddrinfo(target_host.c_str(), port_str.c_str(), &hints, &res) == 0 && res;

    char buf[16 * 1024];
    for (;;) {
        sockaddr_in from{};
        int from_len = sizeof(from);
        int n = recvfrom(relay->udp_sock, buf, sizeof(buf), 0, (sockaddr*)&from, &from_len);
        if (n <= 0) break; // socket closed -> stop requested
        if (!resolved) continue;

        char ipbuf[64];
        inet_ntop(AF_INET, &from.sin_addr, ipbuf, sizeof(ipbuf));
        std::string key = std::string(ipbuf) + ":" + std::to_string(ntohs(from.sin_port));

        SOCKET upstream = INVALID_SOCKET;
        {
            std::lock_guard<std::mutex> lk(clients_mu);
            auto it = clients.find(key);
            if (it != clients.end()) {
                upstream = it->second;
            } else {
                SOCKET u = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
                if (u != INVALID_SOCKET && connect(u, res->ai_addr, (int)res->ai_addrlen) == 0) {
                    clients[key] = u;
                    upstream = u;
                    reply_threads.emplace_back(udp_reply_pump, relay->udp_sock, u, from);
                } else if (u != INVALID_SOCKET) {
                    closesocket(u);
                }
            }
        }
        if (upstream != INVALID_SOCKET) send(upstream, buf, n, 0);
    }

    if (resolved) freeaddrinfo(res);
    for (auto& t : reply_threads) if (t.joinable()) t.join();
}

bool start_udp(RunningRelay* relay, int listen_port, std::string target_host, int target_port,
               std::string& err) {
    SOCKET s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) { err = "socket() failed"; return false; }

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_port        = htons((u_short)listen_port);
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");

    if (bind(s, (sockaddr*)&addr, sizeof(addr)) != 0) {
        err = "bind failed on port " + std::to_string(listen_port) + " (in use?)";
        closesocket(s);
        return false;
    }

    relay->udp_sock = s;
    relay->udp_thread = std::thread(udp_relay_loop, relay, target_host, target_port);
    return true;
}

// ── Manager ───────────────────────────────────────────────────────────────────

class Manager {
public:
    static Manager& instance() {
        static Manager m;
        return m;
    }

    json list() {
        std::lock_guard<std::mutex> lk(mu_);
        json arr = json::array();
        for (auto& r : rules_) {
            json j = rule_to_json(r);
            auto it = active_.find(r.id);
            if (it != active_.end() && it->second->running.load()) {
                j["status"] = "running";
            } else if (it != active_.end() && !it->second->last_error.empty()) {
                j["status"] = "error";
                j["error"]  = it->second->last_error;
            } else {
                j["status"] = "stopped";
            }
            arr.push_back(std::move(j));
        }
        return arr;
    }

    json add(const json& body) {
        ensure_winsock();
        ForwardRule r = rule_from_json(body);
        r.id = new_id();

        std::lock_guard<std::mutex> lk(mu_);
        rules_.push_back(r);
        persist_locked();
        if (r.enabled) start_locked(r);
        return rule_status_locked(r.id);
    }

    bool remove(const std::string& id) {
        std::lock_guard<std::mutex> lk(mu_);
        stop_locked(id);
        active_.erase(id);
        auto before = rules_.size();
        rules_.erase(std::remove_if(rules_.begin(), rules_.end(),
                                     [&](const ForwardRule& r) { return r.id == id; }),
                     rules_.end());
        persist_locked();
        return rules_.size() != before;
    }

    json toggle(const std::string& id, bool enabled) {
        ensure_winsock();
        std::lock_guard<std::mutex> lk(mu_);
        for (auto& r : rules_) {
            if (r.id != id) continue;
            r.enabled = enabled;
            persist_locked();
            if (enabled) start_locked(r);
            else stop_locked(id);
            return rule_status_locked(id);
        }
        return json::object();
    }

    void load_and_start() {
        ensure_winsock();
        std::lock_guard<std::mutex> lk(mu_);
        rules_.clear();
        auto stored = Config::instance().get().value("portForwards", json::array());
        if (stored.is_array()) {
            for (auto& j : stored) rules_.push_back(rule_from_json(j));
        }
        for (auto& r : rules_) if (r.enabled) start_locked(r);
    }

    void stop_all() {
        std::lock_guard<std::mutex> lk(mu_);
        for (auto& kv : active_) stop_relay(kv.second.get());
        active_.clear();
    }

private:
    std::mutex mu_;
    std::vector<ForwardRule> rules_;
    std::map<std::string, std::unique_ptr<RunningRelay>> active_;

    void persist_locked() {
        json arr = json::array();
        for (auto& r : rules_) arr.push_back(rule_to_json(r));
        Config::instance().set("portForwards", arr);
    }

    json rule_status_locked(const std::string& id) {
        for (auto& r : rules_) {
            if (r.id != id) continue;
            json j = rule_to_json(r);
            auto it = active_.find(id);
            if (it != active_.end() && it->second->running.load()) j["status"] = "running";
            else if (it != active_.end() && !it->second->last_error.empty()) {
                j["status"] = "error"; j["error"] = it->second->last_error;
            } else j["status"] = "stopped";
            return j;
        }
        return json::object();
    }

    // Caller must hold mu_.
    void start_locked(const ForwardRule& r) {
        stop_locked(r.id); // replace any existing relay for this id

        auto relay = std::make_unique<RunningRelay>();
        std::string err;
        bool any_ok = false;

        if (r.protocol == "tcp" || r.protocol == "both") {
            if (start_tcp(relay.get(), r.listen_port, r.target_host, r.target_port, err))
                any_ok = true;
        }
        if (err.empty() && (r.protocol == "udp" || r.protocol == "both")) {
            std::string udp_err;
            if (start_udp(relay.get(), r.listen_port, r.target_host, r.target_port, udp_err))
                any_ok = true;
            else if (err.empty())
                err = udp_err;
        }

        relay->running    = any_ok;
        relay->last_error = any_ok ? std::string{} : err;
        if (!any_ok) spdlog::warn("[port_forward] failed to start rule {}: {}", r.id, err);
        active_[r.id] = std::move(relay);
    }

    static void stop_relay(RunningRelay* relay) {
        relay->stop_flag = true;
        if (relay->tcp_listen_sock != INVALID_SOCKET) {
            closesocket(relay->tcp_listen_sock);
            relay->tcp_listen_sock = INVALID_SOCKET;
        }
        if (relay->udp_sock != INVALID_SOCKET) {
            closesocket(relay->udp_sock);
            relay->udp_sock = INVALID_SOCKET;
        }
        if (relay->tcp_thread.joinable()) relay->tcp_thread.join();
        if (relay->udp_thread.joinable()) relay->udp_thread.join();
        relay->running = false;
    }

    // Caller must hold mu_.
    void stop_locked(const std::string& id) {
        auto it = active_.find(id);
        if (it == active_.end()) return;
        stop_relay(it->second.get());
        active_.erase(it);
    }
};

} // namespace

// ── IPC dispatch ─────────────────────────────────────────────────────────────

bool dispatch(const std::string& type, const json& msg, const std::string& id, json& resp) {
    auto reply = [&](json body) {
        body["type"] = type + ".resp";
        body["id"]   = id;
        resp = std::move(body);
    };

    if (type == "portforward.list") {
        reply({{"forwards", Manager::instance().list()}});
        return true;
    }
    if (type == "portforward.add") {
        auto body = msg.contains("forward") ? msg["forward"] : msg;
        reply({{"forward", Manager::instance().add(body)}});
        return true;
    }
    if (type == "portforward.remove") {
        reply({{"ok", Manager::instance().remove(msg.value("id", std::string{}))}});
        return true;
    }
    if (type == "portforward.toggle") {
        auto forward = Manager::instance().toggle(msg.value("id", std::string{}),
                                                    msg.value("enabled", true));
        reply({{"forward", forward}});
        return true;
    }
    return false;
}

void start_persisted() { Manager::instance().load_and_start(); }
void stop_all() { Manager::instance().stop_all(); }

#else // !_WIN32

bool dispatch(const std::string& type, const json& /*msg*/, const std::string& id, json& resp) {
    if (type == "portforward.list" || type == "portforward.add" ||
        type == "portforward.remove" || type == "portforward.toggle") {
        resp = {{"type", type + ".resp"}, {"id", id}, {"ok", false},
                {"error", "port forwarding is not supported on this platform"}};
        return true;
    }
    return false;
}

void start_persisted() {}
void stop_all() {}

#endif

} // namespace port_forward
