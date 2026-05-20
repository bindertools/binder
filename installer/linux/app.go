//go:build linux

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
	releaseURL        = "https://github.com/Command-IDE/cmd-ide/releases/latest/download/cmdIDE-linux-amd64"
	releaseURLPlugins = "https://github.com/Command-IDE/cmd-ide/releases/latest/download/cmdIDE-plugins-linux-amd64"
	binaryName        = "cmdIDE"
)

type App struct{ ctx context.Context }

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) GetInstallDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "bin")
}

func (a *App) Install(createDesktopEntry bool, installPlugins bool) error {
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

	if createDesktopEntry {
		emit(94, "Creating desktop entry…")
		_ = createDesktopFile(dest)
	}

	emit(100, "Installation complete")
	return nil
}

func createDesktopFile(exe string) error {
	home, _ := os.UserHomeDir()
	desktopDir := filepath.Join(home, ".local", "share", "applications")
	if err := os.MkdirAll(desktopDir, 0o755); err != nil {
		return err
	}
	content := fmt.Sprintf("[Desktop Entry]\nName=cmdIDE\nExec=%s\nType=Application\nCategories=Development;\n", exe)
	return os.WriteFile(filepath.Join(desktopDir, "cmdIDE.desktop"), []byte(content), 0o644)
}

func (a *App) LaunchAndClose() {
	exe := filepath.Join(a.GetInstallDir(), binaryName)
	cmd := exec.Command(exe)
	_ = cmd.Start()
	time.Sleep(300 * time.Millisecond)
	wailsruntime.Quit(a.ctx)
}

func (a *App) CloseInstaller() { wailsruntime.Quit(a.ctx) }

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
