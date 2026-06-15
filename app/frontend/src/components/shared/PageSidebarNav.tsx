import React from 'react'

export interface PageSidebarNavItem {
  id: string
  label: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode
}

interface PageSidebarNavProps {
  items: PageSidebarNavItem[]
  activeId?: string | null
  onSelect: (id: string) => void
  className?: string
}

export default function PageSidebarNav({ items, activeId, onSelect, className = '' }: PageSidebarNavProps) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {items.map(item => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            className={`flex items-start gap-2 w-full px-2.5 py-2 rounded-sm border-0 bg-transparent text-left cursor-pointer transition-colors ${
              active
                ? 'bg-[var(--accent-dim)] text-[var(--accent-hover)]'
                : 'text-[var(--info-bar-color)] hover:bg-[var(--surface-raised)] hover:text-[var(--info-bar-hover-color)]'
            }`}
            onClick={() => onSelect(item.id)}
          >
            {item.icon && (
              <span className={`flex items-center shrink-0 mt-px ${active ? 'opacity-85' : 'opacity-55'}`}>
                {item.icon}
              </span>
            )}
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-[12.5px] font-medium truncate">{item.label}</span>
                {item.badge}
              </span>
              {item.subtitle && (
                <span className="text-[10.5px] font-mono text-[var(--info-bar-color)] opacity-50 truncate">
                  {item.subtitle}
                </span>
              )}
            </span>
            {item.meta && (
              <span className={`text-[10.5px] font-mono shrink-0 ${active ? 'text-[var(--accent-hover)] opacity-70' : 'text-[var(--info-bar-color)] opacity-65'}`}>
                {item.meta}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
