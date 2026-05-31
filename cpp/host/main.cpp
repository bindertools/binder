#include "assets.hpp"
#include <webview.h>
#include <windows.h>
#include <cstdlib>
#include <string>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    bool debug = false;
#ifdef _DEBUG
    debug = true;
#endif

    webview::webview wv(debug, nullptr);
    wv.set_title("cmdIDE");
    wv.set_size(1280, 800, WEBVIEW_HINT_NONE);

    const char* dev_env = std::getenv("CMDIDE_DEV");
    std::string url = (dev_env && std::string(dev_env) == "1")
        ? GetDevUrl()
        : GetFrontendUrl(wv);

    wv.navigate(url);
    wv.run();
    return 0;
}
