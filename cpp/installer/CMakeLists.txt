find_path(ZSERGE_WEBVIEW_INCLUDE_DIRS "webview.h" REQUIRED)

option(CMDIDE_INSTALLER_DEV "Include pre-release versions" OFF)

if(WIN32)
    find_package(unofficial-webview2 CONFIG REQUIRED)

    # Embed the installer frontend as a zip RC resource
    find_package(Python3 REQUIRED COMPONENTS Interpreter)
    set(INSTALLER_DIST "${CMAKE_SOURCE_DIR}/../installer/windows/frontend/dist")
    set(GENERATED_DIR  "${CMAKE_CURRENT_SOURCE_DIR}/generated")
    set(GENERATED_ZIP  "${GENERATED_DIR}/frontend.zip")

    if(EXISTS "${INSTALLER_DIST}")
        file(GLOB_RECURSE INSTALLER_DIST_FILES "${INSTALLER_DIST}/*")
    else()
        set(INSTALLER_DIST_FILES "")
        message(WARNING "Installer dist not found: ${INSTALLER_DIST}")
    endif()

    add_custom_command(
        OUTPUT "${GENERATED_ZIP}"
        COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/gen_assets.py"
            "${INSTALLER_DIST}"
            "${GENERATED_ZIP}"
        DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/gen_assets.py" ${INSTALLER_DIST_FILES}
        COMMENT "Zipping installer dist → generated/frontend.zip"
    )
    add_custom_target(gen_installer_zip DEPENDS "${GENERATED_ZIP}")

    add_executable(cmdide-installer WIN32 main.cpp installer.cpp resources.rc)
    add_dependencies(cmdide-installer gen_installer_zip)
else()
    add_executable(cmdide-installer main.cpp installer.cpp)
endif()

if(CMDIDE_INSTALLER_DEV)
    target_compile_definitions(cmdide-installer PRIVATE CMDIDE_INSTALLER_DEV=1)
endif()

set_target_properties(cmdide-installer PROPERTIES
    CXX_STANDARD 17
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
)

target_include_directories(cmdide-installer PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    ${ZSERGE_WEBVIEW_INCLUDE_DIRS}
)

find_package(nlohmann_json CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(httplib CONFIG REQUIRED)
find_package(libzip CONFIG REQUIRED)

target_link_libraries(cmdide-installer PRIVATE
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    httplib::httplib
    libzip::zip
)

if(WIN32)
    target_compile_definitions(cmdide-installer PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX _UNICODE UNICODE)
    target_link_libraries(cmdide-installer PRIVATE
        unofficial::webview2::webview2
        ole32 oleaut32 shlwapi dwmapi shell32
    )
    if(NOT VCPKG_TARGET_TRIPLET MATCHES "static")
        add_custom_command(TARGET cmdide-installer POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                $<TARGET_RUNTIME_DLLS:cmdide-installer>
                "${CMAKE_BINARY_DIR}/$<CONFIG>"
            COMMAND_EXPAND_LISTS
            COMMENT "Copying runtime DLLs"
        )
    endif()
endif()
