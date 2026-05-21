//go:build linux

package ports

import lx "terminal-ide/linux"

func init() {
	netstatCmd = lx.NetstatCmd
	platformKillPIDs = lx.KillPIDs
}
