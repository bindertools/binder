import React, { isValidElement, startTransition, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { docs, docsByHref, docsBySection, getNeighborDocs } from './content'
import { slugify } from './markdown'
import {
  featuredDocHrefs,
  footerNavItems,
  githubRepo,
  navGroups,
  topNavItems,
} from './site'
import type { DocPage, NavItem } from './types'

const basePath = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '')

function stripBase(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (!basePath) {
    return normalized
  }

  if (normalized === basePath) {
    return '/'
  }

  if (normalized.startsWith(`${basePath}/`)) {
    return normalized.slice(basePath.length) || '/'
  }

  return normalized
}

function normalizeRoute(pathname: string): string {
  if (!pathname) {
    return '/'
  }

  const stripped = pathname.replace(/\/+$/, '')
  return stripped || '/'
}

function withBase(pathname: string): string {
  const normalized = normalizeRoute(pathname)
  if (!basePath) {
    return normalized
  }

  return normalized === '/' ? basePath : `${basePath}${normalized}`
}

function textFromNode(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(textFromNode).join('')
  }

  if (isValidElement(node)) {
    return textFromNode(node.props.children)
  }

  return ''
}

function isRouteInGroup(route: string, groupLabel: string): boolean {
  const section = docsByHref.get(route)?.section
  return section === groupLabel
}

