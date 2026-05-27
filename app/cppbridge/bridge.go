//go:build windows

package cppbridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// Bridge manages the lifecycle of the C++ backend subprocess and its IPC connection.
// Send and Recv are not safe for concurrent use; RoundTrip serialises them internally.
type Bridge struct {
	cmd      *exec.Cmd
	handle   windows.Handle
	pipeName string
	mu       sync.Mutex // guards cmd, handle, started
	started  bool
	readBuf  []byte
}

// New returns an unstarted Bridge.
func New() *Bridge {
	return &Bridge{}
}

// Start creates a named-pipe server at \\.\pipe\cmdide-<pid>, spawns exePath
// with that path as argv[1], and waits for the C++ process to connect.
func (b *Bridge) Start(exePath string) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.started {
		return errors.New("bridge already started")
	}

	pipeName := fmt.Sprintf(`\\.\pipe\cmdide-%d`, os.Getpid())
	b.pipeName = pipeName

	pipeNameW, err := windows.UTF16PtrFromString(pipeName)
	if err != nil {
		return fmt.Errorf("encode pipe name: %w", err)
	}

	handle, err := windows.CreateNamedPipe(
		pipeNameW,
		windows.PIPE_ACCESS_DUPLEX,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT,
		1,    // max instances
		4096, // out-buffer size
		4096, // in-buffer size
		0,    // default timeout
		nil,  // security attributes
	)
	if err != nil {
		return fmt.Errorf("CreateNamedPipe: %w", err)
	}

	b.cmd = exec.Command(exePath, pipeName)
	if err := b.cmd.Start(); err != nil {
		windows.CloseHandle(handle) //nolint:errcheck
		return fmt.Errorf("start C++ subprocess: %w", err)
	}

	if err := windows.ConnectNamedPipe(handle, nil); err != nil {
		// ERROR_PIPE_CONNECTED (535) means the client connected before we called — that's fine.
		var errno syscall.Errno
		if !errors.As(err, &errno) || errno != 535 {
			windows.CloseHandle(handle) //nolint:errcheck
			b.cmd.Process.Kill()        //nolint:errcheck
			return fmt.Errorf("ConnectNamedPipe: %w", err)
		}
	}

	b.handle = handle
	b.started = true
	return nil
}

// Stop sends a shutdown message, closes the pipe, and terminates the subprocess.
func (b *Bridge) Stop() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.started {
		return
	}
	b.started = false

	_ = b.writeLocked(map[string]any{"type": "shutdown"})
	windows.CloseHandle(b.handle) //nolint:errcheck

	if b.cmd != nil && b.cmd.Process != nil {
		b.cmd.Process.Kill() //nolint:errcheck
		b.cmd.Wait()         //nolint:errcheck
	}
}

// Send marshals msg to JSON + newline and writes it to the pipe.
func (b *Bridge) Send(msg map[string]any) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.started {
		return errors.New("bridge not started")
	}
	return b.writeLocked(msg)
}

func (b *Bridge) writeLocked(msg map[string]any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	data = append(data, '\n')
	var done uint32
	if err := windows.WriteFile(b.handle, data, &done, nil); err != nil {
		return fmt.Errorf("WriteFile: %w", err)
	}
	return nil
}

// Recv blocks until one complete newline-terminated JSON message arrives.
// Not safe for concurrent callers.
func (b *Bridge) Recv() (map[string]any, error) {
	tmp := make([]byte, 4096)
	for {
		if idx := indexByte(b.readBuf, '\n'); idx >= 0 {
			line := make([]byte, idx)
			copy(line, b.readBuf[:idx])
			b.readBuf = b.readBuf[idx+1:]
			var m map[string]any
			if err := json.Unmarshal(line, &m); err != nil {
				return nil, fmt.Errorf("unmarshal: %w", err)
			}
			return m, nil
		}

		b.mu.Lock()
		if !b.started {
			b.mu.Unlock()
			return nil, errors.New("bridge closed")
		}
		handle := b.handle
		b.mu.Unlock()

		var n uint32
		if err := windows.ReadFile(handle, tmp, &n, nil); err != nil {
			return nil, fmt.Errorf("ReadFile: %w", err)
		}
		b.readBuf = append(b.readBuf, tmp[:n]...)
	}
}

// RoundTrip sends req and waits up to timeoutMs for a response whose "id"
// field matches req["id"].
func (b *Bridge) RoundTrip(req map[string]any, timeoutMs int) (map[string]any, error) {
	id, _ := req["id"].(string)
	if err := b.Send(req); err != nil {
		return nil, err
	}

	type result struct {
		msg map[string]any
		err error
	}
	ch := make(chan result, 1)
	go func() {
		for {
			msg, err := b.Recv()
			if err != nil {
				ch <- result{err: err}
				return
			}
			if rid, _ := msg["id"].(string); rid == id {
				ch <- result{msg: msg}
				return
			}
		}
	}()

	select {
	case r := <-ch:
		return r.msg, r.err
	case <-time.After(time.Duration(timeoutMs) * time.Millisecond):
		return nil, fmt.Errorf("RoundTrip: timeout after %dms waiting for id=%q", timeoutMs, id)
	}
}

func indexByte(b []byte, c byte) int {
	for i, v := range b {
		if v == c {
			return i
		}
	}
	return -1
}
