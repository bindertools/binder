//go:build !windows

package terminal

import (
	"os"
	"path/filepath"
)

// DefaultDir returns the best starting directory for a new terminal session on
// macOS and Linux. It checks (in order): the user-configured default, the
// Documents folder under home, and finally the home directory itself.
func DefaultDir(configDefault string) string {
	if configDefault != "" {
		if info, err := os.Stat(configDefault); err == nil && info.IsDir() {
			return configDefault
		}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	docs := filepath.Join(home, "Documents")
	if info, err := os.Stat(docs); err == nil && info.IsDir() {
		return docs
	}
	return home
}
