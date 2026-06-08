find_path(ZSERGE_WEBVIEW_INCLUDE_DIRS "webview.h" REQUIRED)

option(CMDIDE_SETUP_DEV "Include pre-release versions" OFF)

if(WIN32)
    find_package(unofficial-webview2 CONFIG REQUIRED)

    # Embed the setup frontend as a zip RC resource
    find_package(Python3 REQUIRED COMPONENTS Interpreter)
    set(SETUP_DIST "${CMAKE_SOURCE_DIR}/../setup/windows/frontend/dist")
    set(GENERATED_DIR  "${CMAKE_CURRENT_SOURCE_DIR}/generated")
    set(GENERATED_ZIP  "${GENERATED_DIR}/frontend.zip")

    if(EXISTS "${SETUP_DIST}")
        file(GLOB_RECURSE SETUP_DIST_FILES "${SETUP_DIST}/*")
    else()
        set(SETUP_DIST_FILES "")
        message(WARNING "Setup dist not found: ${SETUP_DIST}")
    endif()

    add_custom_command(
        OUTPUT "${GENERATED_ZIP}"
        COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/gen_assets.py"
            "${SETUP_DIST}"
            "${GENERATED_ZIP}"
        DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/gen_assets.py" ${SETUP_DIST_FILES}
        COMMENT "Zipping setup dist → generated/frontend.zip"
    )
    add_custom_target(gen_setup_zip DEPENDS "${GENERATED_ZIP}")

    add_executable(cmdide-setup WIN32 main.cpp installer.cpp resources.rc)
    add_dependencies(cmdide-setup gen_setup_zip)
else()
    add_executable(cmdide-setup main.cpp installer.cpp)
endif()

if(CMDIDE_SETUP_DEV)
    target_compile_definitions(cmdide-setup PRIVATE CMDIDE_SETUP_DEV=1)
endif()

set_target_properties(cmdide-setup PROPERTIES
    CXX_STANDARD 17
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
)

target_include_directories(cmdide-setup PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    ${ZSERGE_WEBVIEW_INCLUDE_DIRS}
)

find_package(nlohmann_json CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(httplib CONFIG REQUIRED)
find_package(libzip CONFIG REQUIRED)

target_link_libraries(cmdide-setup PRIVATE
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    httplib::httplib
    libzip::zip
)

if(WIN32)
    target_compile_definitions(cmdide-setup PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX _UNICODE UNICODE)
    target_link_libraries(cmdide-setup PRIVATE
        unofficial::webview2::webview2
        ole32 oleaut32 shlwapi dwmapi shell32
    )
    if(NOT VCPKG_TARGET_TRIPLET MATCHES "static")
        add_custom_command(TARGET cmdide-setup POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                $<TARGET_RUNTIME_DLLS:cmdide-setup>
                "${CMAKE_BINARY_DIR}/$<CONFIG>"
            COMMAND_EXPAND_LISTS
            COMMENT "Copying runtime DLLs"
        )
    endif()
endif()
