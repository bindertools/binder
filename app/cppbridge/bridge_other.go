//go:build !windows

package cppbridge

import "errors"

var errNotSupported = errors.New("cppbridge: not supported on this platform")

// Bridge is a no-op stub on non-Windows platforms.
type Bridge struct{}

func New() *Bridge                                                             { return &Bridge{} }
func (b *Bridge) Start(_ string) error                                        { return errNotSupported }
func (b *Bridge) Stop()                                                       {}
func (b *Bridge) Send(_ map[string]any) error                                 { return errNotSupported }
func (b *Bridge) Recv() (map[string]any, error)                               { return nil, errNotSupported }
func (b *Bridge) RoundTrip(_ map[string]any, _ int) (map[string]any, error)  { return nil, errNotSupported }
