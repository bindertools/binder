package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

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

func (a *App) domReady(_ context.Context)  {}
func (a *App) shutdown(_ context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for id, t := range a.terminals {
		t.Close()
		delete(a.terminals, id)
	}
}

// CreateTerminal starts a new shell session for the given tab ID.
func (a *App) CreateTerminal(id string) error {
	t := NewTerminal(a.ctx, id)
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
