---
title: Terminal Tabs
description: How terminal sessions are created, grouped, and restored inside the app.
section: Workspace
order: 1
---

The terminal is the backbone of cmdIDE. Every major surface is attached to terminal context, either directly or by relationship to a terminal tab.

## Session model

Each terminal tab represents an active shell session. The backend tracks terminals by tab identifier and stores the current working directory for each tab.

## Terminal-adjacent tabs

A terminal can spawn related tabs:

- editor tabs
- preview tabs
- problems tabs
- database tabs
- settings

Those tabs can remain visually grouped near their originating terminal.

## Split workflow

The main workspace supports a split view so one tab can stay primary while another remains visible in a secondary pane.

### Why this matters for docs

A lot of cmdIDE behavior makes more sense if you think in terms of tab families rather than isolated screens. Documentation should describe what happens around the terminal, not just inside it.

## Soft close and session restore

When soft close is enabled, cmdIDE persists a compact description of the open session and restores it on the next run.

That includes:

- terminal tabs and their working directories
- editor tabs that still point to readable files

## Built-in commands

The terminal help surface already advertises commands such as:

- `/config`
- `/themes`
- `/preview`
- `/problems`
- `/version`

Those commands are good candidates for future deeper docs and command reference pages.
