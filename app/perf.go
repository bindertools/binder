package main

import (
	"context"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// PerfData is one snapshot of host performance metrics.
type PerfData struct {
	CPUPercent   float64 `json:"cpu_percent"`
	MemUsed      uint64  `json:"mem_used"`
	MemTotal     uint64  `json:"mem_total"`
	MemPercent   float64 `json:"mem_percent"`
	DiskUsed     uint64  `json:"disk_used"`
	DiskTotal    uint64  `json:"disk_total"`
	DiskPercent  float64 `json:"disk_percent"`
	NetBytesSent uint64  `json:"net_bytes_sent"`
	NetBytesRecv uint64  `json:"net_bytes_recv"`
	GPUPercent   float64 `json:"gpu_percent"`
	GPUName      string  `json:"gpu_name"`
	GPUAvailable bool    `json:"gpu_available"`
}

// platformCollectPerf is set by the platform-specific init() function.
var platformCollectPerf func() PerfData

// collectPerfData returns a single snapshot via the platform implementation.
func collectPerfData() PerfData {
	if platformCollectPerf == nil {
		return PerfData{}
	}
	return platformCollectPerf()
}

// startPerfMonitor streams perf:data:{tabId} events every second until ctx is cancelled.
func startPerfMonitor(ctx context.Context, tabId string) {
	go func() {
		event := "perf:data:" + tabId
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(1 * time.Second):
				data := collectPerfData()
				wailsruntime.EventsEmit(ctx, event, data)
			}
		}
	}()
}
