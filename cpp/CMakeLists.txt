cmake_minimum_required(VERSION 3.26)
project(cmdide-backend LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# On Windows: statically link the MSVC runtime so exes have zero DLL dependencies.
# This matches the old Wails build which was a single truly standalone exe.
if(WIN32)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

find_package(nlohmann_json CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)

# CMake 4.x changed FindOpenSSL search logic; httplib's config calls find_dependency(OpenSSL)
# and can no longer locate it in the vcpkg tree without an explicit root hint.
if(WIN32 AND DEFINED _VCPKG_INSTALLED_DIR AND DEFINED VCPKG_TARGET_TRIPLET)
    set(OPENSSL_ROOT_DIR "${_VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}" CACHE PATH "")
endif()

find_package(httplib CONFIG REQUIRED)
find_package(cmark CONFIG REQUIRED)
find_package(unofficial-sqlite3 CONFIG REQUIRED)
find_package(libzip CONFIG REQUIRED)
find_package(unofficial-tree-sitter CONFIG REQUIRED)

# ── Vendored tree-sitter grammars (parser.c per language, no external deps) ────
add_library(cmdide-grammars STATIC
    third_party/grammars/tree-sitter-json/src/parser.c
    third_party/grammars/tree-sitter-javascript/src/parser.c
    third_party/grammars/tree-sitter-javascript/src/scanner.c
    third_party/grammars/tree-sitter-typescript/typescript/src/parser.c
    third_party/grammars/tree-sitter-typescript/typescript/src/scanner.c
    third_party/grammars/tree-sitter-typescript/tsx/src/parser.c
    third_party/grammars/tree-sitter-typescript/tsx/src/scanner.c
    third_party/grammars/tree-sitter-c/src/parser.c
    third_party/grammars/tree-sitter-cpp/src/parser.c
    third_party/grammars/tree-sitter-cpp/src/scanner.c
    third_party/grammars/tree-sitter-c-sharp/src/parser.c
    third_party/grammars/tree-sitter-c-sharp/src/scanner.c
    third_party/grammars/tree-sitter-rust/src/parser.c
    third_party/grammars/tree-sitter-rust/src/scanner.c
    third_party/grammars/tree-sitter-go/src/parser.c
    third_party/grammars/tree-sitter-java/src/parser.c
    third_party/grammars/tree-sitter-lua/src/parser.c
    third_party/grammars/tree-sitter-lua/src/scanner.c
    third_party/grammars/tree-sitter-python/src/parser.c
    third_party/grammars/tree-sitter-python/src/scanner.c
    third_party/grammars/tree-sitter-bash/src/parser.c
    third_party/grammars/tree-sitter-bash/src/scanner.c
    third_party/grammars/tree-sitter-zig/src/parser.c
)
set_target_properties(cmdide-grammars PROPERTIES LINKER_LANGUAGE C)
target_include_directories(cmdide-grammars PRIVATE
    third_party/grammars/tree-sitter-json/src
    third_party/grammars/tree-sitter-javascript/src
    third_party/grammars/tree-sitter-typescript/typescript/src
    third_party/grammars/tree-sitter-typescript/tsx/src
    third_party/grammars/tree-sitter-c/src
    third_party/grammars/tree-sitter-cpp/src
    third_party/grammars/tree-sitter-c-sharp/src
    third_party/grammars/tree-sitter-rust/src
    third_party/grammars/tree-sitter-go/src
    third_party/grammars/tree-sitter-java/src
    third_party/grammars/tree-sitter-lua/src
    third_party/grammars/tree-sitter-python/src
    third_party/grammars/tree-sitter-bash/src
    third_party/grammars/tree-sitter-zig/src
)

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
    src/git.cpp
    src/workflows.cpp
    src/workflow_yaml.cpp
    src/workflow_expr.cpp
    src/workflow_runner.cpp
    src/process_registry.cpp
    src/editor_buffer.cpp
    src/file_watcher.cpp
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
    unofficial::tree-sitter::tree-sitter
    cmdide-grammars
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

# ── WebView host and setup ─────────────────────────────────────────────────────
add_subdirectory(host)
add_subdirectory(setup)
