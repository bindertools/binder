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

// GetChannel returns "dev" for development-channel builds, "stable" otherwise.
func (a *App) GetChannel() string {
	if IncludePrerelease {
		return "dev"
	}
	return "stable"
}

// Release describes a single GitHub release.
type Release struct {
	Version      string `json:"version"`
	Name         string `json:"name"`
	PublishedAt  string `json:"publishedAt"`
	Prerelease   bool   `json:"prerelease"`
	DownloadURL  string `json:"downloadURL"`
	ReleaseNotes string `json:"releaseNotes"`
}

// GetReleases fetches releases from GitHub, filtering by the build-time channel.
// On network or API errors it emits "installer:error" and returns nil.
func (a *App) GetReleases() []Release {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases", githubRepo)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		wailsruntime.EventsEmit(a.ctx, "installer:error", "Failed to build request: "+err.Error())
		return nil
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "cmdIDE-installer")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		wailsruntime.EventsEmit(a.ctx, "installer:error", "Network error: "+err.Error())
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		wailsruntime.EventsEmit(a.ctx, "installer:error",
			fmt.Sprintf("GitHub API returned %d", resp.StatusCode))
		return nil
	}

	var raw []struct {
		TagName     string `json:"tag_name"`
		Name        string `json:"name"`
		PublishedAt string `json:"published_at"`
		Prerelease  bool   `json:"prerelease"`
		Body        string `json:"body"`
		Assets      []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		wailsruntime.EventsEmit(a.ctx, "installer:error", "Failed to parse releases: "+err.Error())
		return nil
	}

	result := make([]Release, 0, len(raw))
	for _, r := range raw {
		// Skip pre-releases when the channel does not include them.
		if r.Prerelease && !IncludePrerelease {
			continue
		}

		// Find the Windows installer asset (without plugins).
		downloadURL := ""
		for _, asset := range r.Assets {
			if asset.Name == "cmdIDE-windows-amd64.exe" {
				downloadURL = asset.BrowserDownloadURL
				break
			}
		}
		// Fall back to the standard release URL pattern.
		if downloadURL == "" {
			downloadURL = fmt.Sprintf(
				"https://github.com/%s/releases/download/%s/cmdIDE-windows-amd64.exe",
				githubRepo, r.TagName,
			)
		}

		// Format the published date as YYYY-MM-DD.
		publishedAt := r.PublishedAt
		if len(publishedAt) >= 10 {
			publishedAt = publishedAt[:10]
		}

		result = append(result, Release{
			Version:      r.TagName,
			Name:         r.Name,
			PublishedAt:  publishedAt,
			Prerelease:   r.Prerelease,
			DownloadURL:  downloadURL,
			ReleaseNotes: r.Body,
		})
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

func (a *App) Install(version string, createDesktop bool, installPlugins bool) error {
	emit := func(pct int, msg string) {
		wailsruntime.EventsEmit(a.ctx, "install:progress", pct, msg)
		time.Sleep(80 * time.Millisecond)
	}
	emitError := func(msg string) {
		wailsruntime.EventsEmit(a.ctx, "installer:error", msg)
	}

	emit(5, "Preparing…")
	installDir := a.GetInstallDir()
	url := buildDownloadURL(version, installPlugins)

	emit(10, "Fetching release…")
	data, err := downloadWithProgress(url, func(pct int) {
		// Map download progress (0–100) into the 15–90 % band.
		wailsruntime.EventsEmit(a.ctx, "install:progress", 15+pct*75/100, "Downloading…")
	})
	if err != nil {
		emitError("Download failed: " + err.Error())
		return fmt.Errorf("download failed: %w", err)
	}

	emit(92, "Creating install directory…")
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		emitError("Could not create install directory: " + err.Error())
		return fmt.Errorf("could not create directory: %w", err)
	}

	emit(95, "Installing…")
	dest := filepath.Join(installDir, binaryName)
	if err := os.WriteFile(dest, data, 0o755); err != nil {
		emitError("Could not write executable: " + err.Error())
		return fmt.Errorf("could not write executable: %w", err)
	}

	emit(98, "Registering application…")
	if err := registerWithWindows(installDir, dest, version); err != nil {
		// Non-fatal — app still works without registry entries.
		_ = err
	}

	// Start Menu shortcut — always created so the app appears in the Start Menu.
	_ = createShortcut(dest, installDir, "StartMenu")
	// Desktop shortcut — optional.
	if createDesktop {
		_ = createShortcut(dest, installDir, "Desktop")
	}

	emit(100, "Installation complete")
	return nil
}

