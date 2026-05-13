---
title: Troubleshooting
description: Common build and runtime notes drawn from the current codebase and workflow setup.
section: Help
order: 1
---

This page collects a few practical notes that match the current repository layout and workflows.

## Frontend dependency installs

The frontends in this repository use npm-based installs and build through Vite. If a docs or app frontend fails to start, make sure dependencies are installed in the relevant project directory.

## Release artifacts

If a GitHub release is missing expected binaries, verify that the release workflow completed the following steps:

1. set up Node and Go
2. install the Wails CLI
3. run `./build.ps1`
4. verify both output executables
5. upload them to the release

## Config resets

If theme or settings behavior looks off after schema changes, remove the local cmdIDE config directory and let the app regenerate defaults on next launch.

## Useful checks

| Area | Check |
| --- | --- |
| Go | `go test ./...` and `go vet ./...` |
| Frontend | `npm run build` |
| Full Windows build | `.\build.ps1` |

## Documentation changes

If a docs route renders but does not appear in the sidebar, confirm the markdown file includes valid frontmatter:

```yaml
---
title: Example
description: Short summary
section: Help
order: 1
---
```
