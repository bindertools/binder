package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// GitRecognitionConfig holds settings for git-aware prompt features.
type GitRecognitionConfig struct {
	ShowGitBranch bool `json:"show_git_branch"`
}

// Config holds user-editable settings persisted to config.json.
type Config struct {
	DefaultDirectory string               `json:"default_directory"`
	IndentGuides     bool                 `json:"indent_guides"`
	OrderDirectory   bool                 `json:"order_directory"`
	Minimap          bool                 `json:"minimap"`
	Theme            string               `json:"theme"`
	ShowTimestamps   bool                 `json:"show_timestamps"`
	GitRecognition   GitRecognitionConfig `json:"git_recognition"`
	SoftClose        bool                 `json:"soft_close"`
	ZoomInsights     bool                 `json:"zoom_insights"`
	MinimalPwd       bool                 `json:"minimal_pwd"`
	DefaultZoom      float64              `json:"default_zoom"`
	// CustomTheme holds per-color overrides used when Theme == "custom".
	// Keys match the flat color-key scheme defined in frontend/src/themes.ts.
	CustomTheme      map[string]string `json:"custom_theme,omitempty"`
	TerminalWordWrap bool              `json:"terminal_word_wrap"`
	FileWordWrap     bool              `json:"file_word_wrap"`
	ScrollSpeed      int               `json:"scroll_speed"`
}

var (
	globalConfig   Config
	globalConfigMu sync.RWMutex
)

func configFilePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir, _ = os.UserHomeDir()
	}
	return filepath.Join(dir, "cmdIDE", "config.json")
}

func ensureConfig() error {
	path := configFilePath()
	if _, err := os.Stat(path); err == nil {
		return nil // already exists
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	defaults := Config{
		DefaultDirectory: "",
		IndentGuides:     false,
		OrderDirectory:   false,
		Minimap:          false,
		Theme:            "dark",
		ShowTimestamps:   false,
		GitRecognition:   GitRecognitionConfig{ShowGitBranch: false},
		SoftClose:        false,
		ZoomInsights:     true,
		DefaultZoom:      1.0,
		ScrollSpeed:      3,
	}
	data, _ := json.MarshalIndent(defaults, "", "  ")
	return os.WriteFile(path, data, 0644)
}

func loadConfig() (Config, error) {
	if err := ensureConfig(); err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(configFilePath())
	if err != nil {
		return Config{}, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return Config{}, err
	}
	// Apply defaults for fields added after initial release.
	if c.Theme == "" {
		c.Theme = "dark"
	}
	// Apply defaults for keys added after the initial release.
	// We check the raw JSON map so we can distinguish "absent" from "explicitly false/zero".
	if rawMap := (map[string]json.RawMessage{}); json.Unmarshal(data, &rawMap) == nil {
		if _, exists := rawMap["zoom_insights"]; !exists {
			c.ZoomInsights = true
		}
		if _, exists := rawMap["default_zoom"]; !exists {
			c.DefaultZoom = 1.0
		}
		if _, exists := rawMap["scroll_speed"]; !exists {
			c.ScrollSpeed = 3
		}
	}
	// Always write back so the file always reflects all current fields,
	// including any new ones added in this version.
	if updated, err2 := json.MarshalIndent(c, "", "  "); err2 == nil {
		os.WriteFile(configFilePath(), updated, 0644) //nolint:errcheck
	}
	return c, nil
}

func initConfig() {
	c, _ := loadConfig()
	globalConfigMu.Lock()
	globalConfig = c
	globalConfigMu.Unlock()
}

func getGlobalConfig() Config {
	globalConfigMu.RLock()
	defer globalConfigMu.RUnlock()
	return globalConfig
}

func reloadGlobalConfig() error {
	c, err := loadConfig()
	if err != nil {
		return err
	}
	globalConfigMu.Lock()
	globalConfig = c
	globalConfigMu.Unlock()
	return nil
}

// resetConfig deletes the existing config file and recreates it with defaults.
func resetConfig() error {
	path := configFilePath()
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return ensureConfig()
}