// registerWithWindows writes the uninstall registry key so the app appears in
// Settings → Apps and Control Panel → Programs and Features.
func registerWithWindows(installDir, exe, version string) error {
	uninstallPS := filepath.Join(installDir, "uninstall.ps1")

	// Write a small uninstall script next to the exe.
	uninstallScript := `# Command IDE uninstaller
$dir = $PSScriptRoot
# Remove registry entry
Remove-Item -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\cmdIDE' -Recurse -Force -ErrorAction SilentlyContinue
# Remove Start Menu shortcut
$sm = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('StartMenu'), 'Programs', 'Command IDE.lnk')
if (Test-Path $sm) { Remove-Item $sm -Force -ErrorAction SilentlyContinue }
# Remove Desktop shortcut
$desk = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'Command IDE.lnk')
if (Test-Path $desk) { Remove-Item $desk -Force -ErrorAction SilentlyContinue }
# Remove install directory
Start-Sleep -Milliseconds 500
Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
`
	if err := os.WriteFile(uninstallPS, []byte(uninstallScript), 0o644); err != nil {
		return fmt.Errorf("uninstall script: %w", err)
	}

	// Sanitise strings for embedding in PowerShell single-quoted strings.
	esc := func(s string) string {
		result := ""
		for _, c := range s {
			if c == '\'' {
				result += "''"
			} else {
				result += string(c)
			}
		}
		return result
	}

	displayVer := version
	if displayVer == "" || displayVer == "latest" {
		displayVer = "latest"
	}

	regScript := fmt.Sprintf(`
$p = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\cmdIDE'
New-Item -Path $p -Force | Out-Null
Set-ItemProperty -Path $p -Name 'DisplayName'     -Value 'Command IDE'
Set-ItemProperty -Path $p -Name 'DisplayVersion'  -Value '%s'
Set-ItemProperty -Path $p -Name 'Publisher'       -Value 'Command IDE'
Set-ItemProperty -Path $p -Name 'InstallLocation' -Value '%s'
Set-ItemProperty -Path $p -Name 'DisplayIcon'     -Value '%s,0'
Set-ItemProperty -Path $p -Name 'URLInfoAbout'    -Value 'https://github.com/Command-IDE/cmd-ide'
Set-ItemProperty -Path $p -Name 'UninstallString' -Value ('powershell.exe -NoProfile -NonInteractive -File "' + '%s' + '"')
Set-ItemProperty -Path $p -Name 'NoModify'        -Value 1 -Type DWord
Set-ItemProperty -Path $p -Name 'NoRepair'        -Value 1 -Type DWord
`,
		esc(displayVer),
		esc(installDir),
		esc(exe),
		esc(uninstallPS),
	)

	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", regScript)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
		HideWindow:    true,
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("registry: %w: %s", err, out)
	}
	return nil
}

// createShortcut creates a .lnk in either "Desktop" or "StartMenu\Programs".
// folder must be one of the special folder names recognised by
// [System.Environment]::GetFolderPath — "Desktop" or "StartMenu".
func createShortcut(exe, workDir, folder string) error {
	var linkName string
	var folderExpr string
	switch folder {
	case "StartMenu":
		linkName = "Command IDE.lnk"
		folderExpr = `[System.IO.Path]::Combine([System.Environment]::GetFolderPath('StartMenu'), 'Programs')`
	default: // Desktop
		linkName = "Command IDE.lnk"
		folderExpr = `[System.Environment]::GetFolderPath('Desktop')`
	}

	script := fmt.Sprintf(
		`$d = %s;`+
			`$s = New-Object -ComObject WScript.Shell;`+
			`$l = $s.CreateShortcut([System.IO.Path]::Combine($d, '%s'));`+
			`$l.TargetPath = '%s';`+
			`$l.WorkingDirectory = '%s';`+
			`$l.Save()`,
		folderExpr, linkName, exe, workDir,
	)

	// -Sta: COM automation (WScript.Shell) requires an STA apartment.
	// HideWindow: suppress console flash without CREATE_NO_WINDOW so STA pump works.
	cmd := exec.Command("powershell.exe", "-Sta", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("shortcut(%s): %w: %s", folder, err, out)
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
