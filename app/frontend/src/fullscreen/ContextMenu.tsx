import React, { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label?: string
  icon?: React.ReactNode
  danger?: boolean
  divider?: boolean
  action?: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escape)
    }
  }, [onClose])

  // Clamp to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 260),
    left: Math.min(x, window.innerWidth - 200),
    zIndex: 9999,
  }

  return (
    <div ref={ref} className="ctx-menu" style={style}>
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="ctx-menu__divider" />
        ) : (
          <button
            key={i}
            className={`ctx-menu__item${item.danger ? ' ctx-menu__item--danger' : ''}`}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); item.action?.(); onClose() }}
          >
            {item.icon && <span className="ctx-menu__icon">{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
