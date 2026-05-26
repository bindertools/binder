import React from 'react'

interface Props { name: string; ext: string; isDir: boolean; isOpen?: boolean }

// ── Color palettes — kept intact for future theme use ────────────────────────
const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6',
  js: '#e8c84a', jsx: '#e8c84a', mjs: '#e8c84a', cjs: '#e8c84a',
  go: '#00acd7',
  py: '#3572a5',
  rs: '#dea584',
  json: '#cbcb41', jsonc: '#cbcb41',
  md: '#519aba', mdx: '#519aba',
  css: '#563d7c', scss: '#c6538c', sass: '#c6538c', less: '#1d365d',
  html: '#e44d26', htm: '#e44d26',
  sh: '#4eaa25', bash: '#4eaa25', zsh: '#4eaa25', fish: '#4eaa25',
  ps1: '#012456', psm1: '#012456',
  c: '#555599', h: '#a074c4', cpp: '#f34b7d', cc: '#f34b7d',
  cs: '#178600',
  java: '#b07219',
  rb: '#701516',
  php: '#4f5d95',
  swift: '#f05138',
  kt: '#a97bff', kts: '#a97bff',
  sql: '#dad8d8',
  graphql: '#e10098',
  xml: '#f1662a', svg: '#ff9a00',
  yaml: '#cb171e', yml: '#cb171e', toml: '#9c4121',
  env: '#ecd53f',
  lock: '#888888',
  log: '#aaaaaa',
  txt: '#cccccc',
  gitignore: '#f54d27', gitattributes: '#f54d27',
  dockerfile: '#0db7ed',
  makefile: '#427819',
  mod: '#00acd7', sum: '#00acd7',
}

const NAMED_FILE_COLORS: Record<string, string> = {
  dockerfile: '#0db7ed',
  makefile: '#427819', 'makefile.linux': '#427819',
  '.env': '#ecd53f', '.envrc': '#ecd53f',
  'package.json': '#e8c84a', 'tsconfig.json': '#3178c6',
  '.gitignore': '#f54d27', '.gitattributes': '#f54d27',
  'go.mod': '#00acd7', 'go.sum': '#00acd7',
  'readme.md': '#519aba',
  'license': '#aaaaaa',
}

const FOLDER_COLORS: Record<string, string> = {
  src: '#4ec9b0', source: '#4ec9b0',
  app: '#75beff', apps: '#75beff',
  lib: '#d4aa00', libs: '#d4aa00',
  test: '#75e05a', tests: '#75e05a', __tests__: '#75e05a', spec: '#75e05a',
  build: '#e8ae4a', dist: '#e8ae4a', out: '#e8ae4a', bin: '#e8ae4a',
  public: '#7ac070',
  assets: '#d4aa00', static: '#d4aa00',
  components: '#61afef', component: '#61afef',
  pages: '#c678dd',
  styles: '#c6538c', css: '#c6538c',
  config: '#6d8086', configs: '#6d8086', configuration: '#6d8086',
  scripts: '#4eaa25',
  docs: '#519aba', doc: '#519aba', documentation: '#519aba',
  node_modules: '#e8ae4a',
  '.git': '#f54d27',
  '.github': '#888888',
  frontend: '#61afef', backend: '#75beff',
  installer: '#e8ae4a',
  windows: '#0078d4', macos: '#aaaaaa', linux: '#dd4814',
}

function iconColor(name: string, ext: string): string {
  const lower = name.toLowerCase()
  if (NAMED_FILE_COLORS[lower]) return NAMED_FILE_COLORS[lower]
  return EXT_COLORS[ext] ?? '#7a8899'
}

function folderColor(name: string): string {
  return FOLDER_COLORS[name.toLowerCase()] ?? '#7a8899'
}

// ── Folder: outlined shape, stroke = theme color, barely-there fill tint ─────
function FolderShape({ color, open }: { color: string; open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="14" viewBox="0 0 16 14" fill="none" style={{ flexShrink: 0 }}>
        {/* back panel */}
        <path
          d="M1 4h14v7.5c0 .83-.67 1.5-1.5 1.5h-11C1.67 13 1 12.33 1 11.5V4z"
          fill={color + '20'} stroke={color} strokeWidth="1"
        />
        {/* tab */}
        <path
          d="M1 4V3.5C1 2.67 1.67 2 2.5 2H5.8l1.4 2H1z"
          fill={color + '30'} stroke={color} strokeWidth="1" strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M1 3.5C1 2.67 1.67 2 2.5 2H5.8l1.4 2H13.5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-11C1.67 12 1 11.33 1 10.5v-7z"
        fill={color + '20'} stroke={color} strokeWidth="1" strokeLinejoin="round"
      />
    </svg>
  )
}

// ── File: compact outlined document, corner fold, minimal fill ───────────────
function FileDoc({ color }: { color: string }) {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M2 1h7l3 3v10H2V1z"
        fill={color + '18'} stroke={color} strokeWidth="1" strokeLinejoin="round"
      />
      <path d="M9 1v3h3" fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function FileIcon({ name, ext, isDir, isOpen = false }: Props) {
  if (isDir) return <FolderShape color={folderColor(name)} open={isOpen} />
  return <FileDoc color={iconColor(name, ext)} />
}
