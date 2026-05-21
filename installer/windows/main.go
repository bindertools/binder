package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:         "cmdIDE Installer",
		Width:         460,
		Height:        330,
		Frameless:     true,
		DisableResize: true,
		AssetServer:   &assetserver.Options{Assets: assets},
		BackgroundColour: &options.RGBA{R: 13, G: 13, B: 15, A: 255},
		OnStartup:    app.startup,
		Bind:         []interface{}{app},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
