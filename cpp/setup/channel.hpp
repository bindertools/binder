#pragma once

// Compile-time channel flag.
// Pass -DCMDIDE_INSTALLER_DEV=1 to cmake to build the dev-channel installer.
#ifdef CMDIDE_INSTALLER_DEV
constexpr bool kIncludePrerelease = true;
#else
constexpr bool kIncludePrerelease = false;
#endif
