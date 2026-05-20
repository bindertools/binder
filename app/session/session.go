package session

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Tab is a minimal description of one open tab, persisted for soft-close.
type Tab struct {
	Type     string `json:"type"`
	FilePath string `json:"file_path,omitempty"`
	Language string `json:"language,omitempty"`
	Cwd      string `json:"cwd,omitempty"`
}

func filePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir, _ = os.UserHomeDir()
	}
	return filepath.Join(dir, "cmdIDE", "session.json")
}

// Save persists the current tab list to disk.
func Save(tabs []Tab) {
	data, err := json.MarshalIndent(tabs, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(filePath()), 0755)
	os.WriteFile(filePath(), data, 0644) //nolint:errcheck
}

// Load reads the persisted tab list. Returns nil when none exists.
func Load() []Tab {
	data, err := os.ReadFile(filePath())
	if err != nil {
		return nil
	}
	var tabs []Tab
	if err := json.Unmarshal(data, &tabs); err != nil {
		return nil
	}
	return tabs
}
