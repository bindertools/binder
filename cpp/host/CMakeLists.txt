# zserge-webview is header-only — locate webview.h via vcpkg's include path
find_path(ZSERGE_WEBVIEW_INCLUDE_DIRS "webview.h" REQUIRED)

if(WIN32)
    find_package(unofficial-webview2 CONFIG REQUIRED)

    # ── Embed frontend assets as a zip RC resource ─────────────────────────────
    # gen_assets.py zips dist/ → generated/frontend.zip
    # resources.rc embeds it as FRONTEND_ZIP RCDATA → self-contained exe, no www/ sidecar
    find_package(Python3 REQUIRED COMPONENTS Interpreter)

    set(FRONTEND_DIST "${CMAKE_SOURCE_DIR}/../app/frontend/dist")
    set(GENERATED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/generated")
    set(GENERATED_ZIP "${GENERATED_DIR}/frontend.zip")

    if(EXISTS "${FRONTEND_DIST}")
        file(GLOB_RECURSE FRONTEND_DIST_FILES "${FRONTEND_DIST}/*")
    else()
        set(FRONTEND_DIST_FILES "")
        message(WARNING "Frontend dist not found: ${FRONTEND_DIST}. Run 'npm run build' first.")
    endif()

    add_custom_command(
        OUTPUT "${GENERATED_ZIP}"
        COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/gen_assets.py"
            "${FRONTEND_DIST}"
            "${GENERATED_ZIP}"
        DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/gen_assets.py" ${FRONTEND_DIST_FILES}
        COMMENT "Zipping frontend dist → generated/frontend.zip (embedded in exe)"
    )
    add_custom_target(gen_frontend_zip DEPENDS "${GENERATED_ZIP}")

    add_executable(cmdide-host WIN32
        main.cpp dispatch.cpp window_win.cpp
        splash_windows.cpp jumplist_windows.cpp
        resources.rc)

    # Ensure the zip is generated before the RC compiler embeds it
    add_dependencies(cmdide-host gen_frontend_zip)

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

# libzip is used by assets.hpp on Windows to extract the embedded frontend zip
target_link_libraries(cmdide-host PRIVATE cmdide-backend-lib)

if(WIN32)
    target_compile_definitions(cmdide-host PRIVATE
        WIN32_LEAN_AND_MEAN NOMINMAX _UNICODE UNICODE
    )
    target_link_libraries(cmdide-host PRIVATE
        unofficial::webview2::webview2
        ole32 oleaut32 shlwapi dwmapi
    )
    add_custom_command(TARGET cmdide-host POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_RUNTIME_DLLS:cmdide-host>
            "${CMAKE_BINARY_DIR}/$<CONFIG>"
        COMMAND_EXPAND_LISTS
        COMMENT "Copying runtime DLLs"
    )
elseif(UNIX AND NOT APPLE)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(GTK3 REQUIRED gtk+-3.0)
    pkg_check_modules(WEBKIT2GTK REQUIRED webkit2gtk-4.1)
    target_compile_options(cmdide-host PRIVATE ${GTK3_CFLAGS_OTHER} ${WEBKIT2GTK_CFLAGS_OTHER})
    target_include_directories(cmdide-host PRIVATE ${GTK3_INCLUDE_DIRS} ${WEBKIT2GTK_INCLUDE_DIRS})
    target_link_libraries(cmdide-host PRIVATE ${GTK3_LIBRARIES} ${WEBKIT2GTK_LIBRARIES})
    # www/ assets alongside the exe for Linux builds
    set(FRONTEND_DIST "${CMAKE_SOURCE_DIR}/../app/frontend/dist")
    if(EXISTS "${FRONTEND_DIST}")
        add_custom_command(TARGET cmdide-host POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${FRONTEND_DIST}" "${CMAKE_BINARY_DIR}/$<CONFIG>/www"
            COMMENT "Copying frontend dist to www/ (Linux)")
    endif()
elseif(APPLE)
    target_link_libraries(cmdide-host PRIVATE "-framework WebKit" "-framework Cocoa")
    # www/ assets alongside the exe for macOS builds
    set(FRONTEND_DIST "${CMAKE_SOURCE_DIR}/../app/frontend/dist")
    if(EXISTS "${FRONTEND_DIST}")
        add_custom_command(TARGET cmdide-host POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${FRONTEND_DIST}" "${CMAKE_BINARY_DIR}/$<CONFIG>/www"
            COMMENT "Copying frontend dist to www/ (macOS)")
    endif()
endif()
