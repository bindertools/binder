#pragma once
#ifdef _WIN32

// Register the Windows taskbar jump list with a "New Window" task entry.
// Sets AppUserModelID to "Binder.App" so all windows appear as one taskbar group.
void RegisterJumpList();

#endif // _WIN32
