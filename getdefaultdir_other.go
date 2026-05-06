//go:build !windows

package main

import (
	"os"
	"path/filepath"
)

func getDefaultDir() string {
	if cfg := getGlobalConfig(); cfg.DefaultDirectory != "" {
		if info, err := os.Stat(cfg.DefaultDirectory); err == nil && info.IsDir() {
			return cfg.DefaultDirectory
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
