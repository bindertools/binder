---
title: Settings
description: Persisted configuration fields, local defaults, and how the app writes config state.
section: Configuration
order: 1
---

cmdIDE stores editable application settings in a local `config.json` file under the user config directory.

## Core persisted fields

The configuration model currently includes:

- `default_directory`
- `indent_guides`
- `order_directory`
- `minimap`
- `theme`
- `show_timestamps`
- `git_recognition.show_git_branch`
- `soft_close`
- `zoom_insights`
- `minimal_pwd`
- `default_zoom`
- `custom_theme`

## Default behavior

When the config file does not exist yet, the app creates it with defaults. New fields are also written back so older configs get upgraded forward.

## Why the docs call this out

This is the kind of repo-grounded detail that should live in markdown pages:

- it changes over time
- it benefits from diffable text review
- it belongs to content as much as implementation

## Related guides

- [Themes](/configuration/themes)
- [Terminal Tabs](/workspace/terminal-tabs)
- [Troubleshooting](/help/troubleshooting)
