import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { ArrowUp, ArrowDown, Filter } from 'lucide-react'
import './SortableColumnHeader.scss'

export interface ColumnDef<K extends string> {
  key: K
  label: string
}

interface Props<K extends string> {
  label: string
  active: boolean
  sortAsc: boolean
  onSortAsc: () => void
  onSortDesc: () => void
  thClassName: string
  innerClassName: string
  filterContent?: React.ReactNode
  columns: ColumnDef<K>[]
  visibleColumns: Set<K>
  onToggleColumn: (key: K) => void
}

export default function SortableColumnHeader<K extends string>({
  label, active, sortAsc, onSortAsc, onSortDesc, thClassName, innerClassName,
  filterContent, columns, visibleColumns, onToggleColumn,
}: Props<K>) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setOpen(false); return }
      const target = e.target as Node
      if (menuRef.current?.contains(target) || btnRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const toggleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(o => !o)
  }

  return (
    <th className={thClassName}>
      <button type="button" ref={btnRef} className={`${innerClassName} col-th__btn`} onClick={toggleOpen}>
        <span>{label}</span>
        {active && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
        <Filter size={11} className="col-th__icon" />
      </button>
      {open && ReactDOM.createPortal(
        <div className="col-menu" ref={menuRef} style={{ top: pos.top, left: pos.left }}>
          <div className="col-menu__label">Sort</div>
          <button
            className={`col-menu__item${active && sortAsc ? ' col-menu__item--active' : ''}`}
            onClick={() => { onSortAsc(); setOpen(false) }}
          >
            <ArrowUp size={13} /> Ascending
          </button>
          <button
            className={`col-menu__item${active && !sortAsc ? ' col-menu__item--active' : ''}`}
            onClick={() => { onSortDesc(); setOpen(false) }}
          >
            <ArrowDown size={13} /> Descending
          </button>

          {filterContent && (
            <>
              <div className="col-menu__sep" />
              {filterContent}
            </>
          )}

          <div className="col-menu__sep" />
          <div className="col-menu__label">Show columns</div>
          {columns.map(c => (
            <label key={c.key} className="col-menu__checkbox">
              <input
                type="checkbox"
                checked={visibleColumns.has(c.key)}
                onChange={() => onToggleColumn(c.key)}
              />
              {c.label}
            </label>
          ))}
        </div>,
        document.body
      )}
    </th>
  )
}
