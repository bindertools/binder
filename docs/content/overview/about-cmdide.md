---
title: About cmdIDE
description: What the application is, how the docs are organized, and what this codebase currently ships.
section: Overview
order: 1
---

cmdIDE is a desktop terminal IDE built with Wails, Go, React, and TypeScript. The product surface combines a terminal, editor, preview tabs, database inspection, problems scanning, and configuration tools in a single window.

## Documentation model

These docs are designed around a simple rule:

- markdown files own the documentation pages
- the docs shell owns navigation, section grouping, and layout
- non-doc utility pages such as download and policy stay in React code

That makes the content easy to edit while keeping the site behavior consistent.

## What the app includes today

The repository currently exposes a few major surfaces:

- terminal tabs that create shell sessions and preserve current working directories
- editor tabs with Monaco-based language handling
- preview tabs for files and URLs
- problem scanning that opens structured results in its own tab
- database file inspection for SQLite-style files
- a config editor with theme persistence and app toggles

## Release shape

The release path is intentionally split in two:

- `cmdIDE-installer.exe` is the user-facing artifact
- `cmdIDE.exe` is the fast portable build for internal download and validation

The docs site mirrors that release philosophy, which is why the download page and install guides focus on both flows.

## Reading this documentation

If you want the fastest path through the docs:

1. Read [Getting Started](/install/getting-started)
2. Read [Terminal Tabs](/workspace/terminal-tabs)
3. Read [Editor](/workspace/editor)
4. Read [Themes](/configuration/themes)

> The docs shell derives its sidebar, page ordering, and on-page heading tracker from markdown metadata and headings in this repository.
