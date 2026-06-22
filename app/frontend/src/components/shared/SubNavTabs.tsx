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
    <nav className={`flex items-stretch gap-0 ${className}`}>
      {items.map(item => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`inline-flex items-center font-medium font-ui cursor-pointer bg-transparent border-0 border-b-2 transition-[color,border-color] duration-100 whitespace-nowrap ${
              compact
                ? 'gap-[5px] px-2.5 py-[5px] text-[11px]'
                : 'gap-1.5 px-3.5 py-2 text-[12px] -mb-px'
            } ${
              active
                ? 'text-[var(--tab-color-hover)] border-b-[var(--accent)]'
                : 'text-[var(--tab-color)] border-b-transparent hover:text-[var(--tab-color-hover)]'
            }`}
          >
            {item.icon}
            {item.label}
            {item.count != null && (
              <span className={`font-semibold opacity-50 ${compact ? 'text-[9.5px]' : 'text-[10px]'}`}>
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
