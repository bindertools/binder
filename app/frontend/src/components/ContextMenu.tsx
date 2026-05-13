import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import './ContextMenu.css'

export type ContextMenuEntry =
  | { kind: 'item'; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
  | { kind: 'sep' }

interface Props {
  x: number
  y: number
  entries: ContextMenuEntry[]
  onClose: () => void
}

export default function ContextMenu({ x, y, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') onClose()
        return
      }
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [onClose])

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - entries.length * 32 - 16),
  }

  return ReactDOM.createPortal(
    <div className="ctxmenu" ref={ref} style={style}>
      {entries.map((e, i) =>
        e.kind === 'sep'
          ? <div key={i} className="ctxmenu__sep" />
          : (
            <button
              key={i}
              className={`ctxmenu__item${e.danger ? ' ctxmenu__item--danger' : ''}${e.disabled ? ' ctxmenu__item--disabled' : ''}`}
              onMouseDown={ev => { ev.stopPropagation(); if (!e.disabled) { e.onClick(); onClose() } }}
            >
              {e.label}
            </button>
          )
      )}
    </div>,
    document.body
  )
}
