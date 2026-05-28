package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
)

var (
	previewServerPort int
	previewServerOnce sync.Once
)

// cppPreviewURLFunc, when non-nil, overrides localFileURL to use the C++
// preview server instead of the built-in Go HTTP server.
var cppPreviewURLFunc func(absPath string) string

// startPreviewServer starts a local HTTP file server on a random 127.0.0.1 port
// and returns the port number. Subsequent calls are no-ops that return the same
// port. The server serves arbitrary absolute filesystem paths, which lets the
// browser resolve relative links (CSS, JS, images) exactly as a real web server
// would — equivalent to VS Code's Live Server.
func startPreviewServer() int {
	previewServerOnce.Do(func() {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return
		}
		previewServerPort = ln.Addr().(*net.TCPAddr).Port
		mux := http.NewServeMux()
		mux.HandleFunc("/", previewFileHandler)
		go http.Serve(ln, mux) //nolint:errcheck
	})
	return previewServerPort
}

// previewFileHandler maps incoming URL paths to absolute filesystem paths and
// serves them with correct MIME types via http.ServeFile.
//
// URL path encoding:
//   - Unix/macOS : /home/user/project/index.html  (leading / is the FS root)
//   - Windows    : /C:/Users/user/project/index.html  (leading / is stripped)
//
// When the browser sees a relative link such as <link href="style.css"> inside
// the served page, it resolves it to e.g. http://127.0.0.1:<port>/C:/…/style.css,
// which this handler serves from the same directory — exactly like Live Server.
func previewFileHandler(w http.ResponseWriter, r *http.Request) {
	urlPath := r.URL.Path

	var fsPath string
	if goruntime.GOOS == "windows" {
		// Strip the leading "/" that would make "C:/" look like "/C:/"
		if len(urlPath) > 1 && urlPath[0] == '/' {
			urlPath = urlPath[1:]
		}
		fsPath = filepath.FromSlash(urlPath)
	} else {
		fsPath = urlPath // already an absolute Unix path
	}

	if !filepath.IsAbs(fsPath) {
		http.NotFound(w, r)
		return
	}

	baseDir, err := os.Getwd()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	baseDir, err = filepath.Abs(filepath.Clean(baseDir))
	if err != nil {
		http.NotFound(w, r)
		return
	}

	baseDirCanonical, err := filepath.EvalSymlinks(baseDir)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	resolvedPath, err := filepath.Abs(filepath.Clean(fsPath))
	if err != nil {
		http.NotFound(w, r)
		return
	}

	resolvedPathCanonical, err := filepath.EvalSymlinks(resolvedPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	relPath, err := filepath.Rel(baseDirCanonical, resolvedPathCanonical)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if relPath == ".." || strings.HasPrefix(relPath, ".."+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}

	// Disable directory listings — serve only files
	http.ServeFile(w, r, resolvedPathCanonical)
}

// localFileURL converts an absolute OS path to the URL that the local preview
// server will serve it from.
//
//	Windows: C:\Users\x\project\index.html → http://127.0.0.1:PORT/C:/Users/x/project/index.html
//	Unix:    /home/x/project/index.html    → http://127.0.0.1:PORT/home/x/project/index.html
func localFileURL(absPath string) string {
	if cppPreviewURLFunc != nil {
		return cppPreviewURLFunc(absPath)
	}
	port := startPreviewServer()
	if port == 0 {
		return ""
	}
	slashed := filepath.ToSlash(absPath)
	// On Windows the path starts with "C:/" — prepend "/" to make a valid URL path.
	// On Unix it already starts with "/".
	if goruntime.GOOS == "windows" {
		slashed = "/" + slashed
	}
	return fmt.Sprintf("http://127.0.0.1:%d%s", port, slashed)
}
