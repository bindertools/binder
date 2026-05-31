# Phase F — Tailwind CSS (Frontend)

## Overview

This phase is **completely independent** of the backend migration. It can be run at any point —
before Phase 0, between any two backend phases, or after Phase 5. It migrates `app/frontend/` from
hand-written CSS to Tailwind CSS v4 (the Vite-native version) without changing any component
behavior or visual design. This is a pure frontend refactor.

The design tokens are already established by the existing CSS:
- Surface: `#1c1c1e` / `#2c2c2e` / `#3a3a3c`
- Accent: `#0A84FF`
- Text: `#f5f5f7` (primary), `#8e8e93` (muted)
- Font UI: `system-ui, -apple-system, sans-serif`
- Font mono: `'Cascadia Code', 'Fira Code', 'Consolas', monospace`
- Dark mode only — no light mode toggle

---

## Git Workflow

**Branch:** `feat/cpp-migration` (already created in Phase 0) — or create a separate
`feat/tailwind` branch if running this phase independently and merging separately.

Commit after each component group migrated. Push when the phase is complete: `git push`

---

## Prompt F.1 — Tailwind CSS Integration

```
Context: terminal-IDE. The React/TSX frontend lives at app/frontend/. It uses hand-written CSS
files, some with BEM-style or custom-prefixed class names (e.g. .aim__* for the AI plugin). We
want to migrate to Tailwind CSS v4 using the Vite-native plugin (@tailwindcss/vite). Dark mode
only. No light mode.

Task: Integrate Tailwind CSS v4 into the frontend.

Step 1 — Install dependencies
  In app/frontend/:
    npm install -D tailwindcss @tailwindcss/vite

Step 2 — Vite config
  In app/frontend/vite.config.ts:
    import tailwindcss from "@tailwindcss/vite"
    Add tailwindcss() to the plugins array.

Step 3 — CSS entry point
  In app/frontend/src/index.css (or whatever the root CSS file is):
    Add @import "tailwindcss" at the top of the file.
    Define the design-system theme tokens using Tailwind v4's @theme block:

      @theme {
        --color-surface:       #1c1c1e;
        --color-surface-2:     #2c2c2e;
        --color-surface-3:     #3a3a3c;
        --color-accent:        #0A84FF;
        --color-accent-hover:  #409CFF;
        --color-text:          #f5f5f7;
        --color-text-muted:    #8e8e93;
        --color-border:        rgba(255,255,255,0.08);
        --color-destructive:   #FF453A;
        --font-mono:           'Cascadia Code', 'Fira Code', 'Consolas', monospace;
        --font-ui:             system-ui, -apple-system, sans-serif;
        --radius-sm:           4px;
        --radius-md:           8px;
        --radius-lg:           12px;
      }

Step 4 — Component migration
  Migrate components in this order (smallest/simplest first):
    1. DebugOverlay.tsx       — small, self-contained
    2. App.tsx wrapper divs   — layout only
    3. Tab bar components     — repeated patterns suit utility classes
    4. Sidebar components
    5. Terminal chrome
    6. Any remaining components

  For each component:
    - Replace CSS utility-style rules with Tailwind utility classes directly in JSX
    - Delete the corresponding .css file if it becomes empty after migration
    - For complex component CSS with many rules (e.g. scrollbar styling, animation keyframes),
      keep the .css file but replace repeated property groups with @apply

Step 5 — Plugin CSS — DO NOT TOUCH
  CRITICAL: Do NOT modify any CSS class names that begin with .aim__ or any other plugin-defined
  prefix. These are stable public API used by the plugin system. Plugin CSS files are off-limits
  for this prompt.

Step 6 — Verify
  npm run build must succeed with zero errors and zero new TypeScript errors.
  npm run build output bundle size should be equal to or smaller than before (Tailwind v4 purges
  unused classes at build time).

Constraints:
  - Do NOT change any component logic, props, event handlers, or behavior — style changes only
  - Do NOT change any Wails-bound method calls (window.go.main.App.*)
  - Do NOT introduce a light mode — the app is dark-only
  - Do NOT remove .aim__ or any other plugin class name — those are stable public API

Git commits — commit after each component group:
  1. Tailwind installed, Vite plugin wired, @theme tokens defined, npm run build passes:
       git commit -m "feat(frontend): install Tailwind CSS v4 with Vite plugin and design tokens"
  2. DebugOverlay and App.tsx wrapper divs migrated:
       git commit -m "refactor(frontend): migrate DebugOverlay and App layout to Tailwind utilities"
  3. Tab bar components migrated:
       git commit -m "refactor(frontend): migrate tab bar to Tailwind utilities"
  4. Sidebar components migrated:
       git commit -m "refactor(frontend): migrate sidebar to Tailwind utilities"
  5. Terminal chrome migrated; all remaining CSS cleaned up:
       git commit -m "refactor(frontend): migrate terminal chrome to Tailwind; remove empty CSS files"
  6. Final build verified (size equal or smaller, zero TS errors):
       git commit -m "chore(frontend): confirm Tailwind migration complete — build size and TS clean"
  7. Push:
       git push
```

### Effects
- `app/frontend/package.json`: `tailwindcss` + `@tailwindcss/vite` added as devDependencies
- `app/frontend/vite.config.ts`: Tailwind Vite plugin added
- `app/frontend/src/index.css`: `@import "tailwindcss"` + `@theme` token block added
- Various `.tsx` files: CSS class names replaced with Tailwind utility classes
- Various `.css` files: reduced (complex ones kept with `@apply`) or deleted entirely
- `aim__*` and all other plugin class names: **unchanged**
- Zero behavior or logic changes

---

## Phase F Checklist

- [ ] `npm run build` succeeds with no errors
- [ ] No TypeScript errors introduced
- [ ] App visual appearance is pixel-identical to before the migration
- [ ] Plugin CSS class names (`aim__*` etc.) are unchanged
- [ ] Bundle size is equal to or smaller than before Tailwind
- [ ] No new `.css` files added — only deletions or reductions
- [ ] `git log --oneline` shows a clean commit per component group
- [ ] Branch pushed and visible to collaborators
