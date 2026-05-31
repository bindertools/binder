find_path(ZSERGE_WEBVIEW_INCLUDE_DIRS "webview.h" REQUIRED)

if(WIN32)
    find_package(unofficial-webview2 CONFIG REQUIRED)
    add_executable(cmdide-installer WIN32 main.cpp installer.cpp)
else()
    add_executable(cmdide-installer main.cpp installer.cpp)
endif()

# Dev-channel variant: cmake -DCMDIDE_INSTALLER_DEV=ON ...
option(CMDIDE_INSTALLER_DEV "Include pre-release versions in the installer" OFF)
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

target_link_libraries(cmdide-installer PRIVATE
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    httplib::httplib
)

if(WIN32)
    target_compile_definitions(cmdide-installer PRIVATE
        WIN32_LEAN_AND_MEAN NOMINMAX _UNICODE UNICODE
    )
    target_link_libraries(cmdide-installer PRIVATE
        unofficial::webview2::webview2
        ole32 oleaut32 shlwapi dwmapi shell32
    )
    add_custom_command(TARGET cmdide-installer POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_RUNTIME_DLLS:cmdide-installer>
            "${CMAKE_BINARY_DIR}/$<CONFIG>"
        COMMAND_EXPAND_LISTS
        COMMENT "Copying runtime DLLs"
    )
endif()

# Copy installer frontend assets alongside the executable
set(INSTALLER_DIST "${CMAKE_SOURCE_DIR}/../installer/windows/frontend/dist")
if(EXISTS "${INSTALLER_DIST}")
    add_custom_command(TARGET cmdide-installer POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${INSTALLER_DIST}"
            "${CMAKE_BINARY_DIR}/$<CONFIG>/www"
        COMMENT "Copying installer frontend dist to www/"
    )
else()
    message(WARNING "Installer dist not found: ${INSTALLER_DIST}. Run 'npm run build' in installer/windows/frontend/.")
endif()
