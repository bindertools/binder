// Removed in Phase 5: startPreviewServer, previewFileHandler

package main

// cppPreviewURLFunc, when non-nil, delegates file URL generation to the C++
// cpp-httplib preview server (set by initCppPreview in app.go).
var cppPreviewURLFunc func(absPath string) string

// localFileURL returns the URL at which the C++ preview server serves absPath.
func localFileURL(absPath string) string {
	if cppPreviewURLFunc != nil {
		return cppPreviewURLFunc(absPath)
	}
	return ""
}
