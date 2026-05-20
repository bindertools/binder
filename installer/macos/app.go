//go:build darwin

package main

import (
	"archive/zip"
	"bytes"
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
	releaseURL        = "https://github.com/Command-IDE/cmd-ide/releases/latest/download/cmdIDE-darwin-arm64.zip"
	releaseURLPlugins = "https://github.com/Command-IDE/cmd-ide/releases/latest/download/cmdIDE-plugins-darwin-arm64.zip"
	appBundleName     = "cmdIDE.app"
)

type App struct{ ctx context.Context }

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) GetInstallDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Applications")
}

func (a *App) Install(createAlias bool, installPlugins bool) error {
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

	// Remove existing bundle before extracting
	_ = os.RemoveAll(filepath.Join(installDir, appBundleName))

	emit(88, "Installing…")
	if err := unzipBundle(data, installDir); err != nil {
		return fmt.Errorf("could not install app bundle: %w", err)
	}

	if createAlias {
		emit(94, "Creating symlink…")
		binPath := filepath.Join(installDir, appBundleName, "Contents", "MacOS", "cmdIDE")
		_ = createUsrLocalSymlink(binPath)
	}

	emit(100, "Installation complete")
	return nil
}

func unzipBundle(data []byte, destDir string) error {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, f := range r.File {
		dest := filepath.Join(destDir, f.Name) //nolint:gosec
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(dest, f.Mode())
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc) //nolint:gosec
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func createUsrLocalSymlink(exe string) error {
	link := "/usr/local/bin/cmdIDE"
	_ = os.Remove(link)
	return os.Symlink(exe, link)
}

func (a *App) LaunchAndClose() {
	appPath := filepath.Join(a.GetInstallDir(), appBundleName)
	cmd := exec.Command("open", appPath)
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
