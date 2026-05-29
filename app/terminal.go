// Removed in Phase 5: execExternal, execExternalWindows, execExternalPTY,
// normNewlines, shouldUsePTY, windowsShellPath

package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"terminal-ide/config"
	"terminal-ide/database"
	"terminal-ide/pack"
	"terminal-ide/ports"
	"terminal-ide/problems"

	powershell "github.com/Command-IDE/powershell/src"
	term "github.com/Command-IDE/terminal/src"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// cppPackFunc, when non-nil, delegates zip creation to the C++ backend.
// Receives (sourcePath, outputPath); returns (fileCount, sizeMB, error).
var cppPackFunc func(sourcePath, outputPath string) (int, float64, error)

type Terminal struct {
	id        string
	cwd       string
	ctx       context.Context
	mu        sync.Mutex
	process   *os.Process    // non-nil while an external command is running
	stdinPipe io.WriteCloser // subprocess stdin; non-nil when process != nil
}

func NewTerminal(ctx context.Context, id string, initialCwd string) *Terminal {
	dir := term.DefaultDir(config.Get().DefaultDirectory)
	if initialCwd != "" {
		if info, err := os.Stat(initialCwd); err == nil && info.IsDir() {
			dir = initialCwd
		}
	}
	t := &Terminal{id: id, cwd: dir, ctx: ctx}
	go t.write(t.prompt())
	return t
}

// emitCwd broadcasts the current working directory to the frontend bar.
func (t *Terminal) emitCwd() {
	wailsruntime.EventsEmit(t.ctx, "terminal:cwd:"+t.id, t.cwd)
}

// changeCwd updates cwd and notifies the frontend; returns false if invalid.
func (t *Terminal) changeCwd(target string) bool {
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		return false
	}
	t.cwd = target
	t.emitCwd()
	return true
}

// SetCwd is called when the user picks a directory via the folder dialog.
func (t *Terminal) SetCwd(path string) {
	if t.changeCwd(path) {
		t.write("\r\n")
		t.write(t.prompt())
	}
}

// write emits a string to this terminal's xterm instance in the frontend.
func (t *Terminal) write(s string) {
	wailsruntime.EventsEmit(t.ctx, "terminal:output:"+t.id, s)
}

