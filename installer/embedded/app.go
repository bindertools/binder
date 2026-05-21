package main

import (
	"context"
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed assets/cmdIDE.exe
var appBinary []byte

type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) GetInstallDir() string {
	local, _ := os.UserCacheDir()
	return filepath.Join(local, "cmdIDE")
}

// GetReleases returns an empty slice — the embedded installer bundles a fixed version.
func (a *App) GetReleases() []string { return []string{} }

func (a *App) Install(version string, createShortcut bool, installPlugins bool) error {
	emit := func(pct int, msg string) {
		wailsruntime.EventsEmit(a.ctx, "install:progress", pct, msg)
		time.Sleep(100 * time.Millisecond)
	}

	emit(5, "Preparing…")
	installDir := a.GetInstallDir()

	emit(20, "Creating install directory…")
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return fmt.Errorf("could not create directory: %w", err)
	}

	emit(55, "Copying files…")
	dest := filepath.Join(installDir, "cmdIDE.exe")
	if err := os.WriteFile(dest, appBinary, 0o755); err != nil {
		return fmt.Errorf("could not write executable: %w", err)
	}

	if createShortcut {
		emit(80, "Creating desktop shortcut…")
		_ = a.createDesktopShortcut(installDir)
	}

	emit(95, "Finishing up…")
	time.Sleep(150 * time.Millisecond)
	emit(100, "Installation complete")
	return nil
}

func (a *App) createDesktopShortcut(installDir string) error {
	exe := filepath.Join(installDir, "cmdIDE.exe")
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
	exe := filepath.Join(a.GetInstallDir(), "cmdIDE.exe")
	cmd := exec.Command(exe)
	noWindow(cmd)
	_ = cmd.Start()
	time.Sleep(300 * time.Millisecond)
	wailsruntime.Quit(a.ctx)
}

func (a *App) CloseInstaller() { wailsruntime.Quit(a.ctx) }
