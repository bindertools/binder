// Removed in Phase 5: downloadUpdateFile (Go net/http download fallback)

//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// PerformUpdate downloads the requested version via the C++ WinHTTP backend,
// atomically replaces the running exe using Go file renames (no child process,
// no PowerShell), then launches the new binary and quits.
//
// Windows allows renaming a running exe; the file stays open by handle while
// the process runs, so the rename succeeds and the new exe can take the name.
// The .old file is cleaned up on the next launch by cleanupAfterUpdate.
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

	// Download alongside the exe (same volume = rename is always atomic).
	// Use a non-exe extension so Defender doesn't quarantine it on write.
	tmpPath := exePath + ".update"

	// Delegate the download to C++ (WinHTTP, supports HTTPS natively).
	resp, cerr := a.cpp.RoundTrip(map[string]any{
		"type": "updater.download", "id": a.cppID(),
		"url": downloadURL, "destPath": tmpPath,
	}, 300000) // 5-minute timeout for large downloads
	if cerr != nil {
		return fmt.Errorf("cpp download: %w", cerr)
	}
	if ok, _ := resp["ok"].(bool); !ok {
		errStr, _ := resp["error"].(string)
		return fmt.Errorf("download failed: %s", errStr)
	}

	// Rename current exe → .old (freeing the name), new file → current name.
	oldPath := exePath + ".old"
	_ = os.Remove(oldPath) // clean up any leftover from a prior update
	if err := os.Rename(exePath, oldPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("could not move current exe: %w", err)
	}
	if err := os.Rename(tmpPath, exePath); err != nil {
		_ = os.Rename(oldPath, exePath) // best-effort restore
		_ = os.Remove(tmpPath)
		return fmt.Errorf("could not install new exe: %w", err)
	}

	// Launch the updated binary. It is a GUI (Wails) app — no console appears.
	// DETACHED_PROCESS ensures it outlives this process cleanly.
	cmd := exec.Command(exePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008} // DETACHED_PROCESS
	if err := cmd.Start(); err != nil {
		// Restore old binary so the user can still run the app.
		_ = os.Rename(oldPath, exePath)
		return fmt.Errorf("could not launch updated exe: %w", err)
	}

	wailsruntime.Quit(a.ctx)
	return nil
}

// cleanupAfterUpdate removes <exe>.old left behind by the rename-based updater.
func cleanupAfterUpdate() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	_ = os.Remove(exe + ".old")
	_ = os.Remove(exe + ".update") // remove any interrupted download
}
