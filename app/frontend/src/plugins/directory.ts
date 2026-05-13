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
