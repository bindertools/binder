---
title: Problems
description: Project scanning behavior and how structured issues are surfaced inside the workspace.
section: Features
order: 2
---

The problems surface turns code scanning output into a first-class tab.

## What it does

The backend scans a working directory and returns structured problem results that the frontend renders in a dedicated tab.

## Why this matters in the docs

Problem scanning is not just an implementation detail. It changes how users move through the app:

- run a scan
- review the results
- jump to files at specific lines
- fix and rescan

## Page patterns to preserve

Markdown pages for feature areas like this should capture:

- the workflow shape
- the inputs and outputs
- the tab interactions
- the rescan loop

> When the docs stay close to the actual workflow, the product feels learnable instead of mysterious.
