export type PluginCategory = 'development' | 'productivity' | 'utilities' | 'other'

export interface DirectoryEntry {
  id: string
  name: string
  description: string
  author: string
  authorUrl?: string
  version: string
  githubUrl: string
  category: PluginCategory
  tags: string[]
  verified: boolean
  official: boolean
}

export const PLUGIN_DIRECTORY: DirectoryEntry[] = [
  {
    id: 'git',
    name: 'Git Insights',
    description: 'Stage, commit, pull, push and manage branches — a GitHub Desktop-style git panel right inside your terminal.',
    author: 'CMD IDE',
    authorUrl: 'https://github.com/cmdide',
    version: '1.0.0',
    githubUrl: 'https://github.com/cmdide/plugin-git',
    category: 'development',
    tags: ['git', 'version-control', 'source-control'],
    verified: true,
    official: true,
  },
  {
    id: 'notepad',
    name: 'Notepad',
    description: 'Persistent in-app notes with a sidebar list and a full-height editor. Notes survive app restarts.',
    author: 'CMD IDE',
    authorUrl: 'https://github.com/cmdide',
    version: '1.0.0',
    githubUrl: 'https://github.com/cmdide/plugin-notepad',
    category: 'productivity',
    tags: ['notes', 'writing', 'markdown'],
    verified: true,
    official: true,
  },
  {
    id: 'claude',
    name: 'Claude AI',
    description: 'Chat with Claude from Anthropic directly inside the IDE. Code suggestions include a one-click "Run in terminal" button.',
    author: 'CMD IDE',
    authorUrl: 'https://github.com/cmdide',
    version: '1.0.0',
    githubUrl: 'https://github.com/cmdide/plugin-claude',
    category: 'productivity',
    tags: ['ai', 'chat', 'assistant', 'claude', 'anthropic'],
    verified: true,
    official: true,
  },
]
