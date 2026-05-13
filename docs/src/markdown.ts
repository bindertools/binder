import type { HeadingLink } from './types'

interface FrontmatterData {
  title?: string
  description?: string
  section?: string
  order?: number
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[`'".,!?()[\]{}:]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseMarkdownFile(raw: string): { data: FrontmatterData; body: string } {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!frontmatterMatch) {
    return { data: {}, body: raw.trim() }
  }

  const [, frontmatter, body] = frontmatterMatch
  const data: FrontmatterData = {}

  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separator = trimmed.indexOf(':')
    if (separator === -1) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')

    if (key === 'order') {
      data.order = Number(value)
      continue
    }

    if (key === 'title' || key === 'description' || key === 'section') {
      data[key] = value
    }
  }

  return { data, body: body.trim() }
}

export function extractHeadings(markdown: string): HeadingLink[] {
  const headings: HeadingLink[] = []
  const counts = new Map<string, number>()
  let inCodeFence = false

  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) {
      inCodeFence = !inCodeFence
      continue
    }

    if (inCodeFence) {
      continue
    }

    const match = line.match(/^(##|###|####)\s+(.+)$/)
    if (!match) {
      continue
    }

    const [, hashes, rawText] = match
    const text = rawText.replace(/\s+\{#.+\}$/, '').trim()
    const baseId = slugify(text)
    const seen = counts.get(baseId) ?? 0
    counts.set(baseId, seen + 1)
    const id = seen === 0 ? baseId : `${baseId}-${seen + 1}`

    headings.push({
      id,
      text,
      depth: hashes.length as 2 | 3 | 4,
    })
  }

  return headings
}

export function estimateReadingMinutes(markdown: string): number {
  const words = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length

  return Math.max(1, Math.round(words / 180))
}
