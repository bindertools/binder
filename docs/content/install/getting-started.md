---
title: Getting Started
description: Recommended install path for users and the quickest route into the product.
section: Install
order: 1
---

The recommended entry point for most people is the installer build.

## Choose the right artifact

Use the installer when you want a normal user install:

- download `cmdIDE-installer.exe`
- run the installer
- launch the installed app from the target directory

Use the portable build when you need a quick executable:

- download `cmdIDE.exe`
- place it where you want
- run it directly without an install step

## What the release workflow publishes

Each release is expected to publish two Windows artifacts:

| Artifact | Intended audience | Why it exists |
| --- | --- | --- |
| `cmdIDE-installer.exe` | End users | Guided install flow |
| `cmdIDE.exe` | Developers and testers | Faster smoke testing and direct download |

## First run expectations

On first run the app creates its local configuration files in the user config directory under `cmdIDE`. Session restore and saved settings also live there.

## After install

The best next reads are:

- [Terminal Tabs](/workspace/terminal-tabs)
- [Editor](/workspace/editor)
- [Settings](/configuration/settings)
