// Stable C ABI between the host and an app's native backend DLL.
//
// Buffer ownership rule: each side frees only what it allocated.
//   - host_api->config_get(...) returns a host_alloc'd buffer; the plugin
//     must release it with host_api->host_free(...).
//   - binder_app_dispatch's out_json is allocated by the plugin (via
//     binder_app_alloc); the host must release it with binder_app_free.
// Never call free()/delete on a buffer the other side allocated -- with
// /MT static CRT linkage each module has its own CRT heap instance.
#pragma once
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct BinderHostApi {
    // Push an event to the frontend (window.__binder_emit(...)).
    void  (*emit_event)(const char* event_json_utf8);
    // Read a top-level config.json key. Returns a host_alloc'd JSON string
    // (e.g. "null" if absent) that the plugin must release with host_free.
    char* (*config_get)(const char* key);
    // Write a top-level config.json key (value is a JSON-encoded string).
    void  (*config_set)(const char* key, const char* json_value_utf8);
    char* (*host_alloc)(size_t n);
    void  (*host_free)(char* p);
} BinderHostApi;

#ifdef _WIN32
  #define BINDER_APP_EXPORT __declspec(dllexport)
#else
  #define BINDER_APP_EXPORT __attribute__((visibility("default")))
#endif

// Exported by every app backend DLL:
//
//   void  binder_app_init(const BinderHostApi* host_api);
//   int   binder_app_dispatch(const char* type, const char* args_json_utf8, char** out_json);
//   char* binder_app_alloc(size_t n);
//   void  binder_app_free(char* p);
//   void  binder_app_shutdown(void);
//
// binder_app_dispatch returns 1 and writes a binder_app_alloc'd JSON string
// to *out_json if `type` was handled, 0 otherwise (mirrors the existing
// `bool dispatch(...)` convention every *_ops module already uses).
typedef void  (*BinderAppInitFn)(const BinderHostApi* host_api);
typedef int   (*BinderAppDispatchFn)(const char* type, const char* args_json_utf8, char** out_json);
typedef char* (*BinderAppAllocFn)(size_t n);
typedef void  (*BinderAppFreeFn)(char* p);
typedef void  (*BinderAppShutdownFn)(void);

#ifdef __cplusplus
}
#endif
