package config

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
	DefaultZoom        float64              `json:"default_zoom"`
	CommandAlignment   string               `json:"command_alignment"` // "default" | "top" | "bottom"
	CustomTheme      map[string]string    `json:"custom_theme,omitempty"`
	TerminalWordWrap bool                 `json:"terminal_word_wrap"`
	FileWordWrap     bool                 `json:"file_word_wrap"`
	ScrollSpeed      int                  `json:"scroll_speed"`
	PreferredShell   string               `json:"preferred_shell"`
}

var (
	global   Config
	globalMu sync.RWMutex
)

// FilePath returns the path to the config file on disk.
func FilePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir, _ = os.UserHomeDir()
	}
	return filepath.Join(dir, "cmdIDE", "config.json")
}

// Ensure creates the config file with defaults if it does not exist.
func Ensure() error {
	path := FilePath()
	if _, err := os.Stat(path); err == nil {
		return nil
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

func load() (Config, error) {
	if err := Ensure(); err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(FilePath())
	if err != nil {
		return Config{}, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return Config{}, err
	}
	if c.Theme == "" {
		c.Theme = "dark"
	}
	// Apply defaults for keys added after initial release.
	if rawMap := (map[string]json.RawMessage{}); json.Unmarshal(data, &rawMap) == nil {
		if _, exists := rawMap["zoom_insights"]; !exists {
			c.ZoomInsights = true
		}
		if _, exists := rawMap["default_zoom"]; !exists {
			c.DefaultZoom = 1.0
		}
		if _, exists := rawMap["command_alignment"]; !exists {
			c.CommandAlignment = "default"
		}
		if _, exists := rawMap["scroll_speed"]; !exists {
			c.ScrollSpeed = 3
		}
	}
	if updated, err2 := json.MarshalIndent(c, "", "  "); err2 == nil {
		os.WriteFile(FilePath(), updated, 0644) //nolint:errcheck
	}
	return c, nil
}

// Init loads config from disk into the global state.
func Init() {
	c, _ := load()
	globalMu.Lock()
	global = c
	globalMu.Unlock()
}

// Get returns a snapshot of the current global config.
func Get() Config {
	globalMu.RLock()
	defer globalMu.RUnlock()
	return global
}

// Reload re-reads config from disk and updates global state.
func Reload() error {
	c, err := load()
	if err != nil {
		return err
	}
	globalMu.Lock()
	global = c
	globalMu.Unlock()
	return nil
}

// SetGlobal updates the in-memory config without writing to disk.
// Used by the C++ delegation path after C++ has already persisted the file.
func SetGlobal(c Config) {
	globalMu.Lock()
	global = c
	globalMu.Unlock()
}

// Reset deletes the config file and recreates it with defaults.
func Reset() error {
	path := FilePath()
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return Ensure()
}

// ApplyCustomTheme saves a custom theme palette and returns the updated config.
func ApplyCustomTheme(colors map[string]string) (Config, error) {
	globalMu.Lock()
	global.CustomTheme = colors
	global.Theme = "custom"
	c := global
	globalMu.Unlock()
	return c, write(c)
}

// Apply merges incoming settings (preserving the stored custom theme) and saves.
func Apply(incoming Config) (Config, error) {
	globalMu.Lock()
	incoming.CustomTheme = global.CustomTheme
	global = incoming
	c := global
	globalMu.Unlock()
	return c, write(c)
}

func write(c Config) error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(FilePath(), data, 0644)
}

// Write persists c to the config file without touching the in-memory global.
// Use SetGlobal before calling Write when you also need the in-memory state
// to reflect the new values.
func Write(c Config) error { return write(c) }
