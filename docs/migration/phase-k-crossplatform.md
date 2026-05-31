# Phase K — Cross-Platform Backend

## Overview

The C++ backend was written Windows-first (ConPTY, WinHTTP, GetExtendedTcpTable). Phase K adds
platform-conditional code to make it compile and run on macOS and Linux. No behaviour changes
on Windows — only new `#ifdef` branches for Unix platforms.

---

## Git Workflow

**Branch:** `feat/webview-migration` (already created)

Commit after each prompt. Push after this phase: `git push`

---

## Prompt K.1 — Cross-Platform Terminal (forkpty)

```
Context: terminal-IDE. cpp/src/terminal.hpp/cpp implements a ConPTY terminal for Windows.
On macOS and Linux there is no ConPTY — we use forkpty() (POSIX) and execvp() to spawn a
shell in a pseudo-terminal.

Task: Add a Unix forkpty terminal implementation behind #ifdef guards.

Read before coding:
  - cpp/src/terminal.hpp (full Terminal class API)
  - cpp/src/terminal.cpp (full Windows ConPTY implementation)

Requirements:

1. cpp/src/terminal.hpp
   No API changes — the Terminal class interface stays identical.
   The header must compile on all platforms (no Windows.h in the header).
   Move Windows-specific types to the .cpp file using forward declarations or
   platform-specific private members via a pimpl pattern or #ifdef in the .cpp.

2. cpp/src/terminal.cpp — add Unix path
   Wrap the existing Windows implementation in #ifdef _WIN32.
   Add a new #else block for macOS/Linux:

   #include <pty.h>        // forkpty — on macOS: #include <util.h>
   #include <unistd.h>     // execvp, environ
   #include <sys/wait.h>   // waitpid
   #include <termios.h>    // struct termios, tcgetattr, tcsetattr
   #include <sys/ioctl.h>  // TIOCSWINSZ

   Unix terminal implementation:
     Start():
       Build env: copy environ, inject live PATH:
         On macOS: read /etc/paths and /etc/paths.d/* to get system paths
         On Linux: PATH is typically already set correctly in the process environment
         Merge with current $PATH, deduplicate
       Determine shell: use $SHELL environment variable; fall back to /bin/bash or /bin/sh
       Call forkpty(&master_fd_, &slave_fd_, nullptr, nullptr, &winsize):
         winsize.ws_col = cols, winsize.ws_row = rows
       In child process (pid == 0):
         execvp(shell, {shell, nullptr}) — execute the shell
       In parent process:
         Store pid_, master_fd_
         Start a reader thread: read() from master_fd_ in a loop, call output_callback_
         Reader thread exits when read() returns 0 or -1 (child exited)

     Write():
       write(master_fd_, data.data(), data.size())

     Resize():
       struct winsize ws{};
       ws.ws_col = cols; ws.ws_row = rows;
       ioctl(master_fd_, TIOCSWINSZ, &ws)

     Stop():
       kill(pid_, SIGTERM); waitpid(pid_, nullptr, 0); close(master_fd_)

     IsRunning():
       waitpid(pid_, nullptr, WNOHANG) == 0

3. cpp/CMakeLists.txt — platform-conditional linking
   Windows: iphlpapi, psapi, winhttp (already there)
   macOS:   no extra libs needed for terminal (util is in libc)
   Linux:   -lutil for forkpty (if not in glibc directly)

   if(APPLE)
     # macOS-specific libs
   elseif(UNIX)
     target_link_libraries(cmdide-backend-lib PRIVATE util)
   endif()

4. Initial PATH environment on macOS
   macOS GUI apps (launched from Finder/.app) do NOT inherit the shell's $PATH.
   Before execvp, build PATH by reading:
     /etc/paths         (one path per line, system paths)
     /etc/paths.d/*     (additional paths from packages)
     /etc/profile       (skip — shell-specific)
   Then prepend $HOME/.local/bin and common tool locations:
     /opt/homebrew/bin (Apple Silicon homebrew)
     /usr/local/bin    (Intel homebrew)
     /usr/bin /bin /usr/sbin /sbin
   Merge with any existing $PATH value. Set PATH= in the child environment.
   This mirrors what app/envpath_windows.go does for Windows.

Verification:
  - On Windows: existing ConPTY terminal continues to work (no regression).
  - On macOS: spawn cmdide-host.exe (built for macOS), open a terminal, type ls, see output.
  - On Linux: same test.
  - Resize: resize the terminal pane, confirm the shell responds correctly (no garbled output).
  - macOS PATH: confirm brew tools (e.g., git) are found without launching from terminal.

Git commits — commit after each of the following milestones:
  1. terminal.cpp compiles on all 3 platforms (even if Unix path is stub):
       git commit -m "feat(terminal): add Unix forkpty terminal skeleton — compiles on macOS and Linux"
  2. forkpty implementation working on macOS and/or Linux:
       git commit -m "feat(terminal): forkpty terminal working on Unix — shell spawns and outputs"
  3. macOS PATH injection from /etc/paths:
       git commit -m "feat(terminal): inject /etc/paths into child environment on macOS"
  4. git push:
       git push
```

