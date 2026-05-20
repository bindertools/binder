package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"terminal-ide/database"
	"terminal-ide/fullscreen"
	"terminal-ide/perf"
	"terminal-ide/ports"
	"terminal-ide/problems"

	term "github.com/Command-IDE/terminal/src"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	terminals   map[string]*Terminal
	mu          sync.Mutex
	perfCancels map[string]context.CancelFunc
	explorer    *fullscreen.Manager
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
	initConfig()
	a.explorer.SetContext(ctx)
}

func (a *App) domReady(ctx context.Context) {
	wailsruntime.WindowExecJS(ctx, `
		(function() {
			window.addEventListener('keydown', function(e) {
				if (e.key === 'Tab') { e.preventDefault(); }
			}, true);
		})();
	`)
}

func (a *App) shutdown(_ context.Context) {
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

// CtrlClickPath handles Ctrl+Click on a token in the terminal output.
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

func (a *App) GetAppConfig() Config { return getGlobalConfig() }

func (a *App) SaveCustomTheme(colors map[string]string) error {
	globalConfigMu.Lock()
	globalConfig.CustomTheme = colors
	globalConfig.Theme = "custom"
	c := globalConfig
	globalConfigMu.Unlock()

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(configFilePath(), data, 0644); err != nil {
		return err
	}
	wailsruntime.EventsEmit(a.ctx, "app:config", c)
	return nil
}

func (a *App) SaveAppConfig(incoming Config) error {
	globalConfigMu.Lock()
	incoming.CustomTheme = globalConfig.CustomTheme
	globalConfig = incoming
	c := globalConfig
	globalConfigMu.Unlock()

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(configFilePath(), data, 0644); err != nil {
		return err
	}
	wailsruntime.EventsEmit(a.ctx, "app:config", c)
	return nil
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
