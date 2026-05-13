---
title: Database Inspection
description: Opening supported database files in dedicated tabs and reading schema-level information.
section: Features
order: 3
---

cmdIDE can detect database-style files and open them in a dedicated tab instead of treating them as plain text.

## Detection behavior

When a resolved file path matches a supported database extension, the app emits an open-database event rather than a normal editor open-file event.

## Database tab purpose

The database view is meant to expose:

- tables
- columns
- row previews
- schema structure

## Why the feature belongs in docs

Database inspection is a strong product differentiator for a terminal-centered app. It deserves dedicated navigation in the docs instead of living as a footnote in a generic overview page.
