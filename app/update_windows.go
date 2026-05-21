//go:build windows

package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// PerformUpdate downloads the requested version, spawns a PowerShell script
// to replace the running exe after it exits, then quits the app.
func (a *App) PerformUpdate(version string) error {
	filename := "cmdIDE-windows-amd64.exe"
	var downloadURL string
	if version == "" || version == "latest" {
		downloadURL = fmt.Sprintf(
			"https://github.com/%s/releases/latest/download/%s",
			githubUpdateRepo, filename,
		)
	} else {
		downloadURL = fmt.Sprintf(
			"https://github.com/%s/releases/download/%s/%s",
			githubUpdateRepo, version, filename,
		)
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not determine executable path: %w", err)
	}

	tmpFile := os.TempDir() + `\cmdIDE_update.exe`
	if err := downloadUpdateFile(downloadURL, tmpFile); err != nil {
		return fmt.Errorf("download failed: %w", err)
	}

	// PowerShell: wait briefly for the process to exit, replace the exe, relaunch.
	script := fmt.Sprintf(
		`Start-Sleep -Milliseconds 800; `+
			`Copy-Item -Force '%s' '%s'; `+
			`Start-Process '%s'`,
		tmpFile, exePath, exePath,
	)
	cmd := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
		"-Command", script,
	)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start update script: %w", err)
	}

	time.Sleep(200 * time.Millisecond)
	wailsruntime.Quit(a.ctx)
	return nil
}

func downloadUpdateFile(url, dest string) error {
	resp, err := http.Get(url) //nolint:noctx
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}
