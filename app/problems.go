package main

import (
	"fmt"
	"go/parser"
	"go/scanner"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"sync"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ── exported wire types (Wails generates TS bindings from these) ──────────────

// ProbData is one diagnostic item, JSON-serialisable for the frontend.
type ProbData struct {
	File string `json:"file"`
	Line int    `json:"line"`
	Col  int    `json:"col"`
	Sev  int    `json:"sev"`  // 0 = error · 1 = warn · 2 = info
	Code string `json:"code"` // lint rule / compiler code, may be empty
	Msg  string `json:"msg"`
}

// ProbResult is the full scan result returned to the frontend.
type ProbResult struct {
	Cwd     string     `json:"cwd"`
	Sources []string   `json:"sources"`
	Items   []ProbData `json:"items"`
}

// ── ANSI helpers (terminal-only, used in builtinVersion) ─────────────────────

const (
	probReset  = "\x1b[0m"
	probRed    = "\x1b[38;5;203m"
	probYellow = "\x1b[38;5;221m"
	probGreen  = "\x1b[38;5;114m"
	probBlue   = "\x1b[38;5;75m"
	probDim    = "\x1b[38;5;246m"
)

// ── internal item type ────────────────────────────────────────────────────────

type probSev int

const (
	sevError probSev = iota
	sevWarn
	sevInfo
)

type probItem struct {
	File string
	Line int
	Col  int
	Sev  probSev
	Code string
	Msg  string
}

// ── skip lists ────────────────────────────────────────────────────────────────

var probSkipDirs = map[string]bool{
	"node_modules": true,
	"vendor":       true,
	".cache":       true,
	"dist":         true,
	"build":        true,
	"__pycache__":  true,
	".venv":        true,
	"venv":         true,
	"target":       true,
	"testdata":     true,
}

var probSkipSubs = []string{
	"/wailsjs/", // auto-generated Wails bindings
}

// ── shared scanner ────────────────────────────────────────────────────────────

// probScan is the single entry point used by both builtinProblems (terminal
// command) and App.ScanProblems (frontend rescan button).
func probScan(cwd string) ProbResult {
	var (
		mu    sync.Mutex
		all   []probItem
		hasGo bool
		hasTS bool
	)

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		items, found := probScanGoFiles(cwd)
		mu.Lock()
		all = append(all, items...)
		hasGo = found
		mu.Unlock()
	}()

	go func() {
		defer wg.Done()
		items, found := probScanTSFiles(cwd)
		mu.Lock()
		all = append(all, items...)
		hasTS = found
		mu.Unlock()
	}()

	wg.Wait()

	var sources []string
	if hasGo {
		sources = append(sources, "Go")
	}
	if hasTS {
		sources = append(sources, "TypeScript")
	}

	// Global dedup.
	type dk struct {
		f    string
		l, c int
		m    string
	}
	seen := map[dk]bool{}
	var deduped []probItem
	for _, p := range all {
		k := dk{p.File, p.Line, p.Col, p.Msg}
		if !seen[k] {
			seen[k] = true
			deduped = append(deduped, p)
		}
	}

	result := ProbResult{Cwd: cwd, Sources: sources}
	for _, p := range deduped {
		result.Items = append(result.Items, ProbData{
			File: filepath.ToSlash(p.File),
			Line: p.Line,
			Col:  p.Col,
			Sev:  int(p.Sev),
			Code: p.Code,
			Msg:  p.Msg,
		})
	}
	return result
}

// ── terminal command ──────────────────────────────────────────────────────────

func (t *Terminal) builtinProblems() {
	t.write("\r\n" + probDim + "  scanning…" + probReset)

	result := probScan(t.cwd)

	t.write("\r\x1b[2K") // clear scanning line

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

// ── Go scanner ────────────────────────────────────────────────────────────────

func probScanGoFiles(root string) (items []probItem, found bool) {
	fset := token.NewFileSet()

	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if path != root {
				name := info.Name()
				if strings.HasPrefix(name, ".") || probSkipDirs[name] {
					return filepath.SkipDir
				}
			}
			return nil
		}
		if !strings.HasSuffix(info.Name(), ".go") {
			return nil
		}
		found = true

		_, parseErr := parser.ParseFile(fset, path, nil, parser.AllErrors)
		if parseErr == nil {
			return nil
		}
		if errList, ok := parseErr.(scanner.ErrorList); ok {
			for _, e := range errList {
				items = append(items, probItem{
					File: path,
					Line: e.Pos.Line,
					Col:  e.Pos.Column,
					Sev:  sevError,
					Msg:  e.Msg,
				})
			}
		}
		return nil
	})
	return
}

