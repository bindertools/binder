import React from 'react'

interface Props { name: string; ext: string; isDir: boolean; isOpen?: boolean }

// All icons render with `currentColor` so they pick up `.fe-node__icon`'s
// color from the theme (see fullscreen.scss) — no per-type color palette.

const LOCK_NAMES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock'])
const IMAGE_EXTS = new Set(['svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'avif'])
const SCRIPT_EXTS = new Set(['sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1'])
const MARKUP_EXTS = new Set(['html', 'htm', 'xml', 'vue', 'svelte'])
const STYLE_EXTS = new Set(['css', 'scss', 'sass', 'less'])
const DATA_LIST_EXTS = new Set(['yaml', 'yml', 'toml'])
const CODE_EXTS = new Set(['js', 'ts', 'mjs', 'cjs'])

// ── Folder: flat single-tone shape ────────────────────────────────────────────
function FolderShape({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="14" viewBox="0 0 16 14" fill="none" style={{ flexShrink: 0 }}>
        {/* body */}
        <path
          d="M1 3.5C1 2.67 1.67 2 2.5 2H5.8l1.4 2H13.5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-11C1.67 12 1 11.33 1 10.5v-7z"
          fill="currentColor" fillOpacity="0.5"
        />
        {/* lifted front flap */}
        <path
          d="M1.2 5.8a1 1 0 0 1 .97-.8h11.66a1 1 0 0 1 .97 1.22l-.8 3.8a1.2 1.2 0 0 1-1.17.98H3.13a1.2 1.2 0 0 1-1.17-.98l-.8-3.8a1 1 0 0 1 .04-.42z"
          fill="currentColor"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M1 3.5C1 2.67 1.67 2 2.5 2H5.8l1.4 2H13.5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-11C1.67 12 1 11.33 1 10.5v-7z"
        fill="currentColor"
      />
    </svg>
  )
}

// ── Generic file: outlined document, corner fold ──────────────────────────────
function FileDoc() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M2 1h7l3 3v10H2V1z"
        fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"
      />
      <path d="M9 1v3h3" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ── React/component files (jsx/tsx): atom glyph ───────────────────────────────
function AtomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.1" fill="none">
        <ellipse cx="8" cy="8" rx="6.5" ry="2.6" />
        <ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(60 8 8)" />
        <ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(120 8 8)" />
      </g>
    </svg>
  )
}

// ── JS/TS/JSON: curly braces ───────────────────────────────────────────────────
function BracesIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M5.3 1.5c-1.4 0-2.1.8-2.1 2.1v1.7c0 .9-.4 1.4-1.7 1.7 1.3.3 1.7.8 1.7 1.7v1.7c0 1.3.7 2.1 2.1 2.1"
        stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M8.7 1.5c1.4 0 2.1.8 2.1 2.1v1.7c0 .9.4 1.4 1.7 1.7-1.3.3-1.7.8-1.7 1.7v1.7c0 1.3-.7 2.1-2.1 2.1"
        stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// ── package.json: hexagonal box ───────────────────────────────────────────────
function PackageIcon() {
  return (
    <svg width="14" height="15" viewBox="0 0 14 15" fill="none" style={{ flexShrink: 0 }}>
      <path d="M7 .8 12.8 4v6.3L7 13.5 1.2 10.3V4z"
        fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M1.2 4 7 7.3l5.8-3.3M7 7.3v6.2"
        stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── CSS/SCSS/LESS: hash ─────────────────────────────────────────────────────────
function HashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{ flexShrink: 0 }}>
      <path d="M5.2 1.5 3.4 12.5" />
      <path d="M10.6 1.5 8.8 12.5" />
      <path d="M2.3 5h10.4" />
      <path d="M1.4 9h10.4" />
    </svg>
  )
}

// ── HTML/XML/Vue: angle brackets ────────────────────────────────────────────────
function AngleIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M5.5 2 1.5 7l4 5" />
      <path d="M10.5 2 14.5 7l-4 5" />
    </svg>
  )
}

// ── Markdown: badge with "M" + down-arrow ───────────────────────────────────────
function MarkdownIcon() {
  return (
    <svg width="16" height="13" viewBox="0 0 16 13" fill="none" style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="15" height="12" rx="1.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1" />
      <path d="M2.5 9V4l2 2.5L6.5 4v5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 4v3.2M9.4 6 11 7.8 12.6 6" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Images: picture frame with mountains ────────────────────────────────────────
function ImageIcon() {
  return (
    <svg width="15" height="14" viewBox="0 0 15 14" fill="none" style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="14" height="13" rx="1.5" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1" />
      <circle cx="4.5" cy="4.5" r="1.3" fill="currentColor" />
      <path d="M1.5 11 5 7l2.5 2.7L11 6l3 4.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── YAML/TOML: stacked lines ─────────────────────────────────────────────────────
function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{ flexShrink: 0 }}>
      <path d="M1.5 2.5h11" />
      <path d="M1.5 7h11" />
      <path d="M1.5 11.5h7" />
    </svg>
  )
}

// ── Lockfiles: padlock ───────────────────────────────────────────────────────────
function LockIcon() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" style={{ flexShrink: 0 }}>
      <rect x="1.5" y="6.5" width="10" height="7" rx="1.3" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1" />
      <path d="M3.7 6.5V4.3a2.8 2.8 0 0 1 5.6 0v2.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="6.5" cy="10" r="1" fill="currentColor" />
    </svg>
  )
}

// ── .env: key ──────────────────────────────────────────────────────────────────
function KeyIcon() {
  return (
    <svg width="15" height="12" viewBox="0 0 15 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="4" cy="6" r="3" />
      <path d="M6.8 6H13M10.5 6V8.3M12.3 6V8" />
    </svg>
  )
}

// ── Shell/PowerShell scripts: terminal prompt ───────────────────────────────────
function ScriptIcon() {
  return (
    <svg width="15" height="13" viewBox="0 0 15 13" fill="none" style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="14" height="12" rx="1.5" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1" />
      <path d="M2.8 4 5 6.2 2.8 8.4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 8.4h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

// ── .gitignore / .gitattributes: branch ─────────────────────────────────────────
function GitIcon() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="3" cy="3" r="1.6" />
      <circle cx="3" cy="12" r="1.6" />
      <circle cx="10" cy="8" r="1.6" />
      <path d="M3 4.6V10.4" />
      <path d="M3 6.5a3.5 3.5 0 0 0 3.5 3.5H8.4" />
    </svg>
  )
}

export default function FileIcon({ name, ext, isDir, isOpen = false }: Props) {
  if (isDir) return <FolderShape open={isOpen} />

  const lower = name.toLowerCase()

  if (lower === 'package.json') return <PackageIcon />
  if (ext === 'lock' || LOCK_NAMES.has(lower)) return <LockIcon />
  if (ext === 'jsx' || ext === 'tsx') return <AtomIcon />
  if (CODE_EXTS.has(ext) || ext === 'json' || ext === 'jsonc') return <BracesIcon />
  if (STYLE_EXTS.has(ext)) return <HashIcon />
  if (MARKUP_EXTS.has(ext)) return <AngleIcon />
  if (ext === 'md' || ext === 'mdx') return <MarkdownIcon />
  if (IMAGE_EXTS.has(ext)) return <ImageIcon />
  if (DATA_LIST_EXTS.has(ext)) return <ListIcon />
  if (lower === '.env' || lower.startsWith('.env.')) return <KeyIcon />
  if (SCRIPT_EXTS.has(ext)) return <ScriptIcon />
  if (lower === '.gitignore' || lower === '.gitattributes') return <GitIcon />

  return <FileDoc />
}
