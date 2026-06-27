import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import type { PageId } from '../paneModel'
import type { SidebarPageEntry } from '../apps/sidebarRegistry'
import { useOrderedSidebarApps } from '../apps/sidebarRegistry'
import { reorderSidebarApp, moveSidebarAppToList } from '../apps/sidebarOrder'

export type { PageId }

// Show only the last two path segments (e.g. "C:/Users/foo/bar/baz" -> "bar/baz")
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length === 0) return '~'
  return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/')
}

interface Props {
  activePage:         PageId
  onNavigate:         (page: PageId) => void
  onSearch:           () => void
  onStartPageDrag:    (page: PageId, startX: number, startY: number) => void
  recentPaths:        string[]
  onSelectRecentPath: (path: string) => void
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const TerminalIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 11 2-2-2-2"/>
    <path d="M11 13h4"/>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
  </svg>
)

const EditorIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 22h4a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6"/>
    <path d="M14 2v5a1 1 0 0 0 1 1h5"/>
    <path d="M5 14a1 1 0 0 0-1 1v2a1 1 0 0 1-1 1 1 1 0 0 1 1 1v2a1 1 0 0 0 1 1"/>
    <path d="M9 22a1 1 0 0 0 1-1v-2a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-2a1 1 0 0 0-1-1"/>
  </svg>
)

const DebugIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 19.655A6 6 0 0 1 6 14v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 3.97"/>
    <path d="M14 15.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z"/>
    <path d="M14.12 3.88 16 2"/>
    <path d="M21 5a4 4 0 0 1-3.55 3.97"/>
    <path d="M3 21a4 4 0 0 1 3.81-4"/>
    <path d="M3 5a4 4 0 0 0 3.55 3.97"/>
    <path d="M6 13H2"/>
    <path d="m8 2 1.88 1.88"/>
    <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/>
  </svg>
)

const SearchIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

const SettingsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
)

const AppsIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h3a1 1 0 0 0 1-1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/>
  </svg>
)

const MoreIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="1"/>
    <circle cx="19" cy="12" r="1"/>
    <circle cx="5" cy="12" r="1"/>
  </svg>
)

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
  </svg>
)

// ── SidebarBtn ────────────────────────────────────────────────────────────────

interface BtnProps {
  active:       boolean
  label:        string
  onClick:      () => void
  onMouseDown?: (e: React.MouseEvent) => void
  dropBefore?:  boolean
  dropAfter?:   boolean
  children:     React.ReactNode
}

function SidebarBtn({ active, label, onClick, onMouseDown, dropBefore, dropAfter, children }: BtnProps) {
  // Drag cursor is applied globally via the `* { cursor: grabbing !important }`
  // overlay once a drag actually starts (see App.tsx pageDrag), so this stays
  // a plain pointer until then.
  const cursorCls = 'cursor-pointer'
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showTooltip = () => {
    timerRef.current = setTimeout(() => setTooltipVisible(true), 350)
  }

  const hideTooltip = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setTooltipVisible(false)
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const tooltipEl = tooltipVisible && btnRef.current
    ? ReactDOM.createPortal(
        (() => {
          const rect = btnRef.current.getBoundingClientRect()
          return (
            <div
              className="fixed z-[9999] px-2.5 py-1 rounded-md bg-[var(--info-bar-bg)] border border-sep text-[11.5px] font-ui text-[var(--info-bar-hover-color)] shadow-overlay select-none pointer-events-none whitespace-nowrap"
              style={{ left: rect.right + 8, top: Math.round(rect.top + rect.height / 2), transform: 'translateY(-50%)' }}
            >
              {label}
            </div>
          )
        })(),
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={btnRef}
        className={[
          `relative flex items-center justify-center w-10 h-10 rounded-md border-0 ${cursorCls} transition-[background,color] duration-[100ms] shrink-0`,
          active
            ? 'text-[var(--tab-color-hover)] bg-surface-overlay'
            : 'text-[var(--tab-color)] bg-transparent hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
          dropBefore ? 'shadow-[inset_0_2px_0_0_var(--accent)]' : '',
          dropAfter  ? 'shadow-[inset_0_-2px_0_0_var(--accent)]' : '',
        ].join(' ')}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        aria-label={label}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-r-full" />
        )}
        {children}
      </button>
      {tooltipEl}
    </>
  )
}

