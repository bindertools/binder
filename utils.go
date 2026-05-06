package main

import (
	"path/filepath"
	"strings"
)

// detectLanguage returns a Monaco editor language ID for the given file path.
func detectLanguage(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	m := map[string]string{
		".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
		".ts": "typescript", ".tsx": "typescript", ".mts": "typescript",
		".py": "python", ".go": "go", ".rs": "rust",
		".java": "java", ".kt": "kotlin", ".scala": "scala",
		".c": "c", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".h": "cpp", ".hpp": "cpp",
		".cs": "csharp", ".vb": "vb",
		".html": "html", ".htm": "html", ".vue": "html", ".svelte": "html",
		".css": "css", ".scss": "scss", ".less": "less",
		".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "ini",
		".md": "markdown", ".mdx": "markdown",
		".sh": "shell", ".bash": "shell", ".zsh": "shell", ".fish": "shell",
		".ps1": "powershell",
		".sql": "sql", ".xml": "xml", ".svg": "xml",
		".swift": "swift", ".rb": "ruby", ".php": "php",
		".lua": "lua", ".r": "r",
		".tf": "hcl", ".hcl": "hcl",
		".proto": "protobuf",
		".dart": "dart", ".ex": "elixir", ".exs": "elixir",
	}
	if lang, ok := m[ext]; ok {
		return lang
	}
	switch strings.ToLower(filepath.Base(path)) {
	case "dockerfile":
		return "dockerfile"
	case "makefile", "gnumakefile":
		return "makefile"
	}
	return "plaintext"
}
