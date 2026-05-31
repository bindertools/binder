#include "assets.hpp"
#include "dispatch.hpp"
#include <webview.h>
#include <windows.h>
#include <nlohmann/json.hpp>
#include <cstdlib>
#include <string>

// Suppress Wails window.go errors so the frontend loads without console spam.
// The full IPC shim is installed by the TypeScript layer in Phase I.
static constexpr const char* kWailsProxy = R"js(
window.go = window.go || new Proxy({}, {
  get: function(_, k) {
    return new Proxy(function(){}, {
      get: function(_, k2) {
        return new Proxy(function(){}, {
          get: function(_, k3) {
            return function() {
              return Promise.reject('Wails not available in C++ host');
            };
          }
        });
      }
    });
  }
});
)js";

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    bool debug = false;
#ifdef _DEBUG
    debug = true;
#endif

    webview::webview wv(debug, nullptr);
    wv.set_title("cmdIDE");
    wv.set_size(1280, 800, WEBVIEW_HINT_NONE);

    // Instantiate dispatcher (stub — full impl in Phase I.3)
    Dispatcher dispatcher(wv);

    // Register the IPC entry point BEFORE wv.run()
    wv.bind("__cmdide_invoke",
        [](const std::string& seq, const std::string& req, void* arg) {
            auto* d = static_cast<Dispatcher*>(arg);
            try {
                auto arr  = nlohmann::json::parse(req);
                auto type = arr[0].get<std::string>();
                auto args = arr[1].get<std::string>();
                d->dispatch(seq, type, args);
            } catch (const std::exception& e) {
                nlohmann::json err = {{"ok", false}, {"error", std::string("parse error: ") + e.what()}};
                d->dispatch(seq, "__error", err.dump());
            }
        },
        &dispatcher);

    // Inject Wails compatibility proxy via init script (runs before page scripts)
    wv.init(kWailsProxy);

    const char* dev_env = std::getenv("CMDIDE_DEV");
    std::string url = (dev_env && std::string(dev_env) == "1")
        ? GetDevUrl()
        : GetFrontendUrl(wv);

    wv.navigate(url);
    wv.run();
    return 0;
}
