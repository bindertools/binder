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
