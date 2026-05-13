---
title: Themes
description: Preset themes, custom color maps, and how theme changes propagate through the app.
section: Configuration
order: 2
---

The theme system is not just a CSS skin. It feeds both the shell surface and the code-editing stack.

## Preset and custom themes

cmdIDE supports:

- named preset themes
- a `custom` theme mode
- saved custom color overrides

## Propagation path

Custom colors are converted into one resolved theme object and then applied across the app.

### The three visual layers

1. shell CSS variables
2. terminal colors
3. Monaco editor theme data

## Saved custom colors

When a custom theme is persisted, the app stores a flat key-value color map in config. That lets the frontend rehydrate the theme without inventing a second storage format.

## Good documentation examples

Theme pages are a great place for markdown because they benefit from:

- lists of supported keys
- before-and-after notes
- code fences for JSON examples
- future screenshots if you add them later

```json
{
  "theme": "custom",
  "custom_theme": {
    "shell_appBg": "#0d0d0d",
    "editor_bg": "#111111",
    "terminal_cursor": "#f2f2f2"
  }
}
```
