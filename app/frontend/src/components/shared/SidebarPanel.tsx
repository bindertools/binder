import React from 'react'
import PageSidebarNav, { PageSidebarNavItem } from './PageSidebarNav'

interface SidebarPanelProps {
  title?: string
  headerRight?: React.ReactNode
  items?: PageSidebarNavItem[]
  activeId?: string | null
  onSelect?: (id: string) => void
  footer?: React.ReactNode
  emptyMessage?: React.ReactNode
  children?: React.ReactNode
}

export default function SidebarPanel({
  title, headerRight, items = [], activeId, onSelect, footer, emptyMessage, children,
}: SidebarPanelProps) {
  return (
    <aside className="w-[260px] shrink-0 flex flex-col border-r border-[var(--sep)] overflow-hidden bg-[var(--app-bg)]">
      {title && (
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--sep)] shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--info-bar-color)]">{title}</span>
          {headerRight}
        </div>
      )}
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {children}
        {items.length > 0 && onSelect ? (
          <PageSidebarNav items={items} activeId={activeId} onSelect={onSelect} />
        ) : children == null && items.length === 0 && emptyMessage ? (
          <div className="px-2 py-4 text-[11px] text-[var(--info-bar-color)] opacity-60 text-center">{emptyMessage}</div>
        ) : null}
      </div>
      {footer && (
        <div className="border-t border-[var(--sep)] shrink-0">{footer}</div>
      )}
    </aside>
  )
}
