package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"

	"terminal-ide/config"
	"terminal-ide/cppbridge"
	"terminal-ide/database"
	"terminal-ide/fullscreen"
	"terminal-ide/perf"
	"terminal-ide/plugins"
	"terminal-ide/ports"
	"terminal-ide/problems"
	"terminal-ide/search"
	"terminal-ide/session"

	term "github.com/Command-IDE/terminal/src"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx           context.Context
	terminals     map[string]*Terminal
	mu            sync.Mutex
	perfCancels   map[string]context.CancelFunc
	explorer      *fullscreen.Manager
	cpp           *cppbridge.Bridge
	UseCppBackend bool
	cppErr        string
}

func NewApp() *App {
	return &App{
		terminals:   make(map[string]*Terminal),
		perfCancels: make(map[string]context.CancelFunc),
		explorer:    fullscreen.New(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	config.Init()
	a.explorer.SetContext(ctx)
	go cleanupAfterUpdate() // remove .old / .update left by the rename-based updater

	if a.UseCppBackend {
		exePath, err := resolveCppBackend()
		if err != nil {
			log.Printf("cppbridge: cannot locate backend: %v", err)
			a.cppErr = err.Error()
			a.UseCppBackend = false
		} else {
			a.cpp = cppbridge.New()
			if err := a.cpp.Start(exePath); err != nil {
				log.Printf("cppbridge: Start failed: %v", err)
				a.cppErr = err.Error()
				a.cpp = nil
				a.UseCppBackend = false
			} else {
				log.Printf("cppbridge: started (%s)", exePath)
			}
		}
	}
}

// resolveCppBackend returns the path to cmdide-backend.exe, expected to sit
// alongside the app executable.
func resolveCppBackend() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	candidate := filepath.Join(filepath.Dir(exe), "cmdide-backend.exe")
	if _, err := os.Stat(candidate); err != nil {
		return "", fmt.Errorf("not found at %s", candidate)
	}
	return candidate, nil
}

func (a *App) domReady(ctx context.Context) {
	// bringToFront MUST come first — our process still holds the foreground
	// lock via the splash window at this point, so SetForegroundWindow succeeds.
	// Closing the splash first would release that lock before we can use it.
	bringToFront()
	closeSplash()
	wailsruntime.WindowExecJS(ctx, `
		(function() {
			window.addEventListener('keydown', function(e) {
				if (e.key === 'Tab') { e.preventDefault(); }
			}, true);
		})();
	`)
}

func (a *App) shutdown(_ context.Context) {
	if a.cpp != nil {
		a.cpp.Stop()
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for id, t := range a.terminals {
		t.Close()
		delete(a.terminals, id)
	}
	for _, cancel := range a.perfCancels {
		cancel()
	}
	a.explorer.Close()
}

// GetCppBackendStatus returns "enabled", "disabled", or "error: <msg>" for the debug info panel.
func (a *App) GetCppBackendStatus() string {
	if a.cppErr != "" {
		return "error: " + a.cppErr
	}
	if !a.UseCppBackend {
		return "disabled"
	}
	return "enabled"
}

// ─── Fullscreen Explorer ──────────────────────────────────────────────────────

func (a *App) ExplorerOpen(dir string) (fullscreen.FileNode, error) {
	return a.explorer.OpenDirectory(dir)
}

func (a *App) ExplorerGetTree() (fullscreen.FileNode, error) {
	return a.explorer.GetTree()
}

func (a *App) ExplorerGetFile(path string) (string, error) {
	return a.explorer.GetFileContent(path)
}

func (a *App) ExplorerSaveFile(path string, content string) error {
	return a.explorer.SaveFile(path, content)
}

func (a *App) ExplorerCreateFile(path string) error {
	return a.explorer.CreateFile(path)
}

func (a *App) ExplorerCreateDir(path string) error {
	return a.explorer.CreateDirectory(path)
}

func (a *App) ExplorerRename(oldPath string, newPath string) error {
	return a.explorer.Rename(oldPath, newPath)
}

func (a *App) ExplorerDelete(path string) error {
	return a.explorer.Delete(path)
}

func (a *App) ExplorerMove(src string, dest string) error {
	return a.explorer.MoveFile(src, dest)
}

func (a *App) ExplorerReveal(path string) error {
	native := filepath.FromSlash(path)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", native)
	case "darwin":
		cmd = exec.Command("open", native)
	default:
		cmd = exec.Command("xdg-open", native)
	}
	return cmd.Start()
}

// ─── Terminal management ──────────────────────────────────────────────────────

func (a *App) CreateTerminal(id string, initialCwd string) error {
	t := NewTerminal(a.ctx, id, initialCwd)
	a.mu.Lock()
	a.terminals[id] = t
	a.mu.Unlock()
	return nil
}

func (a *App) ExecuteCommand(id string, line string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if ok {
		go t.ExecuteCommand(line)
	}
}

func (a *App) InterruptCommand(id string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if ok {
		t.Interrupt()
	}
}

func (a *App) CloseTerminal(id string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	if ok {
		delete(a.terminals, id)
	}
	a.mu.Unlock()
	if ok {
		t.Close()
	}
}

func (a *App) GetTerminalCwd(id string) string {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if !ok {
		return ""
	}
	return t.cwd
}

func (a *App) SetTerminalCwd(id string, path string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if ok {
		t.SetCwd(path)
	}
}

func (a *App) TerminalInput(id string, data string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if ok {
		t.WriteInput(data)
	}
}

func (a *App) ResizeTerminal(id string, cols int, rows int) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if ok {
		t.Resize(cols, rows)
	}
}

