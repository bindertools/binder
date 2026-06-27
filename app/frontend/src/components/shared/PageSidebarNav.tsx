import React from 'react'

export interface PageSidebarNavItem {
  id: string
  label: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode
  action?: React.ReactNode
}

interface PageSidebarNavProps {
  items: PageSidebarNavItem[]
  activeId?: string | null
  onSelect: (id: string) => void
  className?: string
}

export default function PageSidebarNav({ items, activeId, onSelect, className = '' }: PageSidebarNavProps) {
  return (
    <div className={`flex flex-col ${className}`}>
      {items.map(item => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            className={`group flex items-start gap-2.5 w-full border-0 border-l-[3px] border-b border-b-[var(--sep)] text-left cursor-pointer transition-colors duration-100 py-[11px] pl-[14px] pr-3 ${
              active
                ? 'bg-[var(--accent-dim)] border-l-[var(--accent)]'
                : 'bg-transparent border-l-transparent hover:bg-[var(--surface-raised)]'
            }`}
            onClick={() => onSelect(item.id)}
          >
            {item.icon && (
              <span className={`flex items-center shrink-0 mt-0.5 ${active ? 'text-[var(--accent)]' : 'text-[var(--info-bar-color)] opacity-50'}`}>
                {item.icon}
              </span>
            )}
            <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`text-[12.5px] font-semibold truncate ${active ? 'text-[var(--accent-hover)]' : 'text-[var(--info-bar-hover-color)]'}`}>
                  {item.label}
                </span>
                {item.badge}
              </span>
              {item.subtitle && (
                <span className="text-[10.5px] font-mono text-[var(--info-bar-color)] opacity-50 truncate">
                  {item.subtitle}
                </span>
              )}
            </span>
            {item.meta && (
              <span className={`text-[10.5px] font-mono shrink-0 mt-0.5 ${active ? 'text-[var(--accent-hover)] opacity-70' : 'text-[var(--info-bar-color)] opacity-55'}`}>
                {item.meta}
              </span>
            )}
            {item.action && (
              <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-100 ml-1 mt-0.5">
                {item.action}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
