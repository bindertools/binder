package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// GitStatusResult is returned by ExplorerGitStatus.
type GitStatusResult struct {
	IsGitRepo  bool              `json:"isGitRepo"`
	Root       string            `json:"root"`
	Files      map[string]string `json:"files"`
	Submodules []string          `json:"submodules"`
}

// ExplorerGitStatus runs git status in cwd and returns per-file status codes.
// Status codes: "M"=modified, "A"=added, "D"=deleted, "?"=untracked, "!"=ignored, "R"=renamed
func (a *App) ExplorerGitStatus(cwd string) GitStatusResult {
	result := GitStatusResult{Files: make(map[string]string)}

	rootOut, err := exec.Command("git", "-C", cwd, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return result
	}
	root := filepath.ToSlash(strings.TrimSpace(string(rootOut)))
	result.IsGitRepo = true
	result.Root = root

	out, err := exec.Command("git", "-C", cwd, "status", "--porcelain=v1", "--ignored").Output()
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if len(line) < 4 {
				continue
			}
			xy := line[:2]
			path := line[3:]

			// Renames: "old -> new" — take the destination
			if i := strings.Index(path, " -> "); i >= 0 {
				path = path[i+4:]
			}
			// Trim trailing slash (git appends it for directories)
			path = strings.TrimSuffix(path, "/")
			// Trim surrounding quotes that git adds for paths with special chars
			path = strings.Trim(path, "\"")

			var code string
			switch xy {
			case "!!":
				code = "!"
			case "??":
				code = "?"
			default:
				if x := xy[0]; x != ' ' && x != '.' {
					code = string(x)
				} else if y := xy[1]; y != ' ' && y != '.' {
					code = string(y)
				}
			}
			if code != "" && path != "" {
				result.Files[path] = code
			}
		}
	}

	// Parse .gitmodules for submodule paths
	gmPath := filepath.Join(filepath.FromSlash(root), ".gitmodules")
	if data, err := os.ReadFile(gmPath); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "path") {
				if parts := strings.SplitN(line, "=", 2); len(parts) == 2 {
					result.Submodules = append(result.Submodules, strings.TrimSpace(parts[1]))
				}
			}
		}
	}

	return result
}

// ExplorerGitIgnorePath appends relPath to the .gitignore in cwd.
func (a *App) ExplorerGitIgnorePath(cwd string, relPath string) error {
	gitignorePath := filepath.Join(cwd, ".gitignore")

	var existing []byte
	if data, err := os.ReadFile(gitignorePath); err == nil {
		existing = data
	}

	normalized := filepath.ToSlash(relPath)

	// Check if already present to avoid duplicates
	for _, line := range strings.Split(string(existing), "\n") {
		if strings.TrimSpace(line) == normalized {
			return nil
		}
	}

	if len(existing) > 0 && existing[len(existing)-1] != '\n' {
		existing = append(existing, '\n')
	}
	existing = append(existing, []byte(normalized+"\n")...)
	return os.WriteFile(gitignorePath, existing, 0644)
}
