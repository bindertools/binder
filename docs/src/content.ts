import { docSections } from './site'
import { estimateReadingMinutes, extractHeadings, parseMarkdownFile } from './markdown'
import type { DocPage } from './types'

const rawModules = import.meta.glob('../content/**/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

const sectionOrder = new Map(docSections.map((section, index) => [section.label, index]))

function normalizeSlug(sourcePath: string): string {
  return sourcePath
    .replace(/^\.\.\/content\//, '')
    .replace(/\.md$/, '')
    .replace(/\\/g, '/')
}

function buildDoc(sourcePath: string, raw: string): DocPage {
  const slug = normalizeSlug(sourcePath)
  const href = slug === 'index' ? '/' : `/${slug}`
  const { data, body } = parseMarkdownFile(raw)

  if (!data.title || !data.description || !data.section) {
    throw new Error(`Missing required frontmatter in ${sourcePath}`)
  }

  return {
    title: data.title,
    description: data.description,
    section: data.section,
    order: data.order ?? 0,
    slug,
    href,
    sourcePath,
    body,
    headings: extractHeadings(body),
    readingMinutes: estimateReadingMinutes(body),
  }
}

export const docs = Object.entries(rawModules)
  .map(([sourcePath, raw]) => buildDoc(sourcePath, raw))
  .sort((left, right) => {
    const leftSection = sectionOrder.get(left.section) ?? Number.MAX_SAFE_INTEGER
    const rightSection = sectionOrder.get(right.section) ?? Number.MAX_SAFE_INTEGER

    if (leftSection !== rightSection) {
      return leftSection - rightSection
    }

    if (left.order !== right.order) {
      return left.order - right.order
    }

    return left.title.localeCompare(right.title)
  })

export const docsByHref = new Map(docs.map((doc) => [doc.href, doc]))

export const docsBySection = docSections.map((section) => ({
  ...section,
  items: docs.filter((doc) => doc.section === section.label),
}))

export function getNeighborDocs(currentHref: string): {
  previous: DocPage | null
  next: DocPage | null
} {
  const index = docs.findIndex((doc) => doc.href === currentHref)
  if (index === -1) {
    return { previous: null, next: null }
  }

  return {
    previous: index > 0 ? docs[index - 1] : null,
    next: index < docs.length - 1 ? docs[index + 1] : null,
  }
}
