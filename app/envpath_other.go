//go:build !windows

package main

import "os"

// liveEnv returns os.Environ() unchanged — on non-Windows systems the shell
// process inherits a fresh environment so PATH is always current.
func liveEnv() []string {
	return os.Environ()
}
