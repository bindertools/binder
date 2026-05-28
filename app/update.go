// Removed in Phase 5: Go HTTP-based update check (net/http fetch + JSON parse)

package main

// AppVersion is injected at build time via:
//
//	wails build -ldflags "-X 'main.AppVersion=v1.2.3'"
//
// Falls back to "dev" for local/untagged builds.
var AppVersion = "dev"

const githubUpdateRepo = "Command-IDE/cmd-ide"

// CheckForUpdate asks the C++ backend to check the GitHub releases API.
// Returns the latest stable tag if newer than AppVersion, or "" if up-to-date.
func (a *App) CheckForUpdate() string {
	resp, err := a.cpp.RoundTrip(map[string]any{
		"type":       "updater.check",
		"id":         a.cppID(),
		"appVersion": AppVersion,
	}, 12000)
	if err != nil {
		return ""
	}
	if avail, _ := resp["updateAvailable"].(bool); avail {
		if v, ok := resp["latestVersion"].(string); ok {
			return v
		}
	}
	return ""
}
