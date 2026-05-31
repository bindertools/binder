#include <webview.h>
#include <windows.h>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    webview::webview wv(false, nullptr);
    wv.set_title("cmdIDE");
    wv.set_size(1280, 800, WEBVIEW_HINT_NONE);
    wv.navigate("about:blank");
    wv.run();
    return 0;
}
