package plugins

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ExternalPluginInfo holds metadata and the bundled JS for an external plugin.
type ExternalPluginInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Author      string `json:"author"`
	Version     string `json:"version"`
	Code        string `json:"code"`
}

// Fetch downloads a plugin from a public GitHub repository.
func Fetch(githubURL string) (ExternalPluginInfo, error) {
	u, err := url.Parse(strings.TrimSpace(githubURL))
	if err != nil || u.Host != "github.com" {
		return ExternalPluginInfo{}, fmt.Errorf("not a valid GitHub URL")
	}

	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return ExternalPluginInfo{}, fmt.Errorf("URL must point to a repository: github.com/owner/repo")
	}
	owner, repo := parts[0], parts[1]

	var rawBase string
	for _, branch := range []string{"main", "master"} {
		base := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", owner, repo, branch)
		if _, testErr := httpFetch(base + "/package.json"); testErr == nil {
			rawBase = base
			break
		}
	}
	if rawBase == "" {
		return ExternalPluginInfo{}, fmt.Errorf("could not reach repository (tried main and master branches)")
	}

	pkgBody, err := httpFetch(rawBase + "/package.json")
	if err != nil {
		return ExternalPluginInfo{}, fmt.Errorf("could not fetch package.json: %w", err)
	}
	var pkg struct {
		Name        string      `json:"name"`
		Description string      `json:"description"`
		Author      interface{} `json:"author"`
		Version     string      `json:"version"`
		PluginID    string      `json:"pluginId"`
	}
	if err := json.Unmarshal([]byte(pkgBody), &pkg); err != nil {
		return ExternalPluginInfo{}, fmt.Errorf("invalid package.json: %w", err)
	}

	authorStr := ""
	switch v := pkg.Author.(type) {
	case string:
		authorStr = v
	case map[string]interface{}:
		if n, ok := v["name"].(string); ok {
			authorStr = n
		}
	}

	var code string
	for _, path := range []string{"/dist/index.js", "/index.js"} {
		code, err = httpFetch(rawBase + path)
		if err == nil {
			break
		}
	}
	if code == "" {
		return ExternalPluginInfo{}, fmt.Errorf("no plugin bundle found (tried dist/index.js and index.js)")
	}

	id := pkg.PluginID
	if id == "" {
		id = repo
	}
	name := pkg.Name
	if name == "" {
		name = repo
	}

	return ExternalPluginInfo{
		ID: id, Name: name,
		Description: pkg.Description, Author: authorStr,
		Version: pkg.Version, Code: code,
	}, nil
}

func httpFetch(fetchURL string) (string, error) {
	parsedURL, err := url.Parse(strings.TrimSpace(fetchURL))
	if err != nil || !parsedURL.IsAbs() || parsedURL.Scheme != "https" || parsedURL.Host == "" {
		return "", fmt.Errorf("invalid fetch URL: only absolute https URLs are allowed")
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(parsedURL.String())
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d for %s", resp.StatusCode, fetchURL)
	}
	body, err := io.ReadAll(resp.Body)
	return string(body), err
}
