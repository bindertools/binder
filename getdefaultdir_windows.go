//go:build windows

package main

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

func getDefaultDir() string {
	if cfg := getGlobalConfig(); cfg.DefaultDirectory != "" {
		if info, err := os.Stat(cfg.DefaultDirectory); err == nil && info.IsDir() {
			return cfg.DefaultDirectory
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
