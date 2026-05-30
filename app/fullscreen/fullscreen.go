package fullscreen

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/fsnotify/fsnotify"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"isDir"`
	Children []FileNode `json:"children,omitempty"`
	Ext      string     `json:"ext"`
}

type Manager struct {
	ctx     context.Context
	watcher *fsnotify.Watcher
	rootDir string
}

func New() *Manager { return &Manager{} }

func (m *Manager) SetContext(ctx context.Context) { m.ctx = ctx }

func (m *Manager) OpenDirectory(dir string) (FileNode, error) {
	if m.watcher != nil {
		m.watcher.Close()
		m.watcher = nil
	}
	m.rootDir = dir
	tree, err := buildTree(dir)
	if err != nil {
		return FileNode{}, err
	}
	go m.startWatcher(dir)
	return tree, nil
}

func (m *Manager) GetTree() (FileNode, error) {
	if m.rootDir == "" {
		return FileNode{}, nil
	}
	return buildTree(m.rootDir)
}

func (m *Manager) GetFileContent(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (m *Manager) SaveFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

func (m *Manager) CreateFile(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	return f.Close()
}

func (m *Manager) CreateDirectory(path string) error {
	return os.MkdirAll(path, 0755)
}

func (m *Manager) Rename(oldPath, newPath string) error {
	return os.Rename(oldPath, newPath)
}

func (m *Manager) Delete(path string) error {
	return os.RemoveAll(path)
}

func (m *Manager) MoveFile(src, dest string) error {
	return os.Rename(src, dest)
}

func (m *Manager) Close() {
	if m.watcher != nil {
		m.watcher.Close()
		m.watcher = nil
	}
}

func (m *Manager) startWatcher(dir string) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}
	m.watcher = w

	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			_ = w.Add(path)
		}
		return nil
	})

	for {
		select {
		case event, ok := <-w.Events:
			if !ok {
				return
			}
			// Watch newly created directories.
			if event.Has(fsnotify.Create) {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					_ = w.Add(event.Name)
				}
			}
			// Notify the frontend when a file's content changes so open tabs
			// can reload without waiting for the user to reopen the file.
			if event.Has(fsnotify.Write) {
				if info, err := os.Stat(event.Name); err == nil && !info.IsDir() {
					wailsruntime.EventsEmit(m.ctx, "fullscreen:file-changed",
						filepath.ToSlash(event.Name))
				}
			}
			// Rebuild and emit the updated tree.
			if tree, err := buildTree(m.rootDir); err == nil {
				wailsruntime.EventsEmit(m.ctx, "fullscreen:tree", tree)
			}
		case _, ok := <-w.Errors:
			if !ok {
				return
			}
		}
	}
}

// heavyDirs are skipped during recursive scan to keep the tree fast.
var heavyDirs = map[string]bool{
	"node_modules": true,
	".git":         true,
	".svn":         true,
	".hg":          true,
	".next":        true,
	"__pycache__":  true,
	"target":       true,
	".cache":       true,
	"coverage":     true,
	".angular":     true,
	".turbo":       true,
	".gradle":      true,
}

func buildTree(path string) (FileNode, error) {
	info, err := os.Stat(path)
	if err != nil {
		return FileNode{}, err
	}
	node := FileNode{
		Name:  filepath.Base(path),
		Path:  filepath.ToSlash(path),
		IsDir: info.IsDir(),
		Ext:   strings.TrimPrefix(filepath.Ext(path), "."),
	}
	if !info.IsDir() {
		return node, nil
	}

	// Skip heavy directories — show them as collapsed folders with no children.
	if heavyDirs[strings.ToLower(filepath.Base(path))] {
		return node, nil
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return node, nil
	}

	// Dirs first, then files, both sorted alphabetically.
	sort.Slice(entries, func(i, j int) bool {
		di, dj := entries[i].IsDir(), entries[j].IsDir()
		if di != dj {
			return di
		}
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})

	for _, e := range entries {
		child, err := buildTree(filepath.Join(path, e.Name()))
		if err == nil {
			node.Children = append(node.Children, child)
		}
	}
	return node, nil
}
