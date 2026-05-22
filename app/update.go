package main

import (
	"encoding/json"
	"net/http"
	"time"
)

// AppVersion is injected at build time via:
//   wails build -ldflags "-X 'main.AppVersion=v1.2.3'"
// Falls back to "dev" for local/untagged builds.
var AppVersion = "dev"

const githubUpdateRepo = "Command-IDE/cmd-ide"

// CheckForUpdate fetches GitHub releases, finds the newest stable (non-prerelease)
// release, and returns its tag if it differs from AppVersion. Returns "" when
// already up-to-date or when the check fails.
func (a *App) CheckForUpdate() string {
	url := "https://api.github.com/repos/" + githubUpdateRepo + "/releases"
	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "cmdIDE-app")
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		return ""
	}
	defer resp.Body.Close()

	var releases []struct {
		TagName    string `json:"tag_name"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return ""
	}

	// GitHub returns newest-first; find the first stable release.
	for _, r := range releases {
		if !r.Prerelease {
			if r.TagName != AppVersion {
				return r.TagName
			}
			return ""
		}
	}
	return ""
}
