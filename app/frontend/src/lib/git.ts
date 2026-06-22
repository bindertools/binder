import { invoke } from './ipc'
import type { GitStatus, GitStash } from '../types'

export type { GitStatus, GitStash }
export type { GitFileEntry } from '../types'

export interface GitBranches {
  branches: string[]
  current: string
}

export const git = {
  status:    (path: string) =>
    invoke<GitStatus>('git.status', { path }),

  diff:      (path: string, file: string, staged = false) =>
    invoke<{ diff: string }>('git.diff', { path, file, staged }),

  diffLines: (path: string, file: string) =>
    invoke<{ diff: string; untracked: boolean }>('git.diff.lines', { path, file }),

  add:       (path: string, file = '') =>
    invoke<Record<string, never>>('git.add', { path, file }),

  reset:     (path: string, file = '') =>
    invoke<Record<string, never>>('git.reset', { path, file }),

  discard:   (path: string, file: string, untracked = false) =>
    invoke<Record<string, never>>('git.discard', { path, file, untracked }),

  stash:     (path: string, message = '') =>
    invoke<{ output: string }>('git.stash', { path, message }),

  stashList: (path: string) =>
    invoke<{ stashes: GitStash[] }>('git.stash.list', { path }),

  stashPop:  (path: string, ref: string) =>
    invoke<{ output: string }>('git.stash.pop', { path, ref }),

  stashDrop: (path: string, ref: string) =>
    invoke<{ output: string }>('git.stash.drop', { path, ref }),

  commit:    (path: string, message: string) =>
    invoke<{ output: string }>('git.commit', { path, message }),

  push:      (path: string) =>
    invoke<{ output: string }>('git.push', { path }),

  pull:      (path: string) =>
    invoke<{ output: string }>('git.pull', { path }),

  branches:  (path: string) =>
    invoke<GitBranches>('git.branches', { path }),

  checkout:  (path: string, branch: string) =>
    invoke<{ output: string }>('git.checkout', { path, branch }),
}

// Parses a `-U0 HEAD` unified diff (as returned by `git.diffLines`) into the
// set of 0-based line numbers added/modified in the working copy. Pure
// deletions (a hunk whose "+" side has zero lines) have no surviving line
// to mark and are skipped. Untracked files have no diff at all — the whole
// file counts as new.
export function parseChangedLines(diff: string, untracked: boolean, lineCount: number): Set<number> {
  const changed = new Set<number>()
  if (untracked) {
    for (let i = 0; i < lineCount; i++) changed.add(i)
    return changed
  }
  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
  for (const line of diff.split('\n')) {
    const m = hunkRe.exec(line)
    if (!m) continue
    const start = parseInt(m[1], 10)
    const count = m[2] !== undefined ? parseInt(m[2], 10) : 1
    for (let i = 0; i < count; i++) changed.add(start - 1 + i)
  }
  return changed
}
