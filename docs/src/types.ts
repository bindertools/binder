export interface HeadingLink {
  id: string
  text: string
  depth: 2 | 3 | 4
}

export interface DocPage {
  title: string
  description: string
  section: string
  order: number
  slug: string
  href: string
  sourcePath: string
  body: string
  headings: HeadingLink[]
  readingMinutes: number
}

export interface DocSection {
  id: string
  label: string
  description: string
}

export interface NavItem {
  label: string
  href: string
  external?: boolean
}
