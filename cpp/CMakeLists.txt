cmake_minimum_required(VERSION 3.26)
project(cmdide-backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(nlohmann_json CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(httplib CONFIG REQUIRED)
find_package(cmark CONFIG REQUIRED)
find_package(unofficial-sqlite3 CONFIG REQUIRED)
find_package(libzip CONFIG REQUIRED)

add_executable(cmdide-backend
    src/main.cpp
    src/ipc.cpp
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

target_link_libraries(cmdide-backend PRIVATE
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    httplib::httplib
    cmark::cmark
    unofficial::sqlite3::sqlite3
    libzip::zip
    iphlpapi   # GetExtendedTcpTable, GetExtendedUdpTable, GetIfTable
    psapi      # EnumProcesses, GetProcessMemoryInfo, GetModuleFileNameExW
    winhttp    # WinHttpOpen — GitHub API and update downloads
)

if(WIN32)
    target_compile_definitions(cmdide-backend PRIVATE
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        _UNICODE
        UNICODE
    )
endif()
