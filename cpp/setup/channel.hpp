#pragma once

// Compile-time channel flag.
// Pass -DCMDIDE_SETUP_DEV=1 to cmake to build the dev-channel setup.
#ifdef CMDIDE_SETUP_DEV
constexpr bool kIncludePrerelease = true;
#else
constexpr bool kIncludePrerelease = false;
#endif
