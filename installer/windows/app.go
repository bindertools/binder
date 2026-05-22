//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	githubRepo = "Command-IDE/cmd-ide"
	binaryName = "cmdIDE.exe"
)

type App struct{ ctx context.Context }

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) GetInstallDir() string {
	local, _ := os.UserCacheDir()
	return filepath.Join(local, "Programs", "cmdIDE")
}

// ReleaseInfo describes a single GitHub release entry.
type ReleaseInfo struct {
	Tag        string `json:"tag"`
	Prerelease bool   `json:"prerelease"`
}

func (a *App) GetReleases() []ReleaseInfo {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases", githubRepo)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "cmdIDE-installer")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		return nil
	}
	defer resp.Body.Close()

	var raw []struct {
		TagName    string `json:"tag_name"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil
	}

	result := make([]ReleaseInfo, 0, len(raw))
	for _, r := range raw {
		result = append(result, ReleaseInfo{Tag: r.TagName, Prerelease: r.Prerelease})
	}
	return result
}

func buildDownloadURL(version string, installPlugins bool) string {
	base := fmt.Sprintf("https://github.com/%s/releases", githubRepo)
	var filename string
	if installPlugins {
		filename = "cmdIDE-plugins-windows-amd64.exe"
	} else {
		filename = "cmdIDE-windows-amd64.exe"
	}
	if version == "" || version == "latest" {
		return fmt.Sprintf("%s/latest/download/%s", base, filename)
	}
	return fmt.Sprintf("%s/download/%s/%s", base, version, filename)
}

func (a *App) Install(version string, createShortcut bool, installPlugins bool) error {
	emit := func(pct int, msg string) {
		wailsruntime.EventsEmit(a.ctx, "install:progress", pct, msg)
		time.Sleep(80 * time.Millisecond)
	}

	emit(5, "Preparing…")
	installDir := a.GetInstallDir()
	url := buildDownloadURL(version, installPlugins)

	emit(10, "Fetching release…")
	data, err := downloadWithProgress(url, func(pct int) {
		wailsruntime.EventsEmit(a.ctx, "install:progress", 10+pct*70/100, "Downloading…")
	})
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}

	emit(82, "Creating install directory…")
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return fmt.Errorf("could not create directory: %w", err)
	}

	emit(88, "Installing…")
	dest := filepath.Join(installDir, binaryName)
	if err := os.WriteFile(dest, data, 0o755); err != nil {
		return fmt.Errorf("could not write executable: %w", err)
	}

	if createShortcut {
		emit(94, "Creating desktop shortcut…")
		if err := createDesktopShortcut(installDir, dest); err != nil {
			return fmt.Errorf("desktop shortcut: %w", err)
		}
	}

	emit(100, "Installation complete")
	return nil
}

func createDesktopShortcut(installDir, exe string) error {
	script := fmt.Sprintf(
		`$d=[System.Environment]::GetFolderPath('Desktop');`+
			`$s=New-Object -ComObject WScript.Shell;`+
			`$l=$s.CreateShortcut($d+'\cmdIDE.lnk');`+
			`$l.TargetPath='%s';`+
			`$l.WorkingDirectory='%s';`+
			`$l.Save()`,
		exe, installDir,
	)
	// HideWindow hides the console before it appears (STARTF_USESHOWWINDOW | SW_HIDE)
	// without using CREATE_NO_WINDOW, so the STA message pump COM needs still works.
	// -Sta ensures WScript.Shell gets a proper STA apartment.
	cmd := exec.Command("powershell.exe",
		"-Sta", "-NoProfile", "-NonInteractive",
		"-Command", script,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("shortcut: %w: %s", err, out)
	}
	return nil
}

func (a *App) LaunchAndClose() {
	exe := filepath.Join(a.GetInstallDir(), binaryName)
	cmd := exec.Command(exe)
	noWindow(cmd)
	_ = cmd.Start()
	time.Sleep(300 * time.Millisecond)
	wailsruntime.Quit(a.ctx)
}

func (a *App) CloseInstaller() { wailsruntime.Quit(a.ctx) }

// downloadWithProgress streams url and calls progress(0–100) as bytes arrive.
func downloadWithProgress(url string, progress func(int)) ([]byte, error) {
	resp, err := http.Get(url) //nolint:noctx
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	total := resp.ContentLength
	var buf []byte
	tmp := make([]byte, 32*1024)
	var received int64
	for {
		n, err := resp.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			received += int64(n)
			if total > 0 {
				progress(int(received * 100 / total))
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	return buf, nil
}
