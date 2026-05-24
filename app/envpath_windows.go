//go:build windows

package main

import (
	"os"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// expandEnvStr expands Windows-style %VAR% references in s by calling the
// Win32 ExpandEnvironmentStrings syscall.
func expandEnvStr(s string) string {
	ptr, err := windows.UTF16PtrFromString(s)
	if err != nil {
		return s
	}
	// First call: measure required buffer size.
	n, err := windows.ExpandEnvironmentStrings(ptr, nil, 0)
	if err != nil || n == 0 {
		return s
	}
	buf := make([]uint16, n)
	n, err = windows.ExpandEnvironmentStrings(ptr, &buf[0], n)
	if err != nil || n == 0 {
		return s
	}
	return windows.UTF16ToString(buf[:n])
}

// currentWindowsPath reads the live system + user PATH from the registry and
// expands any embedded environment variable references (%SystemRoot%, etc.).
//
// Why: GUI apps like ours inherit the environment from Explorer, which snapshots
// the PATH at login. Tools installed after launch (winget, scoop, npm -g, etc.)
// update the registry but never propagate to running processes. Reading the
// registry directly gives us the always-current PATH.
func currentWindowsPath() string {
	readPath := func(root registry.Key, subkey string) string {
		k, err := registry.OpenKey(root, subkey, registry.QUERY_VALUE)
		if err != nil {
			return ""
		}
		defer k.Close()
		v, _, err := k.GetStringValue("Path")
		if err != nil {
			return ""
		}
		return expandEnvStr(v)
	}

	sys := readPath(registry.LOCAL_MACHINE,
		`SYSTEM\CurrentControlSet\Control\Session Manager\Environment`)
	usr := readPath(registry.CURRENT_USER, `Environment`)

	switch {
	case sys != "" && usr != "":
		return sys + ";" + usr
	case sys != "":
		return sys
	case usr != "":
		return usr
	default:
		return os.Getenv("PATH")
	}
}

// liveEnv returns os.Environ() with the PATH replaced by the current registry
// value. All other environment variables are left untouched.
func liveEnv() []string {
	env := os.Environ()
	livePath := currentWindowsPath()
	for i, e := range env {
		if len(e) >= 5 && strings.EqualFold(e[:5], "PATH=") {
			env[i] = "PATH=" + livePath
			return env
		}
	}
	return append(env, "PATH="+livePath)
}
