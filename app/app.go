package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// SessionTab is a minimal description of one open tab, persisted for soft-close.
type SessionTab struct {
	Type     string `json:"type"`                // "terminal" or "editor"
	FilePath string `json:"file_path,omitempty"` // editor tabs only
	Language string `json:"language,omitempty"`  // editor tabs only
	Cwd      string `json:"cwd,omitempty"`       // terminal tabs only
}

func sessionFilePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir, _ = os.UserHomeDir()
	}
	return filepath.Join(dir, "cmdIDE", "session.json")
}

// SaveSession persists the current tab list to disk (soft-close).
func (a *App) SaveSession(tabs []SessionTab) {
	data, err := json.MarshalIndent(tabs, "", "  ")
	if err != nil {
		return
	}
	// Ensure the directory exists (it should already, from config).
	_ = os.MkdirAll(filepath.Dir(sessionFilePath()), 0755)
	os.WriteFile(sessionFilePath(), data, 0644) //nolint:errcheck
}

// LoadSession reads the persisted tab list. Returns nil when none exists.
func (a *App) LoadSession() []SessionTab {
	data, err := os.ReadFile(sessionFilePath())
	if err != nil {
		return nil
	}
	var tabs []SessionTab
	if err := json.Unmarshal(data, &tabs); err != nil {
		return nil
	}
	return tabs
}

type App struct {
	ctx       context.Context
	terminals map[string]*Terminal
	mu        sync.Mutex
}

func NewApp() *App {
	return &App{terminals: make(map[string]*Terminal)}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	initConfig()
}

func (a *App) domReady(ctx context.Context) {
	// Inject a capture-phase Tab interceptor before React registers any listeners.
	// WebView2 handles Tab for native focus cycling at a level that can fire before
	// JavaScript events; calling preventDefault here prevents that native behaviour
	// so xterm's own handler (attachCustomKeyEventHandler) gets a clean shot at it.
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
}

// CreateTerminal starts a new shell session for the given tab ID.
// initialCwd, when non-empty, overrides the default starting directory.
func (a *App) CreateTerminal(id string, initialCwd string) error {
	t := NewTerminal(a.ctx, id, initialCwd)
	a.mu.Lock()
	a.terminals[id] = t
	a.mu.Unlock()
	return nil
}

// ExecuteCommand runs a command line entered by the user in the terminal tab.
func (a *App) ExecuteCommand(id string, line string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if ok {
		go t.ExecuteCommand(line)
	}
}

// InterruptCommand sends Ctrl+C to the running command in the terminal tab.
func (a *App) InterruptCommand(id string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if ok {
		t.Interrupt()
	}
}

// CloseTerminal tears down the shell session.
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

// ReadFile returns the text content of a file (used by the editor save path).
func (a *App) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteFile saves text content to a file.
func (a *App) WriteFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// GetFileLanguage returns the Monaco language ID for a file path.
func (a *App) GetFileLanguage(path string) string {
	return detectLanguage(path)
}

// GetClipboardText returns the current clipboard text for paste in the terminal.
func (a *App) GetClipboardText() string {
	text, _ := wailsruntime.ClipboardGetText(a.ctx)
	return text
}

// GetTerminalCwd returns the current working directory of a terminal session.
func (a *App) GetTerminalCwd(id string) string {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if !ok {
		return ""
	}
	return t.cwd
}

// SetTerminalCwd changes the working directory of a terminal session.
func (a *App) SetTerminalCwd(id string, path string) {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if ok {
		t.SetCwd(path)
	}
}

// SelectDirectory opens a native folder-picker dialog and returns the chosen path.
func (a *App) SelectDirectory() string {
	path, _ := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Select Directory",
	})
	return path
}

// GetAppConfig returns the current configuration.
func (a *App) GetAppConfig() Config {
	return getGlobalConfig()
}

// CtrlClickPath handles Ctrl+Click on a token in the terminal output.
// If the resolved path is a directory it cds the terminal into it and shows a
// new prompt; if it is a file it opens it in the editor. Silently no-ops when
// the path cannot be resolved.
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
		// cd into the directory and re-display the prompt
		t.SetCwd(path)
		return
	}

	// Database file → open in DB viewer
	if isDBFile(path) {
		wailsruntime.EventsEmit(t.ctx, "app:open-database", map[string]string{
			"path":       path,
			"terminalId": id,
		})
		return
	}

	// Regular file → open in editor
	content, err := os.ReadFile(path)
	if err != nil {
		return
	}
	lang := detectLanguage(path)
	wailsruntime.EventsEmit(t.ctx, "app:open-file", map[string]string{
		"path":       path,
		"content":    string(content),
		"language":   lang,
		"terminalId": id,
	})
}

// SaveCustomTheme persists a custom color map to config.json and sets the
// active theme to "custom". The frontend immediately receives an app:config
// event so the UI re-applies the new colors without a reload.
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

// SaveAppConfig persists updated application settings (all fields except
// CustomTheme, which is always preserved from the current in-memory config).
// Emits app:config so the frontend immediately reflects the new values.
func (a *App) SaveAppConfig(incoming Config) error {
	globalConfigMu.Lock()
	// Never let the frontend accidentally overwrite the saved custom colours.
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

// ScanProblems runs the code problem scanners against cwd and returns
// structured results — used by the frontend Problems tab rescan button.
func (a *App) ScanProblems(cwd string) ProbResult {
	return probScan(cwd)
}

// GetCompletions returns filesystem entries in `dir` (relative to the terminal's cwd)
// whose names start with `partial`, case-insensitively. Directories get a trailing slash.
func (a *App) GetCompletions(id string, dir string, partial string) []string {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if !ok {
		return nil
	}

	// Resolve the directory to read
	lookDir := t.cwd
	if dir != "" {
		// Normalise forward slashes from JS to OS separator
		dir = filepath.FromSlash(dir)
		if filepath.IsAbs(dir) {
			lookDir = filepath.Clean(dir)
		} else {
			lookDir = filepath.Clean(filepath.Join(t.cwd, dir))
		}
	}

	entries, err := os.ReadDir(lookDir)
	if err != nil {
		return nil
	}

	lowerPartial := strings.ToLower(partial)
	var matches []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if partial == "" || strings.HasPrefix(strings.ToLower(name), lowerPartial) {
			if e.IsDir() {
				matches = append(matches, name+"/")
			} else {
				matches = append(matches, name)
			}
		}
	}
	return matches
}
