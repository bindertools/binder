---
title: Editor
description: The embedded Monaco editor, file opening behavior, and settings that affect editing.
section: Workspace
order: 2
---

The editor tab uses Monaco and opens files directly from terminal-driven actions and app events.

## Opening files

Files can be opened from app events and file path actions. When a file is already open, the app reuses the existing editor tab instead of creating duplicates.

## Language handling

The backend derives a Monaco language from the file path and sends both the file contents and language identifier to the editor tab.

## Editor settings

The configuration model already includes editor-facing options:

- `indent_guides`
- `minimap`
- theme selection
- custom theme color overrides
- default zoom

## Zoom model

Zoom is shared across the terminal and editor surfaces so the workspace scales together rather than diverging into separate font systems.

## Theme integration

Theme state is resolved once and then applied to:

- CSS custom properties
- xterm colors
- Monaco theme definitions

That means a custom theme can change both the terminal and editor as a single visual system.

```text
resolved theme -> CSS vars
resolved theme -> xterm
resolved theme -> Monaco
```