function useCurrentRoute() {
  const [route, setRoute] = useState(() => normalizeRoute(stripBase(window.location.pathname)))

  useEffect(() => {
    const onPopState = () => {
      startTransition(() => {
        setRoute(normalizeRoute(stripBase(window.location.pathname)))
      })
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (href: string) => {
    const [rawPath, hash = ''] = href.split('#')
    const nextPath = normalizeRoute(rawPath || route)
    const nextUrl = `${withBase(nextPath)}${hash ? `#${hash}` : ''}`

    if (nextPath !== route || hash) {
      window.history.pushState({}, '', nextUrl)
    }

    if (nextPath !== route) {
      startTransition(() => {
        setRoute(nextPath)
      })
    }

    requestAnimationFrame(() => {
      if (hash) {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
    })
  }

  return { route, navigate }
}

function AppLink({
  item,
  currentRoute,
  navigate,
  className,
  children,
}: {
  item: NavItem
  currentRoute: string
  navigate: (href: string) => void
  className?: string
  children?: React.ReactNode
}) {
  const isCurrent = !item.external && currentRoute === item.href

  if (item.external) {
    return (
      <a className={className} href={item.href} rel="noreferrer" target="_blank">
        {children ?? item.label}
      </a>
    )
  }

  return (
    <a
      className={className}
      data-active={isCurrent || undefined}
      href={withBase(item.href)}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }

        event.preventDefault()
        navigate(item.href)
      }}
    >
      {children ?? item.label}
    </a>
  )
}

function MarkdownDoc({ doc, navigate }: { doc: DocPage; navigate: (href: string) => void }) {
  const counts = new Map<string, number>()

  const createHeading =
    (Tag: 'h2' | 'h3' | 'h4') =>
    ({ children }: { children?: React.ReactNode }) => {
      const text = textFromNode(children).trim()
      const baseId = slugify(text)
      const seen = counts.get(baseId) ?? 0
      counts.set(baseId, seen + 1)
      const id = seen === 0 ? baseId : `${baseId}-${seen + 1}`

      return <Tag id={id}>{children}</Tag>
    }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: createHeading('h2'),
        h3: createHeading('h3'),
        h4: createHeading('h4'),
        a: ({ href, children }) => {
          const safeHref = href ?? '#'
          if (safeHref.startsWith('/')) {
            return (
              <a
                href={withBase(safeHref)}
                onClick={(event) => {
                  event.preventDefault()
                  navigate(safeHref)
                }}
              >
                {children}
              </a>
            )
          }

          return (
            <a href={safeHref} rel="noreferrer" target={safeHref.startsWith('http') ? '_blank' : undefined}>
              {children}
            </a>
          )
        },
        code: ({ className, children, ...props }) => {
          const content = String(children).replace(/\n$/, '')
          if (!className) {
            return (
              <code {...props} className="inline-code">
                {content}
              </code>
            )
          }

          return (
            <code {...props} className={className}>
              {content}
            </code>
          )
        },
        table: ({ children }) => (
          <div className="md-table-wrap">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {doc.body}
    </ReactMarkdown>
  )
}

function Sidebar({
  currentRoute,
  navigate,
  mobileOpen,
  setMobileOpen,
}: {
  currentRoute: string
  navigate: (href: string) => void
  mobileOpen: boolean
  setMobileOpen: (value: boolean) => void
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navGroups.map((group) => [group.id, isRouteInGroup(currentRoute, group.label)])),
  )

  useEffect(() => {
    setOpenGroups((current) => {
      const next = { ...current }
      for (const group of navGroups) {
        if (isRouteInGroup(currentRoute, group.label)) {
          next[group.id] = true
        }
      }
      return next
    })
  }, [currentRoute])

  return (
    <>
      <button
        className="docs-overlay"
        data-open={mobileOpen || undefined}
        onClick={() => setMobileOpen(false)}
        type="button"
      />

      <aside className="docs-sidebar" data-open={mobileOpen || undefined}>
        <nav className="sidebar-nav" aria-label="Documentation navigation">
          <a
            className="sidebar-home-link"
            data-active={currentRoute === '/' || undefined}
            href={withBase('/')}
            onClick={(event) => {
              event.preventDefault()
              setMobileOpen(false)
              navigate('/')
            }}
          >
            cmdIDE Docs
          </a>

          <a
            className="sidebar-top-link"
            data-active={currentRoute === '/overview/about-cmdide' || undefined}
            href={withBase('/overview/about-cmdide')}
            onClick={(event) => {
              event.preventDefault()
              setMobileOpen(false)
              navigate('/overview/about-cmdide')
            }}
          >
            About cmdIDE
          </a>

          {navGroups.map((group) => {
            const section = docsBySection.find((entry) => entry.label === group.label)
            const items = section?.items ?? []
            const open = openGroups[group.id] ?? false

            return (
              <section className="sidebar-group" key={group.id}>
                <button
                  className="sidebar-group-toggle"
                  data-open={open || undefined}
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [group.id]: !open,
                    }))
                  }
                  type="button"
                >
                  <span>{group.label}</span>
                  <span className="sidebar-group-chevron" />
                </button>

                {open && (
                  <div className="sidebar-group-items">
                    {items.map((doc) => (
                      <a
                        className="sidebar-group-link"
                        data-active={currentRoute === doc.href || undefined}
                        href={withBase(doc.href)}
                        key={doc.href}
                        onClick={(event) => {
                          event.preventDefault()
                          setMobileOpen(false)
                          navigate(doc.href)
                        }}
                      >
                        {doc.title}
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </nav>
      </aside>
    </>
  )
}

function DocsHome({ navigate }: { navigate: (href: string) => void }) {
  const featuredDocs = docs.filter((doc) => featuredDocHrefs.includes(doc.href))

  return (
    <div className="docs-page">
      <a
        className="page-breadcrumb"
        href={withBase('/')}
        onClick={(event) => {
          event.preventDefault()
          navigate('/')
        }}
      >
        cmdIDE Docs
      </a>

      <hr />

      <section className="page-section">
        <h1>cmdIDE Docs</h1>
        <p className="page-lead">
          cmdIDE is a desktop terminal IDE with terminal tabs, editor tabs, preview tabs, problem scanning,
          database inspection, and local configuration persistence.
        </p>
      </section>

      <hr />

      <section className="page-section">
        <h2>Get Started</h2>
        <p>
          Install cmdIDE and run it. The standard user path is the installer build, while developers can still grab
          the direct application executable from releases.
        </p>

        <h3>Installation Instructions</h3>
        <p>Release artifacts for Windows, plus a source build path that runs the existing PowerShell build script.</p>

        <div className="action-row">
          <button className="outline-button outline-button-primary" onClick={() => navigate('/download')} type="button">
            Download
          </button>
          <button className="outline-button" onClick={() => navigate('/install/build-from-source')} type="button">
            Build from Source
          </button>
        </div>
      </section>

      <hr />

      <section className="page-section">
        <h2>Featured Documentation</h2>
        <div className="feature-grid">
          {featuredDocs.map((doc) => (
            <a
              className="feature-card"
              href={withBase(doc.href)}
              key={doc.href}
              onClick={(event) => {
                event.preventDefault()
                navigate(doc.href)
              }}
            >
              <h3>{doc.title}</h3>
              <p>{doc.description}</p>
            </a>
          ))}
        </div>
      </section>

      <a className="edit-link" href={`${githubRepo}/tree/main/docs`} rel="noreferrer" target="_blank">
        Edit on GitHub
      </a>
    </div>
  )
}

function UtilityPage({
  href,
  eyebrow,
  title,
  lead,
  children,
}: {
  href: string
  eyebrow: string
  title: string
  lead: string
  children: React.ReactNode
}) {
  return (
    <div className="docs-page docs-page-utility">
      <a className="page-breadcrumb" href={withBase(href)}>
        {eyebrow}
      </a>
      <hr />
      <section className="page-section">
        <h1>{title}</h1>
        <p className="page-lead">{lead}</p>
      </section>
      <hr />
      {children}
    </div>
  )
}

function DownloadPage() {
  return (
    <UtilityPage
      href="/download"
      eyebrow="Download"
      title="Download cmdIDE"
      lead="Release builds ship both the installer and the direct app executable so end users and developers can use the path that fits them."
    >
      <section className="page-section">
        <h2>Release Artifacts</h2>
        <div className="feature-grid">
          <div className="feature-card">
            <h3>cmdIDE-installer.exe</h3>
            <p>Recommended for normal installs and the default release artifact for most users.</p>
          </div>
          <div className="feature-card">
            <h3>cmdIDE.exe</h3>
            <p>Direct portable build for fast internal download, validation, and smoke testing.</p>
          </div>
        </div>
      </section>

      <hr />

      <section className="page-section">
        <h2>Build Contract</h2>
        <p>
          Releases run <code>./build.ps1</code>, which builds the main app, stages it into the installer assets, and
          produces both Windows executables for publication.
        </p>
      </section>
    </UtilityPage>
  )
}

function PolicyPage() {
  return (
    <UtilityPage
      href="/policy"
      eyebrow="Policy"
      title="Documentation and Release Policy"
      lead="The docs app is markdown-first for content pages and keeps only landing, download, and policy routes in React code."
    >
      <section className="page-section">
        <h2>Markdown-First Docs</h2>
        <p>
          Feature and workflow documentation lives under <code>docs/content</code>. The app shell renders those files
          into the navigation and content column automatically.
        </p>

        <h3>Special Pages</h3>
        <p>Landing, download, and policy routes remain code-defined so they can act as structured utility pages.</p>
      </section>

      <hr />

      <section className="page-section">
        <h2>Local Application State</h2>
        <p>
          cmdIDE writes configuration and session files into the local user config directory under the
          <code>cmdIDE</code> folder.
        </p>
      </section>
    </UtilityPage>
  )
}

function DocPageView({
  doc,
  navigate,
}: {
  doc: DocPage
  navigate: (href: string) => void
}) {
  const neighbors = getNeighborDocs(doc.href)

  return (
    <div className="docs-page">
      <div className="page-breadcrumbs">
        <a
          className="page-breadcrumb"
          href={withBase('/')}
          onClick={(event) => {
            event.preventDefault()
            navigate('/')
          }}
        >
          cmdIDE Docs
        </a>
        <span>/</span>
        <span>{doc.title}</span>
      </div>

      <hr />

      <section className="page-section">
        <h1>{doc.title}</h1>
        <p className="page-lead">{doc.description}</p>
      </section>

      <hr />

      <article className="markdown-body">
        <MarkdownDoc doc={doc} navigate={navigate} />
      </article>

      <hr />

      <div className="doc-bottom-row">
        <a
          className="edit-link"
          href={`${githubRepo}/blob/main/docs/content/${doc.slug}.md`}
          rel="noreferrer"
          target="_blank"
        >
          Edit on GitHub
        </a>

        <div className="doc-next-links">
          {neighbors.previous ? (
            <a
              className="doc-next-link"
              href={withBase(neighbors.previous.href)}
              onClick={(event) => {
                event.preventDefault()
                navigate(neighbors.previous!.href)
              }}
            >
              Previous: {neighbors.previous.title}
            </a>
          ) : null}
          {neighbors.next ? (
            <a
              className="doc-next-link"
              href={withBase(neighbors.next.href)}
              onClick={(event) => {
                event.preventDefault()
                navigate(neighbors.next!.href)
              }}
            >
              Next: {neighbors.next.title}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Footer({ currentRoute, navigate }: { currentRoute: string; navigate: (href: string) => void }) {
  return (
    <footer className="site-footer">
      <nav className="site-footer-links">
        {footerNavItems.map((item) => (
          <AppLink className="site-footer-link" currentRoute={currentRoute} item={item} key={item.href} navigate={navigate} />
        ))}
      </nav>
      <p>© 2026 cmdIDE</p>
    </footer>
  )
}

function NotFoundPage({ navigate }: { navigate: (href: string) => void }) {
  return (
    <div className="docs-page">
      <a
        className="page-breadcrumb"
        href={withBase('/')}
        onClick={(event) => {
          event.preventDefault()
          navigate('/')
        }}
      >
        cmdIDE Docs
      </a>
      <hr />
      <section className="page-section">
        <h1>Page not found</h1>
        <p className="page-lead">This route is not part of the current documentation tree.</p>
      </section>
    </div>
  )
}

export default function App() {
  const { route, navigate } = useCurrentRoute()
  const [mobileOpen, setMobileOpen] = useState(false)
  const currentDoc = docsByHref.get(route) ?? null
  const isDocsShellRoute = route === '/' || Boolean(currentDoc)

  useEffect(() => {
    setMobileOpen(false)

    if (currentDoc) {
      document.title = `${currentDoc.title} | cmdIDE Docs`
      return
    }

    if (route === '/download') {
      document.title = 'Download | cmdIDE Docs'
      return
    }

    if (route === '/policy') {
      document.title = 'Policy | cmdIDE Docs'
      return
    }

    document.title = 'cmdIDE Docs'
  }, [currentDoc, route])

  return (
    <div className="docs-app">
      <header className="topbar">
        <div className="topbar-left">
          <button className="mobile-toggle" onClick={() => setMobileOpen((open) => !open)} type="button">
            Menu
          </button>
          <a
            className="brand-lockup"
            href={withBase('/')}
            onClick={(event) => {
              event.preventDefault()
              navigate('/')
            }}
          >
            <span className="brand-icon" aria-hidden="true">
              <span className="brand-icon-face" />
            </span>
            <span className="brand-name">cmdIDE</span>
          </a>
        </div>

        <nav className="topbar-nav">
          {topNavItems.map((item) => (
            <AppLink className={`topbar-link${item.emphasis ? ' topbar-link-emphasis' : ''}`} currentRoute={route} item={item} key={item.href} navigate={navigate} />
          ))}
        </nav>
      </header>

      {isDocsShellRoute ? (
        <div className="docs-frame">
          <Sidebar currentRoute={route} mobileOpen={mobileOpen} navigate={navigate} setMobileOpen={setMobileOpen} />
          <main className="docs-main">
            {route === '/' && <DocsHome navigate={navigate} />}
            {route === '/overview/about-cmdide' && currentDoc && <DocPageView doc={currentDoc} navigate={navigate} />}
            {route !== '/' && route !== '/overview/about-cmdide' && currentDoc && <DocPageView doc={currentDoc} navigate={navigate} />}
            {!currentDoc && route !== '/' && route !== '/overview/about-cmdide' && <NotFoundPage navigate={navigate} />}
          </main>
        </div>
      ) : (
        <main className="docs-main docs-main-utility">
          {route === '/download' ? <DownloadPage /> : route === '/policy' ? <PolicyPage /> : <NotFoundPage navigate={navigate} />}
        </main>
      )}

      <Footer currentRoute={route} navigate={navigate} />
    </div>
  )
}
