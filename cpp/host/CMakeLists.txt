# zserge-webview is header-only — locate webview.h via vcpkg's include path
find_path(ZSERGE_WEBVIEW_INCLUDE_DIRS "webview.h" REQUIRED)

if(WIN32)
    find_package(unofficial-webview2 CONFIG REQUIRED)
    add_executable(cmdide-host WIN32 main.cpp dispatch.cpp window_win.cpp
                                       splash_windows.cpp jumplist_windows.cpp
                                       resources.rc)
else()
    add_executable(cmdide-host main.cpp dispatch.cpp)
endif()

set_target_properties(cmdide-host PROPERTIES
    CXX_STANDARD 17
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
)

target_include_directories(cmdide-host PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    ${ZSERGE_WEBVIEW_INCLUDE_DIRS}
)

target_link_libraries(cmdide-host PRIVATE cmdide-backend-lib)

if(WIN32)
    target_compile_definitions(cmdide-host PRIVATE
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        _UNICODE
        UNICODE
    )
    target_link_libraries(cmdide-host PRIVATE
        unofficial::webview2::webview2
        ole32
        oleaut32
        shlwapi
        dwmapi
    )
    # Copy WebView2Loader.dll and other runtime DLLs to the output directory
    add_custom_command(TARGET cmdide-host POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_RUNTIME_DLLS:cmdide-host>
            "${CMAKE_BINARY_DIR}/$<CONFIG>"
        COMMAND_EXPAND_LISTS
        COMMENT "Copying runtime DLLs"
    )
endif()

# ── Copy frontend assets alongside the executable ────────────────────────────
# The host loads the UI from <exe_dir>/www/index.html at runtime.
# For the final distributable, these are embedded in the binary (Phase M).
set(FRONTEND_DIST "${CMAKE_SOURCE_DIR}/../app/frontend/dist")
if(EXISTS "${FRONTEND_DIST}")
    add_custom_command(TARGET cmdide-host POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${FRONTEND_DIST}"
            "${CMAKE_BINARY_DIR}/$<CONFIG>/www"
        COMMENT "Copying frontend dist to www/"
    )
else()
    message(WARNING "Frontend dist not found: ${FRONTEND_DIST}. Run 'npm run build' in app/frontend/.")
endif()