// ── TypeScript / JS scanner ───────────────────────────────────────────────────

var probTSExts = map[string]bool{
	".ts": true, ".tsx": true,
	".js": true, ".jsx": true,
}

func probScanTSFiles(root string) (items []probItem, found bool) {
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if path != root {
				name := info.Name()
				if strings.HasPrefix(name, ".") || probSkipDirs[name] {
					return filepath.SkipDir
				}
			}
			return nil
		}

		if !probTSExts[strings.ToLower(filepath.Ext(info.Name()))] {
			return nil
		}

		slash := filepath.ToSlash(path)
		for _, sub := range probSkipSubs {
			if strings.Contains(slash, sub) {
				return nil
			}
		}

		found = true
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		items = append(items, probCheckBrackets(path, string(content))...)
		return nil
	})
	return
}

// probCheckBrackets does a fast bracket-balance pass over source text.
func probCheckBrackets(file, src string) []probItem {
	type frame struct {
		ch        rune
		line, col int
	}
	stack := make([]frame, 0, 32)

	var (
		inLine  bool
		inBlock bool
		inSing  bool
		inDbl   bool
		inTmpl  bool
	)

	rs := []rune(src)
	n := len(rs)
	ln, cl := 1, 1

	for i := 0; i < n; i++ {
		c := rs[i]
		var peek rune
		if i+1 < n {
			peek = rs[i+1]
		}

		if c == '\n' {
			inLine = false
			ln++
			cl = 1
			continue
		}
		if inLine {
			cl++
			continue
		}
		if inBlock {
			if c == '*' && peek == '/' {
				inBlock = false
				i++
				cl += 2
			} else {
				cl++
			}
			continue
		}
		if inSing {
			if c == '\\' {
				i++
				cl += 2
			} else if c == '\'' {
				inSing = false
				cl++
			} else {
				cl++
			}
			continue
		}
		if inDbl {
			if c == '\\' {
				i++
				cl += 2
			} else if c == '"' {
				inDbl = false
				cl++
			} else {
				cl++
			}
			continue
		}
		if inTmpl {
			if c == '\\' {
				i++
				cl += 2
			} else if c == '`' {
				inTmpl = false
				cl++
			} else {
				cl++
			}
			continue
		}

		switch {
		case c == '/' && peek == '/':
			inLine = true
			i++
			cl += 2
		case c == '/' && peek == '*':
			inBlock = true
			i++
			cl += 2
		case c == '\'':
			inSing = true
			cl++
		case c == '"':
			inDbl = true
			cl++
		case c == '`':
			inTmpl = true
			cl++
		case c == '{' || c == '(' || c == '[':
			stack = append(stack, frame{c, ln, cl})
			cl++
		case c == '}' || c == ')' || c == ']':
			want := map[rune]rune{'}': '{', ')': '(', ']': '['}[c]
			if len(stack) > 0 && stack[len(stack)-1].ch == want {
				stack = stack[:len(stack)-1]
			} else if len(stack) > 0 {
				top := stack[len(stack)-1]
				return []probItem{{
					File: file, Line: ln, Col: cl, Sev: sevError,
					Msg: fmt.Sprintf("'%c' does not match '%c' opened at line %d", c, top.ch, top.line),
				}}
			}
			cl++
		default:
			cl++
		}
	}

	var out []probItem
	for _, f := range stack {
		out = append(out, probItem{
			File: file, Line: f.line, Col: f.col, Sev: sevError,
			Msg: fmt.Sprintf("'%c' is never closed", f.ch),
		})
	}
	return out
}

// ── helpers ───────────────────────────────────────────────────────────────────

func probRelPath(cwd, file string) string {
	file = filepath.ToSlash(file)
	if rel, err := filepath.Rel(cwd, filepath.FromSlash(file)); err == nil {
		return filepath.ToSlash(rel)
	}
	return file
}
