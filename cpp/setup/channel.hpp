#pragma once

// Compile-time channel flag.
// Pass -DBINDER_SETUP_DEV=1 to cmake to build the dev-channel setup.
#ifdef BINDER_SETUP_DEV
constexpr bool kIncludePrerelease = true;
#else
constexpr bool kIncludePrerelease = false;
#endif
