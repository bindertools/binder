//go:build windows

package ports

import win "terminal-ide/windows"

func init() {
	netstatCmd = win.NetstatCmd
	platformKillPIDs = win.KillPIDs
}
