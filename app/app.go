package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

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

var cppSeq int64

type App struct {
	ctx           context.Context
	terminals     map[string]*Terminal
	mu            sync.Mutex
	perfCancels   map[string]context.CancelFunc
	explorer      *fullscreen.Manager
	cpp           *cppbridge.Bridge
	UseCppBackend bool
	cppErr        string
	cppRootDir    string // remembered for ExplorerGetTree delegation
}

func (a *App) cppID() string {
	return fmt.Sprintf("g%d", atomic.AddInt64(&cppSeq, 1))
}

// decodeB64Resp extracts the "content" field from a C++ IPC response and
// base64-decodes it back to a plain string for the frontend.
func decodeB64Resp(resp map[string]any) (string, error) {
	b64, _ := resp["content"].(string)
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// respToFileNode converts a C++ IPC response map into a fullscreen.FileNode
// by round-tripping through JSON (unknown fields such as "type"/"id" are ignored).
func respToFileNode(resp map[string]any) (fullscreen.FileNode, error) {
	b, err := json.Marshal(resp)
	if err != nil {
		return fullscreen.FileNode{}, err
	}
	var node fullscreen.FileNode
	return node, json.Unmarshal(b, &node)
}

// respOK returns the "ok" bool from a C++ IPC response.
func respOK(resp map[string]any) bool {
	ok, _ := resp["ok"].(bool)
	return ok
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
				a.initCppPreview()
				a.initCppPack()
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

// initCppPreview wires cppPreviewURLFunc so that localFileURL() delegates to
// the C++ cpp-httplib server. The server is started lazily on first use and
// the port is cached after that — no round-trip on every file open.
func (a *App) initCppPreview() {
	var (
		baseURL string
		once    sync.Once
	)
	cppPreviewURLFunc = func(absPath string) string {
		once.Do(func() {
			resp, err := a.cpp.RoundTrip(map[string]any{
				"type": "preview.start", "id": a.cppID(),
			}, 5000)
			if err == nil {
				baseURL, _ = resp["url"].(string)
			}
		})
		if baseURL == "" {
			return ""
		}
		// Construct the file URL the same way Go's localFileURL does:
		//   Windows: C:\Users\x\file.html → /C:/Users/x/file.html
		slashed := filepath.ToSlash(absPath)
		if runtime.GOOS == "windows" {
			slashed = "/" + slashed
		}
		return baseURL + slashed
	}
}

// initCppPack wires cppPackFunc so that builtinPack() delegates zip creation
// to the C++ libzip backend when UseCppBackend is true.
func (a *App) initCppPack() {
	cppPackFunc = func(sourcePath, outputPath string) (int, float64, error) {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type":       "pack.create",
			"id":         a.cppID(),
			"sourcePath": sourcePath,
			"outputPath": outputPath,
			"exclude":    []string{},
		}, 120000) // 2-minute timeout for large directories
		if err != nil {
			return 0, 0, err
		}
		if ok, _ := resp["ok"].(bool); !ok {
			errStr, _ := resp["error"].(string)
			return 0, 0, fmt.Errorf("%s", errStr)
		}
		fileCount, _ := resp["fileCount"].(float64)
		sizeMB, _ := resp["sizeMB"].(float64)
		return int(fileCount), sizeMB, nil
	}
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
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "fs.tree", "id": a.cppID(), "path": dir}, 30000)
		if err != nil {
			return fullscreen.FileNode{}, err
		}
		a.mu.Lock()
		a.cppRootDir = dir
		a.mu.Unlock()
		return respToFileNode(resp)
	}
	return a.explorer.OpenDirectory(dir)
}

func (a *App) ExplorerGetTree() (fullscreen.FileNode, error) {
	if a.UseCppBackend {
		a.mu.Lock()
		rootDir := a.cppRootDir
		a.mu.Unlock()
		if rootDir == "" {
			return fullscreen.FileNode{}, nil
		}
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "fs.tree", "id": a.cppID(), "path": rootDir}, 30000)
		if err != nil {
			return fullscreen.FileNode{}, err
		}
		return respToFileNode(resp)
	}
	return a.explorer.GetTree()
}