### Effects
- `cpp/src/terminal.hpp`: no API changes, header made platform-neutral
- `cpp/src/terminal.cpp`: `#ifdef _WIN32` ConPTY path + `#else` forkpty path
- `cpp/CMakeLists.txt`: `util` linked on Linux

---

## Prompt K.2 — Cross-Platform Config Paths

```
Context: terminal-IDE. cpp/src/config.cpp uses %APPDATA% (Windows) for the config directory.
On macOS the convention is ~/Library/Application Support/<app>; on Linux it is
$XDG_CONFIG_HOME/<app> (defaulting to ~/.config/<app>).

Task: Make config.cpp return the correct platform-specific config directory.

Read before coding:
  - cpp/src/config.hpp (public API)
  - cpp/src/config.cpp (full implementation — understand all file paths used)

Requirements:

1. cpp/src/config.cpp — platform-conditional config root

   Replace the Windows-only %APPDATA% call with a cross-platform helper:

   static std::filesystem::path GetConfigRoot() {
   #ifdef _WIN32
     wchar_t* appdata = nullptr;
     SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &appdata);
     std::filesystem::path root = std::filesystem::path(appdata) / "cmdIDE";
     CoTaskMemFree(appdata);
     return root;
   #elif __APPLE__
     const char* home = getenv("HOME");
     return std::filesystem::path(home) / "Library" / "Application Support" / "cmdIDE";
   #else  // Linux and other Unix
     const char* xdg = getenv("XDG_CONFIG_HOME");
     if (xdg && *xdg) {
       return std::filesystem::path(xdg) / "cmdide";
     }
     const char* home = getenv("HOME");
     return std::filesystem::path(home) / ".config" / "cmdide";
   #endif
   }

   NOTE: The app name uses "cmdIDE" on Windows/macOS (matching existing user data) and
   "cmdide" (lowercase) on Linux (Unix convention).

2. cpp/src/config.cpp — data directory (separate from config)
   Some data (session DB, logs) belongs in the data directory, not config:
   #ifdef _WIN32:   %LOCALAPPDATA%\cmdIDE\
   macOS:           ~/Library/Application Support/cmdIDE/  (same as config on macOS)
   Linux:           $XDG_DATA_HOME/cmdide or ~/.local/share/cmdide

   Add static std::filesystem::path GetDataRoot() with the same #ifdef pattern.

3. cpp/src/fileops.cpp — path separator
   std::filesystem handles path separators automatically.
   Verify there are no hardcoded backslashes in fileops.cpp. Replace any with
   std::filesystem::path / operator or forward slashes (which std::filesystem normalises).

4. cpp/CMakeLists.txt
   Windows: link shlwapi.lib (for SHGetKnownFolderPath — already linked via SHELL32 usually;
   add explicitly if needed).
   No extra libs needed on macOS/Linux.

Verification:
  - On Windows: config reads/writes to %APPDATA%\cmdIDE\ as before.
  - On macOS: config reads/writes to ~/Library/Application Support/cmdIDE/.
  - On Linux: config reads/writes to ~/.config/cmdide/ (or $XDG_CONFIG_HOME/cmdide/).
  - Session DB lands in the data directory, not config directory.

Git commits — commit after each of the following milestones:
  1. Config root platform-conditional — compiles on all platforms:
       git commit -m "feat(config): cross-platform config paths — APPDATA / Library / .config"
  2. Data root added; fileops path separators verified:
       git commit -m "feat(config): add cross-platform data root; ensure portable path separators"
  3. git push:
       git push
```

### Effects
- `cpp/src/config.cpp`: `#ifdef` platform-conditional `GetConfigRoot()` and `GetDataRoot()`
- `cpp/src/fileops.cpp`: any hardcoded backslashes replaced

---

## Prompt K.3 — Cross-Platform Sysinfo

