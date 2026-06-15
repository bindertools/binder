import React from 'react'

export interface SubNavTabItem {
  id: string
  label: React.ReactNode
  icon?: React.ReactNode
  count?: React.ReactNode
}

interface SubNavTabsProps {
  items: SubNavTabItem[]
  activeId: string
  onSelect: (id: string) => void
  size?: 'default' | 'compact'
  className?: string
}

export default function SubNavTabs({ items, activeId, onSelect, size = 'default', className = '' }: SubNavTabsProps) {
  const compact = size === 'compact'
  return (
    <nav
      className={`inline-flex items-center shrink-0 border border-sep bg-surface-raised ${
        compact ? 'gap-[3px] p-[3px] rounded-[var(--r-md)]' : 'gap-1 p-1 rounded-[var(--r-lg)]'
      } ${className}`}
    >
      {items.map(item => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`flex items-center font-medium font-ui cursor-pointer border transition-[background,color,border-color] duration-100 ${
              compact ? 'gap-[5px] px-2.5 py-[5px] text-[11.5px] rounded-[var(--r-sm)]' : 'gap-2 px-3.5 py-2 text-[12.5px] rounded-[var(--r-md)]'
            } ${
              active
                ? 'bg-accent-dim border-accent-border text-[var(--tab-color-hover)]'
                : 'bg-transparent border-transparent text-[var(--tab-color)] hover:bg-[var(--app-bg)] hover:text-[var(--tab-color-hover)]'
            }`}
          >
            {item.icon}
            {item.label}
            {item.count != null && (
              <span
                className={`font-semibold leading-none rounded-full bg-[var(--surface-overlay)] ${
                  compact ? 'text-[9.5px] px-[4px] py-[1px]' : 'text-[10px] px-[5px] py-[1px]'
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
