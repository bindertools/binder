package main

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// PackEntry describes one file that will be included in the zip.
type PackEntry struct {
	RelPath string
	Size    int64
}

// collectPackEntries walks dir and returns all non-hidden files, skipping
// common build artefacts (node_modules, .git, dist, build, vendor, __pycache__).
func collectPackEntries(dir string) ([]PackEntry, error) {
	var entries []PackEntry
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
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
		rel, _ := filepath.Rel(dir, path)
		entries = append(entries, PackEntry{RelPath: filepath.ToSlash(rel), Size: info.Size()})
		return nil
	})
	return entries, err
}

// createZip writes a zip archive at zipPath containing all entries under dir.
func createZip(dir, zipPath string, entries []PackEntry) error {
	f, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	defer f.Close()

	w := zip.NewWriter(f)
	defer w.Close()

	for _, e := range entries {
		absPath := filepath.Join(dir, filepath.FromSlash(e.RelPath))
		in, err := os.Open(absPath)
		if err != nil {
			continue
		}
		fh := &zip.FileHeader{
			Name:   e.RelPath,
			Method: zip.Deflate,
		}
		fh.Modified = time.Now()
		out, err := w.CreateHeader(fh)
		if err != nil {
			in.Close()
			continue
		}
		buf := make([]byte, 32*1024)
		for {
			n, rerr := in.Read(buf)
			if n > 0 {
				out.Write(buf[:n]) //nolint:errcheck
			}
			if rerr != nil {
				break
			}
		}
		in.Close()
	}
	return nil
}

// formatBytes renders a byte count as a human-readable string.
func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
