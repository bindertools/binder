//go:build windows

package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	releaseURL        = "https://github.com/Command-IDE/cmd-ide/releases/latest/download/cmdIDE-windows-amd64.exe"
	releaseURLPlugins = "https://github.com/Command-IDE/cmd-ide/releases/latest/download/cmdIDE-plugins-windows-amd64.exe"
	binaryName        = "cmdIDE.exe"
)

type App struct{ ctx context.Context }

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) GetInstallDir() string {
	local, _ := os.UserCacheDir()
	return filepath.Join(local, "Programs", "cmdIDE")
}

func (a *App) Install(createShortcut bool, installPlugins bool) error {
	emit := func(pct int, msg string) {
		wailsruntime.EventsEmit(a.ctx, "install:progress", pct, msg)
		time.Sleep(80 * time.Millisecond)
	}

	emit(5, "Preparing…")
	installDir := a.GetInstallDir()

	url := releaseURL
	if installPlugins {
		url = releaseURLPlugins
	}

	emit(10, "Fetching latest release…")
	data, err := downloadWithProgress(url, func(pct int) {
		// map download 0–100 → progress 10–80
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
		_ = createDesktopShortcut(installDir, dest)
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
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	noWindow(cmd)
	return cmd.Run()
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
