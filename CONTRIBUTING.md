# Contributing to cmdIDE

Thank you for taking the time to contribute. This document covers how to report bugs, propose features, and submit pull requests.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Where to Start](#where-to-start)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Community Themes](#community-themes)
- [Community Plugins](#community-plugins)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold these standards. Report unacceptable behavior to the maintainers.

---

## Where to Start

| I want to… | What to do |
|---|---|
| Report a bug | [Open a Bug Report issue](https://github.com/Command-IDE/terminal-IDE/issues/new?template=bug_report.yml) |
| Request a feature | [Open a Feature Request issue](https://github.com/Command-IDE/terminal-IDE/issues/new?template=feature_request.yml) |
| Submit a theme | See the [themes repository](app/themes/CONTRIBUTING.md) |
| Build a plugin | See the [Plugin SDK](packages/) |
| Fix a typo or doc | Open a PR directly — no issue needed |
| Fix a small bug | Open a PR — reference the related issue if one exists |
| Build a large feature | **Open an issue first** to discuss the approach |

---

## Reporting Bugs

Use the [Bug Report](https://github.com/Command-IDE/terminal-IDE/issues/new?template=bug_report.yml) issue template. Include:

- Your OS and version
- Steps to reliably reproduce the issue
- What you expected vs. what actually happened
- Logs or screenshots if applicable

The more specific your report, the faster it can be triaged.

---

## Requesting Features

Use the [Feature Request](https://github.com/Command-IDE/terminal-IDE/issues/new?template=feature_request.yml) issue template. Good feature requests describe:

- The problem you're trying to solve (not just the solution you want)
- How you currently work around it, if at all
- Any prior art in other tools

Features that are narrow in scope and have clear user value get prioritized. Very large feature requests may be broken into smaller issues.

---

## Development Setup

### Requirements

- **Go** 1.21 or later
- **Node.js** 18 or later
- **Wails CLI** v2 — `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- **Git** with submodule support

### Clone and Initialize

```bash
git clone --recurse-submodules https://github.com/Command-IDE/terminal-IDE
cd terminal-IDE
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

### Run the Development Server

```bash
cd app
wails dev
```

This starts the Wails dev server with hot reload on both the Go backend and the React frontend. Changes to `.go` files restart the backend; changes to frontend files hot-reload in place.

### Run Tests

```bash
# Go tests
cd app
go test ./...

# Frontend type-check
cd app/frontend
npm run build
```

### Build for Release (Windows)

```powershell
# From repo root — produces all artifacts in build/
./build.ps1
```

---

## Making Changes

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/the-bug
   ```

2. **Make your changes.** Keep commits focused — one logical change per commit.

3. **Test your changes** locally. For UI changes, test on the target platform.

4. **Push** to your fork and **open a pull request** against `main`.

---

## Pull Request Guidelines

- **One concern per PR.** Don't bundle unrelated fixes together.
- **Reference the issue** your PR resolves: `Closes #123` in the PR description.
- **Fill out the PR template** completely. Incomplete descriptions slow down review.
- **Keep the diff focused.** Avoid reformatting files unrelated to your change.
- **All CI checks must pass** before a PR can be merged.
- **At least one maintainer approval** is required.

For significant UI changes, include before/after screenshots.

### PR Title Format

Use conventional commit style for PR titles:

```
feat: add split-panel editor support
fix: restore working directory on session reload
docs: update build instructions for Linux
refactor: extract ports module to sub-package
```

---

## Code Style

### Go

- Format with `gofmt` before committing — CI enforces this.
- Follow standard Go idioms. No unnecessary abstractions.
- Keep packages focused. New functionality that can be self-contained should go in a sub-package under `app/` (see `app/ports/`, `app/perf/`, etc.).
- No third-party linters required, but `go vet` must pass.

### TypeScript / React

- The project uses the ESLint config at `app/frontend/.eslintrc`. Run it before committing.
- Prefer editing existing files over creating new ones.
- Component files live in `app/frontend/src/components/`. Tab-level panels go alongside existing patterns.
- CSS custom properties are used for theming — don't hardcode colors.
- Comments in code: only when the *why* is non-obvious. Don't comment what the code does.

### SCSS (Themes)

- See [`app/themes/CONTRIBUTING.md`](app/themes/CONTRIBUTING.md) for the theme-specific style guide.

---

## Commit Messages

Write short, imperative-mood subject lines (under 72 characters):

```
Add session restore for split-panel editor
Fix port scanner returning stale entries on Windows
Remove unused perf_other.go file
```

Reference issues in the body, not the subject: `Fixes #42`.

---

## Community Themes

Themes live in their own repository at [`app/themes/`](app/themes/). To contribute a theme, follow the guide in [`app/themes/CONTRIBUTING.md`](app/themes/CONTRIBUTING.md) — the process is separate from PRs to the main app.

---

## Community Plugins

Plugins are built using the [cmdIDE Plugin SDK](packages/) and distributed via GitHub repositories. See the SDK documentation for how to build, test, and publish a plugin. Plugin PRs to this repo are not required — plugins are installed directly from their own GitHub repos via the in-app store.
