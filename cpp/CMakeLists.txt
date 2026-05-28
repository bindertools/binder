cmake_minimum_required(VERSION 3.26)
project(cmdide-backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(nlohmann_json CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)

add_executable(cmdide-backend
    src/main.cpp
    src/ipc.cpp
    src/terminal.cpp
    src/fileops.cpp
    src/config.cpp
    src/search.cpp
)

target_link_libraries(cmdide-backend PRIVATE
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    iphlpapi  # for IP helper / port-to-PID lookups (Phase 1.2)
)

if(WIN32)
    target_compile_definitions(cmdide-backend PRIVATE
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        _UNICODE
        UNICODE
    )
endif()
