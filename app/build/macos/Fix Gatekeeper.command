#!/bin/bash
# Fix Gatekeeper — run this once if macOS blocks cmdIDE on first launch.
# Double-click this file after dragging cmdIDE.app to /Applications.

APP="/Applications/cmdIDE.app"

if [ ! -d "$APP" ]; then
    osascript -e 'display alert "cmdIDE not found in Applications" message "Please drag cmdIDE.app into Applications first, then double-click this script." as warning buttons {"OK"} default button "OK"'
    exit 1
fi

xattr -dr com.apple.quarantine "$APP"

if [ $? -eq 0 ]; then
    osascript -e 'display notification "cmdIDE is ready. Open it from Launchpad or Applications." with title "cmdIDE"'
    open -a cmdIDE
else
    osascript -e 'display alert "Could not remove quarantine" message "Open Terminal and run:\n\nxattr -dr com.apple.quarantine /Applications/cmdIDE.app" as warning buttons {"OK"} default button "OK"'
fi
