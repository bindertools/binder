//go:build windows

package terminal

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

// DefaultDir returns the best starting directory for a new terminal session on
// Windows. It checks (in order): the user-configured default, the Documents
// folder from the Windows registry, and finally the home directory.
func DefaultDir(configDefault string) string {
	if configDefault != "" {
		if info, err := os.Stat(configDefault); err == nil && info.IsDir() {
			return configDefault
		}
	}

	k, err := registry.OpenKey(
		registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`,
		registry.QUERY_VALUE,
	)
	if err == nil {
		defer k.Close()
		if path, _, err := k.GetStringValue("Personal"); err == nil {
			expanded := os.ExpandEnv(path)
			if info, err := os.Stat(expanded); err == nil && info.IsDir() {
				return expanded
			}
		}
	}

	home, _ := os.UserHomeDir()
	docs := filepath.Join(home, "Documents")
	if info, err := os.Stat(docs); err == nil && info.IsDir() {
		return docs
	}
	return home
}