func (a *App) ExplorerGetFile(path string) (string, error) {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "fs.readfile", "id": a.cppID(), "path": path}, 30000)
		if err != nil {
			return "", err
		}
		return decodeB64Resp(resp)
	}
	return a.explorer.GetFileContent(path)
}

func (a *App) ExplorerSaveFile(path string, content string) error {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type":    "fs.writefile",
			"id":      a.cppID(),
			"path":    path,
			"content": base64.StdEncoding.EncodeToString([]byte(content)),
		}, 10000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("fs.writefile failed")
		}
		return nil
	}
	return a.explorer.SaveFile(path, content)
}

func (a *App) ExplorerCreateFile(path string) error {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "fs.create", "id": a.cppID(), "path": path}, 5000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("fs.create failed")
		}
		return nil
	}
	return a.explorer.CreateFile(path)
}

func (a *App) ExplorerCreateDir(path string) error {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "fs.mkdir", "id": a.cppID(), "path": path}, 5000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("fs.mkdir failed")
		}
		return nil
	}
	return a.explorer.CreateDirectory(path)
}

func (a *App) ExplorerRename(oldPath string, newPath string) error {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type": "fs.rename", "id": a.cppID(),
			"from": oldPath, "to": newPath,
		}, 5000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("fs.rename failed")
		}
		return nil
	}
	return a.explorer.Rename(oldPath, newPath)
}

func (a *App) ExplorerDelete(path string) error {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "fs.delete", "id": a.cppID(), "path": path}, 5000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("fs.delete failed")
		}
		return nil
	}
	return a.explorer.Delete(path)
}

func (a *App) ExplorerMove(src string, dest string) error {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type": "fs.rename", "id": a.cppID(),
			"from": src, "to": dest,
		}, 5000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("fs.rename failed")
		}
		return nil
	}
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
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "fs.readfile", "id": a.cppID(), "path": path}, 30000)
		if err != nil {
			return "", err
		}
		return decodeB64Resp(resp)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteFile(path string, content string) error {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type":    "fs.writefile",
			"id":      a.cppID(),
			"path":    path,
			"content": base64.StdEncoding.EncodeToString([]byte(content)),
		}, 10000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("fs.writefile failed")
		}
		return nil
	}
	return os.WriteFile(path, []byte(content), 0644)
}

func (a *App) DeleteFile(path string) error {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "fs.delete", "id": a.cppID(), "path": path}, 5000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("fs.delete failed")
		}
		return nil
	}
	return os.Remove(path)
}

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
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type": "search.query", "id": a.cppID(),
			"path": t.cwd, "query": query, "maxResults": 100,
		}, 30000)
		if err != nil {
			return search.Files(t.cwd, query)
		}
		raw, _ := resp["results"]
		b, _ := json.Marshal(raw)
		var results []search.Result
		if json.Unmarshal(b, &results) == nil {
			return results
		}
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
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type": "complete.path", "id": a.cppID(),
			"cwd": t.cwd, "dir": dir, "prefix": partial,
		}, 5000)
		if err != nil {
			return search.Completions(t.cwd, dir, partial)
		}
		raw, _ := resp["completions"]
		b, _ := json.Marshal(raw)
		var completions []string
		if json.Unmarshal(b, &completions) == nil {
			return completions
		}
		return nil
	}
	return search.Completions(t.cwd, dir, partial)
}

// ─── Session ─────────────────────────────────────────────────────────────────

func (a *App) SaveSession(tabs []session.Tab) {
	if a.UseCppBackend {
		b, _ := json.Marshal(tabs)
		a.cpp.RoundTrip(map[string]any{ //nolint:errcheck
			"type": "session.save", "id": a.cppID(),
			"sessionId": "default", "name": "", "tabs": json.RawMessage(b),
		}, 5000)
		return
	}
	session.Save(tabs)
}

