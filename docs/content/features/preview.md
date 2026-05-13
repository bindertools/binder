---
title: Preview
description: File and URL preview tabs, and where preview fits in the tab workflow.
section: Features
order: 1
---

Preview tabs let cmdIDE render files or URLs without leaving the workspace.

## Supported preview intent

The preview flow is designed for two broad cases:

- a file preview generated from a local path and file contents
- a URL preview generated from a direct address or port

## Tab behavior

Preview tabs behave like the rest of the workspace:

- they can be opened adjacent to a terminal context
- they can be kept in split view beside an editor or terminal
- they participate in the same tab bar model

## Why preview matters

This feature is part of what makes the product feel like a terminal IDE instead of a plain terminal emulator. It shortens the feedback loop when checking markdown, HTML, or locally served pages.