```
Context: terminal-IDE. cpp/src/sysinfo.cpp uses Windows-only APIs:
  Ports: GetExtendedTcpTable (iphlpapi.h)
  Perf:  GlobalMemoryStatusEx, GetSystemInfo, PdhOpenQuery (pdh.h)
  GPU:   IDXGIAdapter VRAM query
On macOS and Linux we need alternative implementations.

Task: Add platform-conditional sysinfo implementations for macOS and Linux.

Read before coding:
  - cpp/src/sysinfo.hpp (public API — all types used)
  - cpp/src/sysinfo.cpp (full Windows implementation)

Requirements:

1. Ports enumeration

   Windows: existing GetExtendedTcpTable path (unchanged).

   macOS: parse `netstat -an -p tcp` output:
     Run: popen("netstat -an -p tcp 2>/dev/null", "r")
     Parse lines matching: "tcp4  0  0  *.PORT  *.*  LISTEN"
     Extract port numbers from local address column.

   Linux: read /proc/net/tcp (IPv4) and /proc/net/tcp6 (IPv6):
     Each line has: sl local_address rem_address st ...
     local_address is hex-encoded: address:port in big-endian hex
     Filter for state == 0x0A (LISTEN)
     Convert hex port to decimal

   Both Unix implementations should return the same PortInfo struct as Windows.

2. Memory and CPU performance

   Windows: existing GlobalMemoryStatusEx + PDH path (unchanged).

   macOS:
     Memory: sysctl("hw.memsize") for total; vm_stat for used/free pages.
       kern.memorystatus_level gives a 0–100 pressure level.
       Alternatively: host_statistics64(mach_host_self(), HOST_VM_INFO64, ...)
     CPU: host_processor_info() for per-core usage; compare two samples 500ms apart.
     Disk: statfs("/") for disk usage.
     Network: sysctl("net.route.0.0.flags") or parse /proc/net/dev (Linux only).

   Linux:
     Memory: parse /proc/meminfo for MemTotal, MemAvailable, Cached, etc.
     CPU: parse /proc/stat twice 500ms apart; compute usage from user+nice+system / total ticks.
     Disk: statvfs("/") for disk usage.
     Network: parse /proc/net/dev for rx/tx bytes; two samples 500ms apart for rate.

   For macOS and Linux, the GPU query is not required. Return an empty GPU entry or
   a "GPU: N/A" entry — the frontend should handle missing GPU data gracefully.

3. Process list (for perf)
   Windows: existing EnumProcesses + OpenProcess path (unchanged).
   macOS: use sysctl(KERN_PROC_ALL) or popen("ps -axo pid,pcpu,pmem,comm").
   Linux: iterate /proc/*/stat and /proc/*/comm.

4. Compile-time guards
   Wrap all Windows API headers in #ifdef _WIN32.
   Add the appropriate Unix headers under #elif __APPLE__ and #else.
   The sysinfo.hpp public interface must not include any platform-specific headers.

5. Stub policy
   For any metric that is genuinely hard to implement on a platform, return a sensible
   stub value (0 or "N/A") rather than failing. Log a debug warning. The app must not
   crash because a sysinfo metric is unavailable.

Git commits — commit after each of the following milestones:
  1. sysinfo.cpp compiles on all 3 platforms (may have stub implementations):
       git commit -m "feat(sysinfo): cross-platform guards — compiles on macOS and Linux"
  2. Ports working on macOS/Linux (netstat parser or /proc/net/tcp):
       git commit -m "feat(sysinfo): Unix port enumeration — netstat parser and /proc/net/tcp"
  3. CPU/memory perf working on macOS/Linux:
       git commit -m "feat(sysinfo): Unix perf metrics — CPU and memory via sysctl and /proc"
  4. git push:
       git push
```

### Effects
- `cpp/src/sysinfo.cpp`: platform-conditional ports, memory, CPU implementations
- `cpp/CMakeLists.txt`: remove Windows-only `iphlpapi`, `psapi` from non-Windows targets

---

## Prompt K.4 — Cross-Platform Updater

