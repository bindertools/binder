package cppbridge

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func findBackendExe() string {
	if p := os.Getenv("CMDIDE_BACKEND"); p != "" {
		return p
	}
	// bridge_test.go lives at app/cppbridge/; repo root is two levels up.
	_, thisFile, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(thisFile), "..", "..")
	return filepath.Join(root, "cpp", "build", "Release", "cmdide-backend.exe")
}

func TestPingPong(t *testing.T) {
	exePath := findBackendExe()
	if _, err := os.Stat(exePath); os.IsNotExist(err) {
		t.Skipf("cmdide-backend.exe not found at %s; build cpp/ first", exePath)
	}

	b := New()
	if err := b.Start(exePath); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer b.Stop()

	id := fmt.Sprintf("test-%d", time.Now().UnixNano())
	req := map[string]any{"type": "ping", "id": id}

	start := time.Now()
	resp, err := b.RoundTrip(req, 2000)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	if resp["type"] != "pong" {
		t.Errorf("expected type=pong, got %v", resp["type"])
	}
	if resp["id"] != id {
		t.Errorf("expected id=%s, got %v", id, resp["id"])
	}
	if elapsed >= 2*time.Second {
		t.Errorf("round-trip took %v, want < 2s", elapsed)
	}
	t.Logf("ping-pong round-trip: %v", elapsed)
}