func (a *App) LoadSession() []session.Tab {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type": "session.load", "id": a.cppID(), "sessionId": "default",
		}, 5000)
		if err == nil {
			if s, ok := resp["session"].(map[string]any); ok {
				if raw, ok2 := s["tabs"]; ok2 {
					b, _ := json.Marshal(raw)
					var tabs []session.Tab
					if json.Unmarshal(b, &tabs) == nil {
						return tabs
					}
				}
			}
		}
	}
	return session.Load()
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

func (a *App) GetAppConfig() config.Config {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "config.get", "id": a.cppID()}, 5000)
		if err != nil {
			return config.Get()
		}
		b, _ := json.Marshal(resp)
		var c config.Config
		if err := json.Unmarshal(b, &c); err != nil {
			return config.Get()
		}
		config.SetGlobal(c)
		return c
	}
	return config.Get()
}

func (a *App) SaveCustomTheme(colors map[string]string) error {
	if a.UseCppBackend {
		cur := config.Get()
		cur.CustomTheme = colors
		cur.Theme = "custom"
		b, _ := json.Marshal(cur)
		var configMap map[string]any
		json.Unmarshal(b, &configMap) //nolint:errcheck
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "config.setall", "id": a.cppID(), "config": configMap}, 5000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("config.setall failed")
		}
		config.SetGlobal(cur)
		wailsruntime.EventsEmit(a.ctx, "app:config", cur)
		return nil
	}
	c, err := config.ApplyCustomTheme(colors)
	if err != nil {
		return err
	}
	wailsruntime.EventsEmit(a.ctx, "app:config", c)
	return nil
}

func (a *App) SaveAppConfig(incoming config.Config) error {
	if a.UseCppBackend {
		b, _ := json.Marshal(incoming)
		var configMap map[string]any
		json.Unmarshal(b, &configMap) //nolint:errcheck
		resp, err := a.cpp.RoundTrip(
			map[string]any{"type": "config.setall", "id": a.cppID(), "config": configMap}, 5000)
		if err != nil {
			return err
		}
		if !respOK(resp) {
			return fmt.Errorf("config.setall failed")
		}
		config.SetGlobal(incoming)
		wailsruntime.EventsEmit(a.ctx, "app:config", incoming)
		return nil
	}
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

func (a *App) GetSystemPorts() []ports.PortInfo {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type": "sysinfo.ports", "id": a.cppID(),
		}, 10000)
		if err != nil {
			return ports.GetActivePorts()
		}
		raw, _ := resp["ports"]
		b, _ := json.Marshal(raw)
		var result []ports.PortInfo
		if json.Unmarshal(b, &result) == nil {
			return result
		}
	}
	return ports.GetActivePorts()
}

func (a *App) KillPort(port string) (string, error) { return ports.KillPortProcess(port) }

// ─── Performance ──────────────────────────────────────────────────────────────

func (a *App) GetSystemPerf() perf.PerfData {
	if a.UseCppBackend {
		resp, err := a.cpp.RoundTrip(map[string]any{
			"type": "sysinfo.perf", "id": a.cppID(),
		}, 10000)
		if err != nil {
			return perf.CollectData()
		}
		raw, _ := resp["perf"]
		b, _ := json.Marshal(raw)
		var result perf.PerfData
		if json.Unmarshal(b, &result) == nil {
			return result
		}
	}
	return perf.CollectData()
}

func (a *App) StartPerfMonitor(tabId string) {
	a.mu.Lock()
	if cancel, ok := a.perfCancels[tabId]; ok {
		cancel()
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.perfCancels[tabId] = cancel
	a.mu.Unlock()
	if a.UseCppBackend {
		// Drive the monitor loop ourselves, delegating each snapshot to C++.
		go func() {
			event := "perf:data:" + tabId
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					wailsruntime.EventsEmit(a.ctx, event, a.GetSystemPerf())
				}
			}
		}()
		return
	}
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
