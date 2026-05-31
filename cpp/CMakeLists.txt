cmake_minimum_required(VERSION 3.26)
project(cmdide-backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# On Windows: statically link the MSVC runtime so exes have zero DLL dependencies.
# This matches the old Wails build which was a single truly standalone exe.
if(WIN32)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

find_package(nlohmann_json CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(httplib CONFIG REQUIRED)
find_package(cmark CONFIG REQUIRED)
find_package(unofficial-sqlite3 CONFIG REQUIRED)
find_package(libzip CONFIG REQUIRED)

# ── Backend static library (shared by cmdide-backend.exe and cmdide-host) ──────
add_library(cmdide-backend-lib STATIC
    src/terminal.cpp
    src/fileops.cpp
    src/config.cpp
    src/search.cpp
    src/sysinfo.cpp
    src/preview.cpp
    src/session.cpp
    src/pack.cpp
    src/updater.cpp
)

target_include_directories(cmdide-backend-lib PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
)

target_link_libraries(cmdide-backend-lib PUBLIC
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    httplib::httplib
    cmark::cmark
    unofficial::sqlite3::sqlite3
    libzip::zip
)

if(WIN32)
    target_link_libraries(cmdide-backend-lib PUBLIC
        iphlpapi   # GetExtendedTcpTable, GetExtendedUdpTable
        psapi      # EnumProcesses, GetProcessMemoryInfo
    )
endif()

if(UNIX AND NOT APPLE)
    # OpenSSL is needed by cpp-httplib on Linux
    find_package(OpenSSL REQUIRED)
    target_link_libraries(cmdide-backend-lib PUBLIC
        OpenSSL::SSL OpenSSL::Crypto util)
endif()

if(WIN32)
    target_compile_definitions(cmdide-backend-lib PUBLIC
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        _UNICODE
        UNICODE
    )
endif()

# ── WebView host and installer ─────────────────────────────────────────────────
add_subdirectory(host)
add_subdirectory(installer)
