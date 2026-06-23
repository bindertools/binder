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

    add_executable(binder-host WIN32
        main.cpp dispatch.cpp window_win.cpp
        splash_windows.cpp jumplist_windows.cpp
        resources.rc)

    # Ensure the zip is generated before the RC compiler embeds it, and that the
    # RC compile (and relink) actually reruns when only the zip's contents change
    # (vite's hashed output filenames mean resources.rc itself never changes).
    add_dependencies(binder-host gen_frontend_zip)
    set_source_files_properties(resources.rc PROPERTIES OBJECT_DEPENDS "${GENERATED_ZIP}")

else()
    add_executable(binder-host main.cpp dispatch.cpp)
endif()

set_target_properties(binder-host PROPERTIES
    CXX_STANDARD 17
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
)

target_include_directories(binder-host PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    ${ZSERGE_WEBVIEW_INCLUDE_DIRS}
)

# libzip is used by assets.hpp on Windows to extract the embedded frontend zip
target_link_libraries(binder-host PRIVATE binder-backend-lib)

if(WIN32)
    target_compile_definitions(binder-host PRIVATE
        WIN32_LEAN_AND_MEAN NOMINMAX _UNICODE UNICODE
    )
    target_link_libraries(binder-host PRIVATE
        unofficial::webview2::webview2
        ole32 oleaut32 shlwapi dwmapi
    )
    # With x64-windows-static triplet, all libs are statically linked — no DLLs to copy.
    # WebView2Loader.dll is an exception (always a DLL — it's the WebView2 runtime loader).
    if(NOT VCPKG_TARGET_TRIPLET MATCHES "static")
        add_custom_command(TARGET binder-host POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                $<TARGET_RUNTIME_DLLS:binder-host>
                "${CMAKE_BINARY_DIR}/$<CONFIG>"
            COMMAND_EXPAND_LISTS
            COMMENT "Copying runtime DLLs"
        )
    endif()
elseif(UNIX AND NOT APPLE)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(GTK3 REQUIRED gtk+-3.0)
    pkg_check_modules(WEBKIT2GTK REQUIRED webkit2gtk-4.1)
    target_compile_options(binder-host PRIVATE ${GTK3_CFLAGS_OTHER} ${WEBKIT2GTK_CFLAGS_OTHER})
    target_include_directories(binder-host PRIVATE ${GTK3_INCLUDE_DIRS} ${WEBKIT2GTK_INCLUDE_DIRS})
    target_link_libraries(binder-host PRIVATE ${GTK3_LIBRARIES} ${WEBKIT2GTK_LIBRARIES})
    # www/ assets alongside the exe for Linux builds
    set(FRONTEND_DIST "${CMAKE_SOURCE_DIR}/../app/frontend/dist")
    if(EXISTS "${FRONTEND_DIST}")
        add_custom_command(TARGET binder-host POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${FRONTEND_DIST}" "${CMAKE_BINARY_DIR}/$<CONFIG>/www"
            COMMENT "Copying frontend dist to www/ (Linux)")
    endif()
elseif(APPLE)
    target_link_libraries(binder-host PRIVATE "-framework WebKit" "-framework Cocoa")
    # www/ assets alongside the exe for macOS builds
    set(FRONTEND_DIST "${CMAKE_SOURCE_DIR}/../app/frontend/dist")
    if(EXISTS "${FRONTEND_DIST}")
        add_custom_command(TARGET binder-host POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${FRONTEND_DIST}" "${CMAKE_BINARY_DIR}/$<CONFIG>/www"
            COMMENT "Copying frontend dist to www/ (macOS)")
    endif()
endif()
