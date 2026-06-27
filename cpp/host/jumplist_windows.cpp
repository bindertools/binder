#ifdef _WIN32
#include "jumplist_windows.hpp"
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shobjidl.h>      // ICustomDestinationList, IShellLink, IObjectCollection
#include <shlobj.h>        // SHGetKnownFolderPath
#include <propkey.h>       // PKEY_Title
#include <propvarutil.h>   // InitPropVariantFromString

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "propsys.lib")

static constexpr LPCWSTR kAppUserModelId = L"Binder.App";

void RegisterJumpList() {
    // Set AppUserModelID so all windows appear grouped in the taskbar
    SetCurrentProcessExplicitAppUserModelID(kAppUserModelId);

    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    // Get current executable path
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);

    // Create the destination list
    ICustomDestinationList* pList = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_DestinationList, nullptr,
                                  CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pList));
    if (FAILED(hr)) return;

    pList->SetAppID(kAppUserModelId);

    UINT maxSlots = 0;
    IObjectArray* pRemoved = nullptr;
    hr = pList->BeginList(&maxSlots, IID_PPV_ARGS(&pRemoved));
    if (pRemoved) pRemoved->Release();
    if (FAILED(hr)) { pList->Release(); return; }

    // Create a collection with one "New Window" task
    IObjectCollection* pColl = nullptr;
    hr = CoCreateInstance(CLSID_EnumerableObjectCollection, nullptr,
                          CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pColl));
    if (FAILED(hr)) { pList->AbortList(); pList->Release(); return; }

    // Create a shell link for "New Window"
    IShellLinkW* pLink = nullptr;
    hr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                          IID_PPV_ARGS(&pLink));
    if (SUCCEEDED(hr)) {
        pLink->SetPath(exePath);
        pLink->SetShowCmd(SW_SHOWNORMAL);

        // Set the display title via IPropertyStore
        IPropertyStore* pStore = nullptr;
        if (SUCCEEDED(pLink->QueryInterface(IID_PPV_ARGS(&pStore)))) {
            PROPVARIANT pv;
            InitPropVariantFromString(L"New Window", &pv);
            pStore->SetValue(PKEY_Title, pv);
            pStore->Commit();
            PropVariantClear(&pv);
            pStore->Release();
        }

        pColl->AddObject(pLink);
        pLink->Release();
    }

    // Add the task collection and commit
    IObjectArray* pArr = nullptr;
    if (SUCCEEDED(pColl->QueryInterface(IID_PPV_ARGS(&pArr)))) {
        pList->AddUserTasks(pArr);
        pArr->Release();
    }
    pList->CommitList();

    pColl->Release();
    pList->Release();
}

#endif // _WIN32