// ── Drag-and-drop reordering ──────────────────────────────────────────────────
// Custom mouse-based drag (matches the existing onStartPageDrag pattern used
// for page-to-pane-split elsewhere in this app) rather than native HTML5 DnD,
// so we have full control over hit-testing against the visible icon list and
// the more-menu button/popout.

interface DragPreview { listTarget: 'visible' | 'overflow'; index: number }

function pointInRect(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

// Index in `items` (by id, excluding `draggedId`) where a dropped item at
// clientY would land, based on each item's vertical midpoint.
function insertionIndex(items: { id: string; el: HTMLElement }[], draggedId: string, clientY: number): number {
  const others = items.filter(i => i.id !== draggedId)
  for (let i = 0; i < others.length; i++) {
    const r = others[i].el.getBoundingClientRect()
    if (clientY < r.top + r.height / 2) return i
  }
  return others.length
}

// ── MoreMenu ──────────────────────────────────────────────────────────────────
// On hover or click, opens a flyout to its right holding overflow app icons,
// Live Preview, and a Recent Paths shortcut list. Also a drop target: hovering
// it while dragging an app icon force-opens the flyout so apps can be dropped
// at a precise position in the overflow list, not just appended.

const OPEN_DELAY_MS  = 120
const CLOSE_DELAY_MS = 220

interface MoreMenuProps {
  active:             boolean
  overflowApps:       SidebarPageEntry[]
  activePage:         PageId
  onNavigate:         (page: PageId) => void
  recentPaths:        string[]
  onSelectRecentPath: (path: string) => void
  forceOpen:          boolean
  draggingId:         string | null
  dropPreview:        DragPreview | null
  onBtnRef:           (el: HTMLButtonElement | null) => void
  onItemRef:          (id: string, el: HTMLElement | null) => void
  onAppMouseDown:     (id: string, listTarget: 'overflow', e: React.MouseEvent) => void
}

function MoreMenu({
  active, overflowApps, activePage, onNavigate, recentPaths, onSelectRecentPath,
  forceOpen, draggingId, dropPreview, onBtnRef, onItemRef, onAppMouseDown,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false)
  const pinnedRef  = useRef(false)
  const btnRef     = useRef<HTMLButtonElement | null>(null)
  const menuRef    = useRef<HTMLDivElement>(null)
  const openTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (openTimer.current)  { clearTimeout(openTimer.current);  openTimer.current  = null }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])

  const scheduleOpen = () => {
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS)
  }

  const scheduleClose = () => {
    clearTimers()
    closeTimer.current = setTimeout(() => { if (!pinnedRef.current) setOpen(false) }, CLOSE_DELAY_MS)
  }

  const close = useCallback(() => {
    pinnedRef.current = false
    clearTimers()
    setOpen(false)
  }, [clearTimers])

  const handleClick = () => {
    if (open && pinnedRef.current) {
      close()
    } else {
      pinnedRef.current = true
      clearTimers()
      setOpen(true)
    }
  }

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, close])

  useEffect(() => clearTimers, [clearTimers])

  const isOpen = open || forceOpen

  const menuEl = isOpen && btnRef.current
    ? ReactDOM.createPortal(
        (() => {
          const rect = btnRef.current.getBoundingClientRect()
          return (
            <div
              ref={menuRef}
              className="fixed z-[9999] w-[230px] py-1.5 rounded-md bg-[var(--info-bar-bg)] border border-sep shadow-overlay font-ui select-none"
              style={{ left: rect.right + 6, top: rect.top }}
              onMouseEnter={() => clearTimers()}
              onMouseLeave={scheduleClose}
            >
              {overflowApps.length > 0 && (
                <>
                  <div className="px-3 pb-1 text-[10px] uppercase tracking-wider opacity-50">Apps</div>
                  {overflowApps.map((app, i) => {
                    const Icon = app.icon
                    const isDragged = draggingId === app.id
                    const dropBefore = dropPreview?.listTarget === 'overflow' && dropPreview.index === i
                    const dropAfter  = dropPreview?.listTarget === 'overflow' && dropPreview.index === overflowApps.length && i === overflowApps.length - 1
                    return (
                      <button
                        key={app.id}
                        ref={el => onItemRef(app.id, el)}
                        className={[
                          'flex items-center gap-2.5 w-full px-3 py-1.5 bg-transparent border-0 cursor-pointer text-[12px] text-left transition-colors',
                          activePage === app.id ? 'text-[var(--tab-color-hover)] bg-surface-overlay' : 'text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
                          isDragged ? 'opacity-40' : '',
                          dropBefore ? 'shadow-[inset_0_2px_0_0_var(--accent)]' : '',
                          dropAfter  ? 'shadow-[inset_0_-2px_0_0_var(--accent)]' : '',
                        ].join(' ')}
                        onClick={() => { close(); onNavigate(app.id) }}
                        onMouseDown={e => onAppMouseDown(app.id, 'overflow', e)}
                      >
                        <Icon />
                        {app.label}
                      </button>
                    )
                  })}
                  <div className="mx-3 my-1.5 h-px bg-sep" />
                </>
              )}

              <div className="px-3 pb-1 text-[10px] uppercase tracking-wider opacity-50">Recent Paths</div>
              {recentPaths.length === 0 ? (
                <div className="px-3 py-1.5 text-[11.5px] opacity-40">No recent paths yet</div>
              ) : (
                recentPaths.slice(0, 5).map(p => (
                  <button
                    key={p}
                    className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-0 cursor-pointer text-[11.5px] text-left text-[var(--tab-color)] hover:text-[var(--tab-color-hover)] hover:bg-surface-raised transition-colors font-mono"
                    title={p}
                    onClick={() => { close(); onSelectRecentPath(p) }}
                  >
                    <span className="shrink-0 opacity-60"><FolderIcon /></span>
                    <span className="truncate">{shortPath(p)}</span>
                  </button>
                ))
              )}
            </div>
          )
        })(),
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={el => { btnRef.current = el; onBtnRef(el) }}
        className={[
          'relative flex items-center justify-center w-10 h-10 rounded-md border-0 cursor-pointer transition-[background,color] duration-[100ms] shrink-0',
          (active || isOpen) || (draggingId && dropPreview?.listTarget === 'overflow')
            ? 'text-[var(--tab-color-hover)] bg-surface-overlay'
            : 'text-[var(--tab-color)] bg-transparent hover:text-[var(--tab-color-hover)] hover:bg-surface-raised',
        ].join(' ')}
        onClick={handleClick}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        aria-label="More"
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-r-full" />
        )}
        <MoreIcon />
      </button>
      {menuEl}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Sidebar({ activePage, onNavigate, onSearch, onStartPageDrag, recentPaths, onSelectRecentPath }: Props) {
  const { visible, overflow } = useOrderedSidebarApps()

  const visibleListRef = useRef<HTMLDivElement>(null)
  const moreBtnRef      = useRef<HTMLButtonElement | null>(null)
  const visibleItemRefs  = useRef(new Map<string, HTMLElement>())
  const overflowItemRefs = useRef(new Map<string, HTMLElement>())

  const [draggingId, setDraggingId]   = useState<string | null>(null)
  const [dropPreview, setDropPreview] = useState<DragPreview | null>(null)
  const dropPreviewRef = useRef<DragPreview | null>(null)
  const setPreview = (p: DragPreview | null) => { dropPreviewRef.current = p; setDropPreview(p) }

  const handleAppMouseDown = useCallback((id: string, fromList: 'visible' | 'overflow', e: React.MouseEvent) => {
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
        dragging = true
        document.body.style.cursor = 'grabbing'
        setDraggingId(id)
      }

      const visibleRect = visibleListRef.current?.getBoundingClientRect()
      const moreRect     = moreBtnRef.current?.getBoundingClientRect()

      if (visibleRect && pointInRect(ev.clientX, ev.clientY, visibleRect)) {
        const items = visible.map(a => ({ id: a.id, el: visibleItemRefs.current.get(a.id) })).filter((x): x is { id: string; el: HTMLElement } => !!x.el)
        setPreview({ listTarget: 'visible', index: insertionIndex(items, id, ev.clientY) })
      } else if (overflowItemRefs.current.size > 0 &&
                 [...overflowItemRefs.current.values()].some(el => pointInRect(ev.clientX, ev.clientY, el.getBoundingClientRect()))) {
        const items = overflow.map(a => ({ id: a.id, el: overflowItemRefs.current.get(a.id) })).filter((x): x is { id: string; el: HTMLElement } => !!x.el)
        setPreview({ listTarget: 'overflow', index: insertionIndex(items, id, ev.clientY) })
      } else if (moreRect && pointInRect(ev.clientX, ev.clientY, moreRect)) {
        setPreview({ listTarget: 'overflow', index: overflow.length })
      } else {
        setPreview(null)
      }
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      const preview = dropPreviewRef.current
      if (dragging && preview) {
        if (preview.listTarget === fromList) reorderSidebarApp(id, preview.index)
        else moveSidebarAppToList(id, preview.listTarget, preview.index)
      }
      setDraggingId(null)
      setPreview(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [visible, overflow])

  return (
    <div
      className="flex flex-col items-center w-[48px] shrink-0 bg-[var(--app-bg)] border-r border-[var(--border-color)] pb-1.5 select-none"
      style={{ ['--wails-draggable' as any]: 'no-drag' }}
    >
      {/* Branding placeholder — aligns with the pane tab bar height */}
      <div className="h-9 w-full shrink-0 border-b border-[var(--border-color)]" />

      {/* Features */}
      <div className="flex flex-col items-center gap-0.5 flex-1 pt-1.5">
        <SidebarBtn active={activePage === 'terminal'} label="Terminal" onClick={() => onNavigate('terminal')} onMouseDown={e => onStartPageDrag('terminal', e.clientX, e.clientY)}>
          <TerminalIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'editor'} label="Code Editor" onClick={() => onNavigate('editor')} onMouseDown={e => onStartPageDrag('editor', e.clientX, e.clientY)}>
          <EditorIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'debug'} label="Debug" onClick={() => onNavigate('debug')} onMouseDown={e => onStartPageDrag('debug', e.clientX, e.clientY)}>
          <DebugIcon />
        </SidebarBtn>

        {/* Apps installed via the App Store that claim a sidebar slot, in the
            user's custom order. Drag to reorder, or drag onto/out of the
            more-menu button below to move between the visible row and overflow. */}
        <div ref={visibleListRef} className="flex flex-col items-center gap-0.5">
          {visible.map((app, i) => {
            const Icon = app.icon
            const isDragged = draggingId === app.id
            const dropBefore = dropPreview?.listTarget === 'visible' && dropPreview.index === i
            const dropAfter  = dropPreview?.listTarget === 'visible' && dropPreview.index === visible.length && i === visible.length - 1
            return (
              <div key={app.id} ref={el => { if (el) visibleItemRefs.current.set(app.id, el); else visibleItemRefs.current.delete(app.id) }}>
                <SidebarBtn
                  active={activePage === app.id}
                  label={app.label}
                  onClick={() => onNavigate(app.id)}
                  onMouseDown={e => handleAppMouseDown(app.id, 'visible', e)}
                  dropBefore={dropBefore}
                  dropAfter={dropAfter}
                >
                  <span className={isDragged ? 'opacity-40' : ''}><Icon /></span>
                </SidebarBtn>
              </div>
            )
          })}
        </div>

        <MoreMenu
          active={overflow.some(a => a.id === activePage)}
          overflowApps={overflow}
          activePage={activePage}
          onNavigate={onNavigate}
          recentPaths={recentPaths}
          onSelectRecentPath={onSelectRecentPath}
          forceOpen={!!draggingId && dropPreview?.listTarget === 'overflow'}
          draggingId={draggingId}
          dropPreview={dropPreview}
          onBtnRef={el => { moreBtnRef.current = el }}
          onItemRef={(id, el) => { if (el) overflowItemRefs.current.set(id, el); else overflowItemRefs.current.delete(id) }}
          onAppMouseDown={(id, listTarget, e) => handleAppMouseDown(id, listTarget, e)}
        />
        <SidebarBtn active={false} label="Search (Ctrl+K)" onClick={onSearch}>
          <SearchIcon />
        </SidebarBtn>
      </div>

      {/* Utilities */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="w-6 h-px bg-sep mb-1" />
        <SidebarBtn active={activePage === 'apps'} label="App Store" onClick={() => onNavigate('apps')}>
          <AppsIcon />
        </SidebarBtn>
        <SidebarBtn active={activePage === 'settings'} label="Settings" onClick={() => onNavigate('settings')}>
          <SettingsIcon />
        </SidebarBtn>
      </div>
    </div>
  )
}