// ─── File & editor ────────────────────────────────────────────────────────────

func (a *App) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

func (a *App) DeleteFile(path string) error { return os.Remove(path) }

func (a *App) GetFileLanguage(path string) string { return detectLanguage(path) }

// ExecSilent runs an arbitrary command in cwd, captures stdout, and never
// shows a console window on Windows. This is generic infrastructure — any
// plugin-driven feature can call it; the app has no knowledge of what is run.
func (a *App) ExecSilent(cwd string, name string, args []string) (string, error) {
	cmd := exec.Command(name, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	term.NoWindow(cmd)
	out, err := cmd.Output()
	return string(out), err
}

func (a *App) SelectDirectory() string {
	path, _ := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Select Directory",
	})
	return path
}

func (a *App) OpenNewWindow() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command(exe)
	term.NoWindow(cmd)
	cmd.Start() //nolint:errcheck
}

func (a *App) CtrlClickPath(id string, path string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if !ok {
		return
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(t.cwd, path)
	}
	path = filepath.Clean(path)

	info, err := os.Stat(path)
	if err != nil {
		return
	}

	if info.IsDir() {
		t.SetCwd(path)
		return
	}

	if database.IsDBFile(path) {
		wailsruntime.EventsEmit(t.ctx, "app:open-database", map[string]string{
			"path": path, "terminalId": id,
		})
		return
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return
	}
	wailsruntime.EventsEmit(t.ctx, "app:open-file", map[string]string{
		"path":       path,
		"content":    string(content),
		"language":   detectLanguage(path),
		"terminalId": id,
	})
}

// ─── Search ───────────────────────────────────────────────────────────────────

func (a *App) SearchFiles(id string, query string) []search.Result {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if !ok {
		return nil
	}
	return search.Files(t.cwd, query)
}

func (a *App) GetCompletions(id string, dir string, partial string) []string {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if !ok {
		return nil
	}
	return search.Completions(t.cwd, dir, partial)
}

// ─── Session ─────────────────────────────────────────────────────────────────

func (a *App) SaveSession(tabs []session.Tab) { session.Save(tabs) }

func (a *App) LoadSession() []session.Tab { return session.Load() }

// ─── Database ─────────────────────────────────────────────────────────────────

func (a *App) ReadDatabase(path string) (database.DBSchema, error) {
	return database.Read(path)
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

func (a *App) GetClipboardText() string {
	text, _ := wailsruntime.ClipboardGetText(a.ctx)
	return text
}

func (a *App) SetClipboardText(text string) {
	wailsruntime.ClipboardSetText(a.ctx, text)
}

// ─── Config ───────────────────────────────────────────────────────────────────

func (a *App) GetAppConfig() config.Config { return config.Get() }

func (a *App) SaveCustomTheme(colors map[string]string) error {
	c, err := config.ApplyCustomTheme(colors)
	if err != nil {
		return err
	}
	wailsruntime.EventsEmit(a.ctx, "app:config", c)
	return nil
}

func (a *App) SaveAppConfig(incoming config.Config) error {
	c, err := config.Apply(incoming)
	if err != nil {
		return err
	}
	wailsruntime.EventsEmit(a.ctx, "app:config", c)
	return nil
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

func (a *App) FetchExternalPlugin(githubURL string) (plugins.ExternalPluginInfo, error) {
	return plugins.Fetch(githubURL)
}

// ─── Ports ────────────────────────────────────────────────────────────────────

func (a *App) GetSystemPorts() []ports.PortInfo { return ports.GetActivePorts() }

func (a *App) KillPort(port string) (string, error) { return ports.KillPortProcess(port) }

// ─── Performance ──────────────────────────────────────────────────────────────

func (a *App) GetSystemPerf() perf.PerfData { return perf.CollectData() }

func (a *App) StartPerfMonitor(tabId string) {
	a.mu.Lock()
	if cancel, ok := a.perfCancels[tabId]; ok {
		cancel()
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.perfCancels[tabId] = cancel
	a.mu.Unlock()
	perf.StartMonitor(ctx, tabId, func(event string, data perf.PerfData) {
		wailsruntime.EventsEmit(a.ctx, event, data)
	})
}

func (a *App) StopPerfMonitor(tabId string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cancel, ok := a.perfCancels[tabId]; ok {
		cancel()
		delete(a.perfCancels, tabId)
	}
}

// ─── Problems ─────────────────────────────────────────────────────────────────

func (a *App) ScanProblems(cwd string) problems.ProbResult { return problems.Scan(cwd) }
