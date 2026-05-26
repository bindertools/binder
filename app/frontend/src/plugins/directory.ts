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
  official: boolean
}

export const PLUGIN_DIRECTORY: DirectoryEntry[] = [
  {
    id: 'ai',
    name: 'AI Chat Manager',
    description: 'Local Ollama chat manager with a two-panel workspace and persistent multi-chat sessions. Runs entirely on-device.',
    author: 'CMD IDE',
    authorUrl: 'https://github.com/Command-IDE',
    version: '1.0.0',
    githubUrl: 'https://github.com/Command-IDE/ai-plugin',
    category: 'productivity',
    tags: ['ai', 'ollama', 'chat', 'llm', 'local'],
    official: true,
  },
  {
    id: 'git',
    name: 'Git Insights',
    description: 'GitHub Desktop-style git UI: stage, commit, pull/push, branch management, and file-explorer git status indicators.',
    author: 'CMD IDE',
    authorUrl: 'https://github.com/Command-IDE',
    version: '1.0.0',
    githubUrl: 'https://github.com/Command-IDE/git',
    category: 'development',
    tags: ['git', 'version control', 'source control', 'github', 'commit'],
    official: true,
  },
  {
    id: 'notepad',
    name: 'Notepad',
    description: 'Persistent in-app notes with a sidebar list and a full-height editor. Notes survive app restarts.',
    author: 'CMD IDE',
    authorUrl: 'https://github.com/Command-IDE',
    version: '1.0.0',
    githubUrl: 'https://github.com/Command-IDE/notepad',
    category: 'productivity',
    tags: ['notes', 'writing', 'markdown'],
    official: true,
  },
]
