cmake_minimum_required(VERSION 3.26)
project(binder-backend LANGUAGES C CXX)

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
add_library(binder-grammars STATIC
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
    third_party/grammars/tree-sitter-toml/src/parser.c
    third_party/grammars/tree-sitter-toml/src/scanner.c
    third_party/grammars/tree-sitter-dockerfile/src/parser.c
    third_party/grammars/tree-sitter-dockerfile/src/scanner.c
    third_party/grammars/tree-sitter-yaml/src/parser.c
    third_party/grammars/tree-sitter-yaml/src/scanner.c
    third_party/grammars/tree-sitter-css/src/parser.c
    third_party/grammars/tree-sitter-css/src/scanner.c
    third_party/grammars/tree-sitter-scss/src/parser.c
    third_party/grammars/tree-sitter-scss/src/scanner.c
    third_party/grammars/tree-sitter-markdown/src/parser.c
    third_party/grammars/tree-sitter-markdown/src/scanner.c
    third_party/grammars/tree-sitter-html/src/parser.c
    third_party/grammars/tree-sitter-html/src/scanner.c
)
set_target_properties(binder-grammars PROPERTIES LINKER_LANGUAGE C)
target_include_directories(binder-grammars PRIVATE
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
    third_party/grammars/tree-sitter-toml/src
    third_party/grammars/tree-sitter-dockerfile/src
    third_party/grammars/tree-sitter-yaml/src
    third_party/grammars/tree-sitter-css/src
    third_party/grammars/tree-sitter-scss/src
    third_party/grammars/tree-sitter-markdown/src
    third_party/grammars/tree-sitter-html/src
)

# ── Backend static library (shared by binder-backend.exe and binder-host) ──────
add_library(binder-backend-lib STATIC
    src/terminal.cpp
    src/fileops.cpp
    src/config.cpp
    src/search.cpp
    src/sysinfo.cpp
    src/session.cpp
    src/pack.cpp
    src/updater.cpp
    src/editor_buffer.cpp
    src/file_watcher.cpp
)

target_include_directories(binder-backend-lib PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
)

target_link_libraries(binder-backend-lib PUBLIC
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    httplib::httplib
    unofficial::sqlite3::sqlite3
    libzip::zip
    unofficial::tree-sitter::tree-sitter
    binder-grammars
)

if(WIN32)
    target_link_libraries(binder-backend-lib PUBLIC
        iphlpapi   # GetExtendedTcpTable, GetExtendedUdpTable
        psapi      # EnumProcesses, GetProcessMemoryInfo
    )
endif()

if(UNIX AND NOT APPLE)
    # OpenSSL is needed by cpp-httplib on Linux
    find_package(OpenSSL REQUIRED)
    target_link_libraries(binder-backend-lib PUBLIC
        OpenSSL::SSL OpenSSL::Crypto util)
endif()

if(WIN32)
    target_compile_definitions(binder-backend-lib PUBLIC
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        _UNICODE
        UNICODE
    )
endif()

# ── App backend DLLs ────────────────────────────────────────────────────────────
# Each installable app's native backend is its own DLL, LoadLibrary'd by the
# host only when that app is installed (see cpp/host/app_plugin_loader.cpp) --
# never linked into binder-backend-lib, so an uninstalled app contributes zero
# compiled weight or running state to the host process.
function(add_binder_app target_name)
    cmake_parse_arguments(ARG "" "" "SOURCES;LINK_LIBS" ${ARGN})
    add_library(${target_name} SHARED ${ARG_SOURCES})
    set_target_properties(${target_name} PROPERTIES
        CXX_STANDARD 17
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/Release/apps/${target_name}"
        RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release/apps/${target_name}"
        RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug/apps/${target_name}"
        OUTPUT_NAME "${target_name}"
    )
    target_include_directories(${target_name} PRIVATE src)
    target_link_libraries(${target_name} PRIVATE nlohmann_json::nlohmann_json spdlog::spdlog)
    if(ARG_LINK_LIBS)
        target_link_libraries(${target_name} PRIVATE ${ARG_LINK_LIBS})
    endif()
    if(WIN32)
        target_compile_definitions(${target_name} PRIVATE
            WIN32_LEAN_AND_MEAN NOMINMAX _UNICODE UNICODE)
    endif()
endfunction()

add_binder_app(versioncontrol SOURCES
    src/git.cpp
    apps/versioncontrol/dllmain.cpp
)

add_binder_app(ports SOURCES
    src/port_forward.cpp
    apps/ports/dllmain.cpp
)
if(WIN32)
    target_link_libraries(ports PRIVATE ws2_32)
endif()

add_binder_app(workflows SOURCES
    src/workflows.cpp
    src/workflow_yaml.cpp
    src/workflow_expr.cpp
    src/workflow_runner.cpp
    src/process_registry.cpp
    apps/workflows/dllmain.cpp
)

add_binder_app(livepreview SOURCES
    src/preview.cpp
    apps/livepreview/dllmain.cpp
)
target_link_libraries(livepreview PRIVATE httplib::httplib cmark::cmark)

add_binder_app(database SOURCES
    src/database.cpp
    apps/database/dllmain.cpp
)
target_link_libraries(database PRIVATE unofficial::sqlite3::sqlite3)

# ── WebView host and setup ─────────────────────────────────────────────────────
add_subdirectory(host)
add_subdirectory(setup)
