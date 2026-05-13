---
title: Build from Source
description: Source build workflow for the app and installer using the repository's existing scripts.
section: Install
order: 2
---

This repository already includes a single PowerShell entry point for producing both Windows executables.

## Prerequisites

Before building, make sure the local machine has:

- Go available on the path
- Node and npm available for the React frontends
- Wails installed or installable in the active environment

## Standard build

From the repository root, run:

```powershell
.\build.ps1
```

That flow:

1. builds the main Wails app
2. stages the app binary into the installer assets directory
3. builds the installer app

## Output files

The script documents two output paths:

```text
app\build\bin\cmdIDE.exe
installer\build\bin\cmdIDE-installer.exe
```

## Partial builds

For targeted work, the script also supports:

```powershell
.\build.ps1 -AppOnly
.\build.ps1 -InstallerOnly
```

## CI and release alignment

The GitHub workflows are intended to mirror this exact build contract. The release workflow runs `./build.ps1` and then uploads both executable outputs so the GitHub release matches the local source build flow.
