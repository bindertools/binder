import type { DocSection, NavItem } from './types'

export const githubRepo = 'https://github.com/KrisPowers/terminal-IDE'

export const topNavItems: Array<NavItem & { emphasis?: boolean }> = [
  { label: 'Docs', href: '/' },
  { label: 'GitHub', href: githubRepo, external: true },
  { label: 'Download', href: '/download', emphasis: true },
]

export const footerNavItems: NavItem[] = [
  { label: 'Docs', href: '/' },
  { label: 'GitHub', href: githubRepo, external: true },
  { label: 'Download', href: '/download' },
  { label: 'Policy', href: '/policy' },
]

export const docSections: DocSection[] = [
  { id: 'overview', label: 'Overview', description: 'Overview pages.' },
  { id: 'install', label: 'Install', description: 'Install guidance.' },
  { id: 'workspace', label: 'Workspace', description: 'Workspace behavior.' },
  { id: 'configuration', label: 'Configuration', description: 'Config and themes.' },
  { id: 'features', label: 'Features', description: 'Feature references.' },
  { id: 'help', label: 'Help', description: 'Troubleshooting and support.' },
]

export const navGroups = [
  { id: 'install', label: 'Install' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'features', label: 'Features' },
  { id: 'help', label: 'Help' },
]

export const featuredDocHrefs = [
  '/workspace/terminal-tabs',
  '/configuration/themes',
  '/configuration/settings',
  '/features/problems',
]
