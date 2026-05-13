package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

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
	ctx         context.Context
	terminals   map[string]*Terminal
	mu          sync.Mutex
	perfCancels map[string]context.CancelFunc
}

func NewApp() *App {
	return &App{
		terminals:   make(map[string]*Terminal),
		perfCancels: make(map[string]context.CancelFunc),
	}
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
	for _, cancel := range a.perfCancels {
		cancel()
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

// SetClipboardText writes text to the system clipboard.
func (a *App) SetClipboardText(text string) {
	wailsruntime.ClipboardSetText(a.ctx, text)
}

// DeleteFile removes a file from the filesystem.
func (a *App) DeleteFile(path string) error {
	return os.Remove(path)
}

// OpenNewWindow launches a new independent instance of the app.
func (a *App) OpenNewWindow() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command(exe)
	noWindow(cmd)
	cmd.Start() //nolint:errcheck
}

// ─── Ports ────────────────────────────────────────────────────────────────────

// GetSystemPorts returns the list of currently active network ports.
func (a *App) GetSystemPorts() []PortInfo {
	return getActivePorts()
}

// KillPort kills the process(es) listening on the given port number string.
func (a *App) KillPort(port string) (string, error) {
	return killPortProcess(port)
}

// ─── Performance ──────────────────────────────────────────────────────────────

// GetSystemPerf returns a single snapshot of host performance metrics.
func (a *App) GetSystemPerf() PerfData {
	return collectPerfData()
}

// StartPerfMonitor begins streaming perf:data:{tabId} events every second.
func (a *App) StartPerfMonitor(tabId string) {
	a.mu.Lock()
	if cancel, ok := a.perfCancels[tabId]; ok {
		cancel()
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.perfCancels[tabId] = cancel
	a.mu.Unlock()
	startPerfMonitor(ctx, tabId)
}

// StopPerfMonitor stops streaming perf events for the given tab.
func (a *App) StopPerfMonitor(tabId string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cancel, ok := a.perfCancels[tabId]; ok {
		cancel()
		delete(a.perfCancels, tabId)
	}
}

// ─── File Search ──────────────────────────────────────────────────────────────

// SearchResult represents a single file search hit.
type SearchResult struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Content string `json:"content"`
	IsName  bool   `json:"is_name"`
}

// SearchFiles searches files in the terminal's cwd for the given query.
func (a *App) SearchFiles(id string, query string) []SearchResult {
	a.mu.Lock()
	t, ok := a.terminals[id]
	a.mu.Unlock()
	if !ok || query == "" {
		return nil
	}

	queryLower := strings.ToLower(query)
	var results []SearchResult
	limit := 100

	filepath.Walk(t.cwd, func(path string, info os.FileInfo, err error) error { //nolint:errcheck
		if err != nil || len(results) >= limit {
			return nil
		}
		base := filepath.Base(path)
		if strings.HasPrefix(base, ".") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if info.IsDir() {
			for _, skip := range []string{"node_modules", "vendor", ".git", "dist", "build", "__pycache__"} {
				if base == skip {
					return filepath.SkipDir
				}
			}
			return nil
		}

		rel, _ := filepath.Rel(t.cwd, path)
		rel = filepath.ToSlash(rel)

		if strings.Contains(strings.ToLower(base), queryLower) {
			results = append(results, SearchResult{Path: rel, IsName: true})
			return nil
		}

		if info.Size() > 1<<20 {
			return nil
		}
		if isBinaryPath(path) {
			return nil
		}

		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()

		lineNum := 0
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			lineNum++
			if len(results) >= limit {
				break
			}
			line := scanner.Text()
			if strings.Contains(strings.ToLower(line), queryLower) {
				content := strings.TrimSpace(line)
				if len(content) > 120 {
					content = content[:120] + "…"
				}
				results = append(results, SearchResult{
					Path:    rel,
					Line:    lineNum,
					Content: content,
					IsName:  false,
				})
			}
		}
		return nil
	})
	return results
}

// isBinaryPath returns true for known binary file extensions.
func isBinaryPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	for _, b := range []string{
		".exe", ".dll", ".so", ".dylib", ".bin", ".obj", ".o", ".a",
		".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp",
		".zip", ".tar", ".gz", ".rar", ".7z",
		".pdf", ".doc", ".docx", ".xls", ".xlsx",
		".mp3", ".mp4", ".wav", ".avi", ".mov",
		".wasm", ".node",
	} {
		if ext == b {
			return true
		}
	}
	return false
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

// ── External plugin fetcher ───────────────────────────────────────────────────

// ExternalPluginInfo holds metadata and the bundled JS for an external plugin.
type ExternalPluginInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Author      string `json:"author"`
	Version     string `json:"version"`
	Code        string `json:"code"`
}

// FetchExternalPlugin downloads a plugin from a public GitHub repository.
// It expects the repo to have a package.json at root and a compiled
// dist/index.js (or index.js) ESM bundle that exports a Plugin as default.
func (a *App) FetchExternalPlugin(githubURL string) (ExternalPluginInfo, error) {
	u, err := url.Parse(strings.TrimSpace(githubURL))
	if err != nil || u.Host != "github.com" {
		return ExternalPluginInfo{}, fmt.Errorf("not a valid GitHub URL")
	}

	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return ExternalPluginInfo{}, fmt.Errorf("URL must point to a repository: github.com/owner/repo")
	}
	owner, repo := parts[0], parts[1]

	// Try main branch first, then master
	var rawBase string
	for _, branch := range []string{"main", "master"} {
		base := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", owner, repo, branch)
		if _, testErr := httpFetch(base + "/package.json"); testErr == nil {
			rawBase = base
			break
		}
	}
	if rawBase == "" {
		return ExternalPluginInfo{}, fmt.Errorf("could not reach repository (tried main and master branches)")
	}

	// Parse package.json for metadata
	pkgBody, err := httpFetch(rawBase + "/package.json")
	if err != nil {
		return ExternalPluginInfo{}, fmt.Errorf("could not fetch package.json: %w", err)
	}
	var pkg struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Author      interface{} `json:"author"` // string or {"name":"..."}
		Version     string `json:"version"`
		PluginID    string `json:"pluginId"`
	}
	if err := json.Unmarshal([]byte(pkgBody), &pkg); err != nil {
		return ExternalPluginInfo{}, fmt.Errorf("invalid package.json: %w", err)
	}

	// Resolve author field (can be a string or an object with "name")
	authorStr := ""
	switch v := pkg.Author.(type) {
	case string:
		authorStr = v
	case map[string]interface{}:
		if n, ok := v["name"].(string); ok {
			authorStr = n
		}
	}

	// Fetch the plugin bundle — try dist/index.js then index.js
	var code string
	for _, path := range []string{"/dist/index.js", "/index.js"} {
		code, err = httpFetch(rawBase + path)
		if err == nil {
			break
		}
	}
	if code == "" {
		return ExternalPluginInfo{}, fmt.Errorf("no plugin bundle found (tried dist/index.js and index.js)")
	}

	id := pkg.PluginID
	if id == "" {
		id = repo
	}
	name := pkg.Name
	if name == "" {
		name = repo
	}

	return ExternalPluginInfo{
		ID:          id,
		Name:        name,
		Description: pkg.Description,
		Author:      authorStr,
		Version:     pkg.Version,
		Code:        code,
	}, nil
}

func httpFetch(fetchURL string) (string, error) {
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(fetchURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d for %s", resp.StatusCode, fetchURL)
	}
	body, err := io.ReadAll(resp.Body)
	return string(body), err
}