// getGitBranch returns the current branch name when cwd is inside a git repo,
// or an empty string when it is not (or when git is not available).
func (t *Terminal) getGitBranch() string {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = t.cwd
	term.NoWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// prompt builds the styled prompt, optionally prefixing a timestamp and/or
// appending the current git branch, based on the active config.
func (t *Terminal) prompt() string {
	cfg := config.Get()
	home, _ := os.UserHomeDir()
	dir := t.cwd
	if rel, err := filepath.Rel(home, dir); err == nil && !strings.HasPrefix(rel, "..") {
		dir = "~/" + rel
	}
	dir = filepath.ToSlash(dir)

	// minimal_pwd: keep only the last 2 path segments for a cleaner prompt.
	if cfg.MinimalPwd {
		parts := strings.Split(dir, "/")
		var segs []string
		for _, p := range parts {
			if p != "" {
				segs = append(segs, p)
			}
		}
		if len(segs) > 2 {
			dir = strings.Join(segs[len(segs)-2:], "/")
		}
	}

	var sb strings.Builder
	sb.WriteString("\r\n")

	// Optional timestamp — (hh:mm:ss)
	if cfg.ShowTimestamps {
		now := time.Now()
		sb.WriteString(fmt.Sprintf("\x1b[38;5;246m(%02d:%02d:%02d)\x1b[0m ", now.Hour(), now.Minute(), now.Second()))
	}

	// Current directory
	sb.WriteString("\x1b[38;5;75m" + dir + "\x1b[0m")

	// Optional git branch — (branch-name) in orange
	if cfg.GitRecognition.ShowGitBranch {
		if branch := t.getGitBranch(); branch != "" {
			sb.WriteString(" \x1b[38;5;214m(" + branch + ")\x1b[0m")
		}
	}

	sb.WriteString(" \x1b[38;5;246m❯\x1b[0m ")
	return sb.String()
}

// ExecuteCommand is called from the frontend when the user presses Enter.
// Built-in commands (cd, ls, /pack, /config, etc.) are handled in Go.
// External commands are handled by the C++ terminal backend.
func (t *Terminal) ExecuteCommand(line string) {
	line = strings.TrimSpace(line)
	if line == "" {
		t.write(t.prompt())
		return
	}

	parts := parseArgs(line)
	if len(parts) == 0 {
		t.write(t.prompt())
		return
	}

	raw := parts[0]
	isSlash := strings.HasPrefix(raw, "/")
	cmd := strings.TrimPrefix(raw, "/")

	// Standard built-ins — work with or without a leading slash.
	switch cmd {
	case "cd":
		t.builtinCD(parts[1:])
		return
	case "clear", "cls":
		t.write("\x1b[2J\x1b[H")
		t.write(t.prompt())
		return
	case "pwd":
		t.write("\r\n" + filepath.ToSlash(t.cwd))
		t.write(t.prompt())
		return
	case "ls", "ll", "la":
		t.builtinLS(parts)
		return
	case "open":
		t.builtinOpen(parts[1:])
		return
	}

	// App-specific commands — require the "/" prefix.
	if isSlash {
		switch cmd {
		case "themes":
			t.builtinThemes()
		case "config":
			if len(parts) > 1 && parts[1] == "--reload" {
				t.builtinConfigReload()
			} else if len(parts) > 1 && parts[1] == "--reset" {
				t.builtinConfigReset()
			} else if len(parts) > 1 && parts[1] == "--raw" {
				t.builtinConfigRaw()
			} else {
				t.builtinConfigOpen()
			}
		case "help":
			t.builtinHelp()
		case "preview":
			t.builtinPreview(parts[1:])
		case "problems":
			t.builtinProblems()
		case "version":
			t.builtinVersion()
		case "debug":
			t.builtinDebug()
		case "kill":
			t.builtinKill(parts[1:])
		case "explorer":
			t.builtinExplorer()
		case "pack":
			t.builtinPack(parts[1:])
		case "ports":
			wailsruntime.EventsEmit(t.ctx, "app:open-tab", map[string]interface{}{
				"type": "ports", "title": "ports", "terminalId": t.id,
			})
			t.write("\r\n\x1b[38;5;246mopening ports monitor\x1b[0m")
			t.write(t.prompt())
		case "performance", "perf":
			wailsruntime.EventsEmit(t.ctx, "app:open-tab", map[string]interface{}{
				"type": "perf", "title": "performance", "terminalId": t.id,
			})
			t.write("\r\n\x1b[38;5;246mopening performance monitor\x1b[0m")
			t.write(t.prompt())
		case "plugins":
			wailsruntime.EventsEmit(t.ctx, "app:open-tab", map[string]interface{}{
				"type": "plugins", "title": "plugins", "terminalId": t.id,
			})
			t.write("\r\n\x1b[38;5;246mopening plugin store\x1b[0m")
			t.write(t.prompt())
		case "fullscreen", "fs":
			wailsruntime.EventsEmit(t.ctx, "app:open-tab", map[string]interface{}{
				"type": "fullscreen", "title": "explorer", "terminalId": t.id, "cwd": t.cwd,
			})
			t.write("\r\n\x1b[38;5;246mopening explorer\x1b[0m")
			t.write(t.prompt())
		}
	}
	// Non-built-in commands: run as a subprocess through the system shell.
	go t.execExternalCmd(line)
}

// Interrupt sends SIGINT to the running subprocess and its entire process tree.
func (t *Terminal) Interrupt() {
	t.mu.Lock()
	proc := t.process
	t.mu.Unlock()
	if proc != nil {
		killTree(proc.Pid)
	}
}

// Close kills any running subprocess when the terminal tab is closed.
func (t *Terminal) Close() { t.Interrupt() }

// WriteInput pipes raw bytes to the running subprocess's stdin (e.g. for
// interactive programs that read from stdin in PTY passthrough mode).
func (t *Terminal) WriteInput(data string) {
	t.mu.Lock()
	pipe := t.stdinPipe
	t.mu.Unlock()
	if pipe != nil {
		_, _ = pipe.Write([]byte(data))
	}
}

// Resize is a no-op — the C++ terminal backend handles PTY resize directly.
func (t *Terminal) Resize(_, _ int) {}

// normNewlines converts bare \n to \r\n so xterm renders output correctly when
// piping process output without a ConPTY layer in between.
func normNewlines(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 32)
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' && (i == 0 || s[i-1] != '\r') {
			b.WriteByte('\r')
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

// execExternalCmd runs line through the configured system shell, streaming
// combined stdout+stderr into xterm and emitting PTY lifecycle events so the
// frontend enters/exits passthrough mode for the duration of the command.
func (t *Terminal) execExternalCmd(line string) {
	cmd := powershell.BuildShellCmdWithPref(line, config.Get().PreferredShell)
	cmd.Dir = t.cwd
	cmd.Env = liveEnv()
	term.NoWindow(cmd)

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		t.write("\r\n\x1b[31merror: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}

	// Merge stdout + stderr on a single pipe — read in one goroutine.
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		_ = stdinPipe.Close()
		_ = pw.Close()
		_ = pr.Close()
		t.write("\r\n\x1b[31merror: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}

	t.mu.Lock()
	t.process = cmd.Process
	t.stdinPipe = stdinPipe
	t.mu.Unlock()

	// Enter PTY passthrough mode — frontend forwards raw keystrokes via TerminalInput.
	wailsruntime.EventsEmit(t.ctx, "terminal:pty:start:"+t.id)

	// Forward subprocess output to xterm.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := pr.Read(buf)
			if n > 0 {
				t.write(normNewlines(string(buf[:n])))
			}
			if err != nil {
				break
			}
		}
	}()

	// Wait for subprocess to exit, then restore normal terminal state.
	go func() {
		_ = cmd.Wait()
		_ = pw.Close() // EOF → reader goroutine exits

		t.mu.Lock()
		t.process = nil
		_ = t.stdinPipe.Close()
		t.stdinPipe = nil
		t.mu.Unlock()

		wailsruntime.EventsEmit(t.ctx, "terminal:pty:end:"+t.id)
		t.write(t.prompt())
	}()
}

// ─── built-in commands ────────────────────────────────────────────────────────

func (t *Terminal) builtinCD(args []string) {
	var target string
	if len(args) == 0 {
		target, _ = os.UserHomeDir()
	} else {
		target = args[0]
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(t.cwd, target)
	}
	target = filepath.Clean(target)

	if !t.changeCwd(target) {
		t.write("\r\n\x1b[31mcd: " + target + ": no such directory\x1b[0m")
	}
	t.write(t.prompt())
}

func (t *Terminal) builtinLS(parts []string) {
	dir := t.cwd
	showHidden := true
	for _, p := range parts[1:] {
		switch {
		case strings.HasPrefix(p, "-"):
			if strings.Contains(p, "a") {
				showHidden = true
			}
		case filepath.IsAbs(p):
			dir = p
		default:
			dir = filepath.Join(t.cwd, p)
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.write("\r\n\x1b[31mls: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}

	var sb strings.Builder
	sb.WriteString("\r\n")

	if config.Get().OrderDirectory {
		// Folders first A-Z, then files A-Z, one per line
		var dirs, files []os.DirEntry
		for _, e := range entries {
			if !showHidden && strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if e.IsDir() {
				dirs = append(dirs, e)
			} else {
				files = append(files, e)
			}
		}
		sort.Slice(dirs, func(i, j int) bool {
			return strings.ToLower(dirs[i].Name()) < strings.ToLower(dirs[j].Name())
		})
		sort.Slice(files, func(i, j int) bool {
			return strings.ToLower(files[i].Name()) < strings.ToLower(files[j].Name())
		})
		for _, e := range dirs {
			sb.WriteString("\x1b[38;5;75m" + e.Name() + "/\x1b[0m\r\n")
		}
		for _, e := range files {
			sb.WriteString(colorFile(e.Name()) + "\r\n")
		}
	} else {
		// Default: compact grid, 6 per row
		col := 0
		for _, e := range entries {
			name := e.Name()
			if !showHidden && strings.HasPrefix(name, ".") {
				continue
			}
			if e.IsDir() {
				sb.WriteString("\x1b[38;5;75m" + name + "/\x1b[0m  ")
			} else {
				sb.WriteString(colorFile(name) + "  ")
			}
			col++
			if col%6 == 0 {
				sb.WriteString("\r\n")
			}
		}
	}

	t.write(sb.String())
	t.write(t.prompt())
}

// availableThemes lists every theme key defined in frontend/src/themes.ts.
var availableThemes = []string{"dark", "blackout", "dim-green", "dim-blue"}

func (t *Terminal) builtinThemes() {
	var sb strings.Builder
	sb.WriteString("\r\n\x1b[38;5;75mAvailable themes\x1b[0m\r\n")
	for _, name := range availableThemes {
		sb.WriteString("  \x1b[38;5;246m•\x1b[0m " + name + "\r\n")
	}
	sb.WriteString("\r\n\x1b[38;5;246mTo apply: run \x1b[38;5;75m/config\x1b[38;5;246m and select from the theme dropdown\x1b[0m")
	t.write(sb.String())
	t.write(t.prompt())
}

func (t *Terminal) builtinVersion() {
	var sb strings.Builder
	sb.WriteString("\r\n")
	sb.WriteString("  \x1b[1m\x1b[38;5;75mCommand\x1b[38;5;33m IDE\x1b[0m")
	sb.WriteString("  \x1b[38;5;246m" + AppVersion + "\x1b[0m\r\n\r\n")
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-12s\x1b[0m  \x1b[38;5;253m%s\x1b[0m\r\n", "Go", goruntime.Version()))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-12s\x1b[0m  \x1b[38;5;253m%s\x1b[0m\r\n", "Wails", "v2.12.0"))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-12s\x1b[0m  \x1b[38;5;253m%s/%s\x1b[0m\r\n", "Platform", goruntime.GOOS, goruntime.GOARCH))
	t.write(sb.String())
	t.write(t.prompt())
}

func (t *Terminal) builtinHelp() {
	type entry struct{ name, desc string }

	appCmds := []entry{
		{"/config", "open settings & theme UI"},
		{"/config --raw", "open config.json in the editor"},
		{"/config --reload", "reload config from disk"},
		{"/config --reset", "reset config to default settings"},
		{"/themes", "list available preset theme names"},
		{"/preview <file|url>", "preview .md/.html or a URL/port"},
		{"/problems", "scan project for errors, opens a tab"},
		{"/debug", "show OS, shell, config, git info"},
		{"/kill <port>", "kill process(es) on a port"},
		{"/explorer", "open native file explorer here"},
		{"/pack [--dryrun]", "zip current directory"},
		{"/ports", "open active ports monitor tab"},
		{"/performance", "open performance monitor tab"},
		{"/fullscreen", "open fullscreen IDE explorer for current directory"},
		{"/plugins", "open plugin store"},
		{"/version", "show app and runtime version info"},
		{"/help", "show this help"},
	}
	stdCmds := []entry{
		{"cd <dir>", "change the working directory"},
		{"ls [dir] [-a]", "list directory contents"},
		{"pwd", "print working directory"},
		{"clear / cls", "clear the terminal screen"},
		{"open <file>", "open a file in the editor"},
	}

	var sb strings.Builder
	sb.WriteString("\r\n\x1b[38;5;75mApp commands\x1b[0m \x1b[38;5;246m(require /)\x1b[0m\r\n\r\n")
	for _, e := range appCmds {
		sb.WriteString(fmt.Sprintf("  \x1b[38;5;214m%-22s\x1b[0m \x1b[38;5;246m%s\x1b[0m\r\n", e.name, e.desc))
	}
	sb.WriteString("\r\n\x1b[38;5;75mBuilt-in terminal commands\x1b[0m\r\n\r\n")
	for _, e := range stdCmds {
		sb.WriteString(fmt.Sprintf("  \x1b[38;5;114m%-22s\x1b[0m \x1b[38;5;246m%s\x1b[0m\r\n", e.name, e.desc))
	}
	t.write(sb.String())
	t.write(t.prompt())
}

// builtinConfigOpen opens the unified Settings & Theme UI tab.
func (t *Terminal) builtinConfigOpen() {
	wailsruntime.EventsEmit(t.ctx, "app:open-config", map[string]string{"terminalId": t.id})
	t.write("\r\n\x1b[38;5;246mopening settings\x1b[0m")
	t.write(t.prompt())
}

// builtinConfigRaw opens config.json directly in the editor (old /config behaviour).
func (t *Terminal) builtinConfigRaw() {
	if err := config.Ensure(); err != nil {
		t.write("\r\n\x1b[31mconfig: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}
	path := config.FilePath()
	content, err := os.ReadFile(path)
	if err != nil {
		t.write("\r\n\x1b[31mconfig: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}
	t.write("\r\n\x1b[38;5;246mopening config.json\x1b[0m")
	wailsruntime.EventsEmit(t.ctx, "app:open-file", map[string]string{
		"path":       path,
		"content":    string(content),
		"language":   "json",
		"terminalId": t.id,
	})
	t.write(t.prompt())
}

func (t *Terminal) builtinConfigReset() {
	if err := config.Reset(); err != nil {
		t.write("\r\n\x1b[31mconfig: reset failed: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}
	if err := config.Reload(); err != nil {
		t.write("\r\n\x1b[31mconfig: reload failed after reset: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}
	wailsruntime.EventsEmit(t.ctx, "app:config", config.Get())
	t.write("\r\n\x1b[38;5;75mconfig reset to defaults\x1b[0m")
	t.write(t.prompt())
}

func (t *Terminal) builtinConfigReload() {
	if err := config.Reload(); err != nil {
		t.write("\r\n\x1b[31mconfig: reload failed: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}
	wailsruntime.EventsEmit(t.ctx, "app:config", config.Get())
	t.write("\r\n\x1b[38;5;75mconfig reloaded\x1b[0m")
	t.write(t.prompt())
}

func colorFile(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs":
		return "\x1b[38;5;114m" + name + "\x1b[0m"
	case ".py", ".rb", ".lua", ".rs", ".java", ".cs", ".cpp", ".c", ".h":
		return "\x1b[38;5;215m" + name + "\x1b[0m"
	case ".json", ".yaml", ".yml", ".toml", ".env":
		return "\x1b[38;5;221m" + name + "\x1b[0m"
	case ".md", ".txt", ".rst":
		return "\x1b[38;5;250m" + name + "\x1b[0m"
	case ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".exe":
		return "\x1b[38;5;203m" + name + "\x1b[0m"
	case ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp":
		return "\x1b[38;5;183m" + name + "\x1b[0m"
	default:
		return name
	}
}

func (t *Terminal) builtinDebug() {
	cfg := config.Get()
	shell := os.Getenv("SHELL")
	if shell == "" {
		if goruntime.GOOS == "windows" {
			shell = "powershell.exe"
		} else {
			shell = "/bin/sh"
		}
	}
	branch := t.getGitBranch()
	if branch == "" {
		branch = "(not a git repo)"
	}

	var sb strings.Builder
	sb.WriteString("\r\n\x1b[38;5;75mDebug Info\x1b[0m\r\n\r\n")
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%s/%s\x1b[0m\r\n", "OS", goruntime.GOOS, goruntime.GOARCH))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%s\x1b[0m\r\n", "Shell", shell))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%s\x1b[0m\r\n", "Go", goruntime.Version()))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%s\x1b[0m\r\n", "CWD", filepath.ToSlash(t.cwd)))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%s\x1b[0m\r\n", "Git branch", branch))
	sb.WriteString("\r\n\x1b[38;5;75mConfig\x1b[0m\r\n\r\n")
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%s\x1b[0m\r\n", "theme", cfg.Theme))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%v\x1b[0m\r\n", "indent_guides", cfg.IndentGuides))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%v\x1b[0m\r\n", "minimap", cfg.Minimap))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%v\x1b[0m\r\n", "show_timestamps", cfg.ShowTimestamps))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%v\x1b[0m\r\n", "git_branch", cfg.GitRecognition.ShowGitBranch))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%v\x1b[0m\r\n", "terminal_word_wrap", cfg.TerminalWordWrap))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%v\x1b[0m\r\n", "file_word_wrap", cfg.FileWordWrap))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%d\x1b[0m\r\n", "scroll_speed", cfg.ScrollSpeed))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%.1f\x1b[0m\r\n", "default_zoom", cfg.DefaultZoom))
	sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%-18s\x1b[0m  \x1b[38;5;253m%s\x1b[0m\r\n", "config_path", config.FilePath()))
	t.write(sb.String())
	t.write(t.prompt())
}

func (t *Terminal) builtinKill(args []string) {
	if len(args) == 0 {
		t.write("\r\n\x1b[31mkill: usage: /kill <port>\x1b[0m")
		t.write(t.prompt())
		return
	}
	msg, err := ports.KillPortProcess(args[0])
	if err != nil {
		t.write("\r\n\x1b[31mkill: " + err.Error() + "\x1b[0m")
	} else {
		t.write("\r\n\x1b[38;5;75m" + msg + "\x1b[0m")
	}
	t.write(t.prompt())
}

func (t *Terminal) builtinExplorer() {
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer.exe", t.cwd)
	case "darwin":
		cmd = exec.Command("open", t.cwd)
	default:
		cmd = exec.Command("xdg-open", t.cwd)
	}
	term.NoWindow(cmd)
	if err := cmd.Start(); err != nil {
		t.write("\r\n\x1b[31mexplorer: " + err.Error() + "\x1b[0m")
	} else {
		t.write("\r\n\x1b[38;5;246mopening " + filepath.ToSlash(t.cwd) + "\x1b[0m")
	}
	t.write(t.prompt())
}

func (t *Terminal) builtinPack(args []string) {
	dryrun := len(args) > 0 && args[0] == "--dryrun"

	// Actual zip creation always delegates to the C++ libzip backend.
	// Dryrun stays Go (it only reads the filesystem — no zip is created).
	if !dryrun {
		dirName := filepath.Base(t.cwd)
		zipName := dirName + ".zip"
		zipPath := filepath.Join(filepath.Dir(t.cwd), zipName)
		t.write(fmt.Sprintf("\r\n\x1b[38;5;246mpacking %s…\x1b[0m", zipName))
		fileCount, sizeMB, err := cppPackFunc(t.cwd, zipPath)
		if err != nil {
			t.write("\r\n\x1b[31mpack: " + err.Error() + "\x1b[0m")
		} else {
			t.write(fmt.Sprintf("\r\n\x1b[38;5;75mcreated %s (%.1f MB, %d files)\x1b[0m",
				zipPath, sizeMB, fileCount))
		}
		t.write(t.prompt())
		return
	}

	// --dryrun: list files that would be packed without creating the zip.
	entries, err := pack.CollectEntries(t.cwd)
	if err != nil {
		t.write("\r\n\x1b[31mpack: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}

	var total int64
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("\r\n\x1b[38;5;75mPack preview — %d files\x1b[0m\r\n\r\n", len(entries)))
	for _, e := range entries {
		total += e.Size
		sb.WriteString(fmt.Sprintf("  \x1b[38;5;246m%s\x1b[0m  %s\r\n", pack.FormatBytes(e.Size), e.RelPath))
	}
	sb.WriteString(fmt.Sprintf("\r\n  \x1b[38;5;75mTotal: %s\x1b[0m\r\n", pack.FormatBytes(total)))
	if len(entries) == 0 {
		sb.WriteString("\r\n\x1b[38;5;246mno files to pack\x1b[0m")
	}
	t.write(sb.String())
	t.write(t.prompt())
}

func (t *Terminal) builtinOpen(args []string) {
	if len(args) == 0 {
		t.write("\r\n\x1b[31mopen: usage: open <file>\x1b[0m")
		t.write(t.prompt())
		return
	}
	path := args[0]
	if !filepath.IsAbs(path) {
		path = filepath.Join(t.cwd, path)
	}
	path = filepath.Clean(path)

	if database.IsDBFile(path) {
		t.write("\r\n\x1b[38;5;246mopening database " + filepath.Base(path) + "\x1b[0m")
		wailsruntime.EventsEmit(t.ctx, "app:open-database", map[string]string{
			"path": path, "terminalId": t.id,
		})
		t.write(t.prompt())
		return
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.write("\r\n\x1b[31mopen: " + err.Error() + "\x1b[0m")
		t.write(t.prompt())
		return
	}

	t.write("\r\n\x1b[38;5;246mopening " + filepath.Base(path) + "\x1b[0m")
	wailsruntime.EventsEmit(t.ctx, "app:open-file", map[string]string{
		"path":       path,
		"content":    string(content),
		"language":   detectLanguage(path),
		"terminalId": t.id,
	})
	t.write(t.prompt())
}

func (t *Terminal) builtinProblems() {
	const (
		probDim   = "\x1b[38;5;246m"
		probReset = "\x1b[0m"
	)
	t.write("\r\n" + probDim + "  scanning…" + probReset)

	result := problems.Scan(t.cwd)

	t.write("\r\x1b[2K")

	if len(result.Sources) == 0 {
		t.write("\r\n" + probDim +
			"  No source files found.\r\n" +
			"  Scans: Go (.go) · TypeScript/JS (.ts .tsx .js .jsx)\r\n" + probReset)
		t.write(t.prompt())
		return
	}

	wailsruntime.EventsEmit(t.ctx, "app:open-problems", map[string]interface{}{
		"cwd":        result.Cwd,
		"sources":    result.Sources,
		"items":      result.Items,
		"terminalId": t.id,
	})

	label := fmt.Sprintf("%d issue", len(result.Items))
	if len(result.Items) != 1 {
		label += "s"
	}
	if len(result.Items) == 0 {
		label = "no issues"
	}
	t.write("\r\n" + probDim + "  opened problems tab — " + label + probReset)
	t.write(t.prompt())
}

func (t *Terminal) builtinPreview(args []string) {
	if len(args) == 0 {
		t.write("\r\n\x1b[31mpreview: usage: /preview <file.md|file.html|localhost:PORT|http://...>\x1b[0m")
		t.write(t.prompt())
		return
	}
	target := args[0]

	// URL / host:port
	if isPreviewURL(target) {
		url := target
		if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
			url = "http://" + url
		}
		wailsruntime.EventsEmit(t.ctx, "app:open-preview", map[string]string{
			"type":       "url",
			"url":        url,
			"path":       url,
			"terminalId": t.id,
		})
		t.write("\r\n\x1b[38;5;246mopening preview: " + url + "\x1b[0m")
		t.write(t.prompt())
		return
	}

	// File
	path := target
	if !filepath.IsAbs(path) {
		path = filepath.Join(t.cwd, path)
	}
	path = filepath.Clean(path)

	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".md", ".mdx":
		// Markdown: read content and render client-side (no external assets needed).
		content, err := os.ReadFile(path)
		if err != nil {
			t.write("\r\n\x1b[31mpreview: " + err.Error() + "\x1b[0m")
			t.write(t.prompt())
			return
		}
		t.write("\r\n\x1b[38;5;246mopening preview: " + filepath.Base(path) + "\x1b[0m")
		wailsruntime.EventsEmit(t.ctx, "app:open-preview", map[string]string{
			"type":       "markdown",
			"path":       path,
			"content":    string(content),
			"terminalId": t.id,
		})

	case ".html", ".htm":
		// HTML: serve via a local file server so relative CSS/JS/image links resolve.
		url := localFileURL(path)
		if url == "" {
			t.write("\r\n\x1b[31mpreview: could not start local file server\x1b[0m")
			t.write(t.prompt())
			return
		}
		t.write("\r\n\x1b[38;5;246mopening preview: " + filepath.Base(path) + "\x1b[0m")
		wailsruntime.EventsEmit(t.ctx, "app:open-preview", map[string]string{
			"type":       "html",
			"path":       path,
			"url":        url,
			"terminalId": t.id,
		})

	default:
		t.write("\r\n\x1b[31mpreview: unsupported file type — use .md, .html, or a URL\x1b[0m")
		t.write(t.prompt())
		return
	}

	t.write(t.prompt())
}

// isPreviewURL returns true if s looks like a URL or host:port pair.
func isPreviewURL(s string) bool {
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		return true
	}
	// host:PORT — second segment must be all digits
	parts := strings.SplitN(s, ":", 2)
	if len(parts) == 2 {
		for _, c := range parts[1] {
			if c < '0' || c > '9' {
				return false
			}
		}
		return len(parts[1]) > 0
	}
	return false
}

// ─── command-line parser ──────────────────────────────────────────────────────

func parseArgs(line string) []string {
	var args []string
	var cur strings.Builder
	inQ := false
	var qc rune
	for _, r := range line {
		switch {
		case inQ && r == qc:
			inQ = false
		case !inQ && (r == '"' || r == '\''):
			inQ, qc = true, r
		case !inQ && r == ' ':
			if cur.Len() > 0 {
				args = append(args, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		args = append(args, cur.String())
	}
	return args
}
