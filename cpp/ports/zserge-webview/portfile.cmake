# header-only library — fixed to install the full include tree (webview/ subdir)

vcpkg_from_github(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO webview/webview
    REF 0.12.0
    SHA512 f198e414145101693fd2b5724fb017df578770c6edda319ce312cf9e9e1fdc1b1d94beba2e64e75d9746dee16010cc525be8ae7ca0713ee541b75a0a1d9bc791
    HEAD_REF master
)

# Install the full include tree: webview.h (compat) + webview/webview.h (actual)
if(EXISTS "${SOURCE_PATH}/core/include/webview")
    file(COPY "${SOURCE_PATH}/core/include/webview" DESTINATION "${CURRENT_PACKAGES_DIR}/include")
endif()
if(EXISTS "${SOURCE_PATH}/core/include/webview.h")
    file(COPY "${SOURCE_PATH}/core/include/webview.h" DESTINATION "${CURRENT_PACKAGES_DIR}/include")
endif()

# Handle copyright
vcpkg_install_copyright(FILE_LIST "${SOURCE_PATH}/LICENSE")