```
Context: terminal-IDE. cpp/src/updater.cpp uses WinHTTP for HTTPS requests to the GitHub
releases API. WinHTTP is Windows-only. The cpp-httplib library (already a vcpkg dependency)
provides cross-platform HTTPS via OpenSSL.

Task: Replace WinHTTP with cpp-httplib in updater.cpp for cross-platform HTTP.

Read before coding:
  - cpp/src/updater.hpp (public API)
  - cpp/src/updater.cpp (full WinHTTP implementation)
  - cpp/vcpkg.json (cpp-httplib is already listed — confirm it's there)

Requirements:

1. cpp/src/updater.cpp — replace WinHTTP with cpp-httplib

   Remove all WinHTTP headers and calls (WinHttpOpen, WinHttpConnect, WinHttpOpenRequest,
   WinHttpSendRequest, WinHttpReceiveResponse, WinHttpReadData, etc.).

   Add:
     #define CPPHTTPLIB_OPENSSL_SUPPORT
     #include <httplib.h>

   GitHub API call (check for updates):
     httplib::SSLClient cli("api.github.com");
     cli.set_follow_location(true);
     cli.set_ca_cert_path(GetCACertPath());  // platform-specific CA bundle path
     auto res = cli.Get("/repos/USER/REPO/releases");
     if (res && res->status == 200) { /* parse res->body */ }

   GitHub release download (download binary):
     Parse the download URL from the release JSON.
     Use httplib::SSLClient with the appropriate host.
     Stream the response to a file, emitting progress events via the Dispatcher's emit().

   CA certificate bundle path (GetCACertPath()):
     Windows:  "" (empty) — cpp-httplib uses the Windows certificate store automatically
               when compiled with CPPHTTPLIB_USE_CERTS_FROM_STORE
     macOS:    "" — use system keychain (cpp-httplib handles this on Apple platforms)
     Linux:    "/etc/ssl/certs/ca-certificates.crt" (Debian/Ubuntu)
               or "/etc/pki/tls/certs/ca-bundle.crt" (RHEL/Fedora)
               or check both paths, use whichever exists

2. Post-download launch (cross-platform)

   Windows: ShellExecuteW(nullptr, L"open", exe_path.c_str(), nullptr, nullptr, SW_SHOW)
            (existing behaviour)

   macOS:   Use system("open '" + dmg_path + "'") or
            use posix_spawn/execlp("open", "open", path.c_str(), nullptr)

   Linux:   Use system("xdg-open '" + path + "' &") or
            use posix_spawn with xdg-open

   Add a cross-platform helper:
     void OpenFileWithSystem(const std::string& path) {
     #ifdef _WIN32
       ShellExecuteW(...)
     #elif __APPLE__
       // open command
     #else
       // xdg-open
     #endif
     }

3. vcpkg.json
   Ensure cpp-httplib has the openssl feature enabled:
     { "name": "cpp-httplib", "features": ["openssl"] }
   Add openssl to dependencies if not already present.

4. CMakeLists.txt
   On Linux, link against libssl and libcrypto (OpenSSL):
     find_package(OpenSSL REQUIRED)
     target_link_libraries(cmdide-backend-lib PRIVATE OpenSSL::SSL OpenSSL::Crypto)
   On Windows and macOS, cpp-httplib uses platform TLS — no extra linking needed.

5. User-Agent header
   The existing Windows code sets a User-Agent. Preserve it in cpp-httplib:
     cli.set_default_headers({{"User-Agent", "cmdIDE-updater/" + version}});

Verification:
  - On Windows: update check calls GitHub API and returns a result (WinHTTP removed).
  - On macOS: same.
  - On Linux: same (requires OpenSSL; test in a Docker container if no Linux machine).
  - Download test: simulate a download URL and verify progress events fire correctly.

Git commits — commit after each of the following milestones:
  1. WinHTTP removed; cpp-httplib compiles on all platforms:
       git commit -m "feat(updater): replace WinHTTP with cpp-httplib — cross-platform HTTPS"
  2. CA cert path handled per platform; update check works on macOS/Linux:
       git commit -m "feat(updater): cross-platform CA cert path — update check works on Unix"
  3. Cross-platform post-download launch (open/xdg-open):
       git commit -m "feat(updater): cross-platform post-download launch via open/xdg-open"
  4. git push:
       git push
```

### Effects
- `cpp/src/updater.cpp`: WinHTTP replaced with cpp-httplib; `OpenFileWithSystem()` added
- `cpp/vcpkg.json`: cpp-httplib `openssl` feature enabled
- `cpp/CMakeLists.txt`: OpenSSL linked on Linux

---

## Phase K Checklist

- [ ] `cmake -B cpp/build -S cpp` succeeds on Windows, macOS, and Linux
- [ ] `cmake --build` succeeds on all 3 platforms
- [ ] Terminal opens a shell on macOS (forkpty), outputs correctly, supports resize
- [ ] Terminal opens a shell on Linux (forkpty), outputs correctly, supports resize
- [ ] Config files land in the correct OS-standard location on each platform
- [ ] Ports panel shows open ports on macOS (netstat) and Linux (/proc/net/tcp)
- [ ] Perf panel shows CPU and memory on macOS and Linux
- [ ] Update check calls GitHub API on all 3 platforms (no WinHTTP anywhere)
- [ ] `git log --oneline` shows one commit per feature area
- [ ] Branch pushed: `git push`
