//go:build !windows

package main

import "errors"

func (a *App) PerformUpdate(_ string) error {
	return errors.New("auto-update is only supported on Windows")
}
