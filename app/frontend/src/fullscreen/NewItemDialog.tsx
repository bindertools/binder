import React, { useState, useRef, useEffect, useCallback } from 'react'

const FILE_TYPES = [
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.go', '.rs', '.rb',
  '.html', '.css', '.scss',
  '.json', '.yaml', '.toml', '.xml',
  '.md', '.txt', '.sh', '.env',
]

interface Props {
  kind: 'file' | 'folder'
  onConfirm: (filename: string) => void
  onCancel: () => void
}

export default function NewItemDialog({ kind, onConfirm, onCancel }: Props) {
  const [name, setName] = useState('')
  const [ext,  setExt]  = useState('.ts')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  // If the user typed a dot into the name, treat it as a full filename and
  // ignore the extension picker entirely.
  const nameHasExt = name.includes('.')
  const preview    = kind === 'folder' ? name.trim()
                   : nameHasExt        ? name.trim()
                   :                    (name.trim() || 'filename') + ext

  const handleConfirm = useCallback(() => {
    const trimmed = name.trim()
    if (!trimmed) return
    const filename = kind === 'folder' ? trimmed
                   : nameHasExt        ? trimmed
                   :                    trimmed + ext
    onConfirm(filename)
  }, [name, ext, kind, nameHasExt, onConfirm])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); handleConfirm() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel()      }
    e.stopPropagation()
  }

  return (
    <div className="ni-overlay" onMouseDown={onCancel}>
      <div className="ni-dialog" onMouseDown={e => e.stopPropagation()}>

        <div className="ni-title">
          {kind === 'file' ? 'New File' : 'New Folder'}
        </div>

        {/* Name row — shows live preview of the final filename */}
        <label className="ni-label">Name</label>
        <div className="ni-name-row">
          <input
            ref={nameRef}
            className="ni-input"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={onKey}
            placeholder={kind === 'file' ? 'filename' : 'folder-name'}
            spellCheck={false}
            autoComplete="off"
          />
          {kind === 'file' && !nameHasExt && (
            <span className="ni-ext-badge">{ext}</span>
          )}
        </div>

        {/* Preview of the final filename */}
        {name.trim() && (
          <div className="ni-preview">
            {kind === 'file' ? '📄' : '📁'} {preview}
          </div>
        )}

        {/* Extension / type picker — files only */}
        {kind === 'file' && !nameHasExt && (
          <>
            <label className="ni-label ni-label--type">Type</label>
            <div className="ni-chips">
              {FILE_TYPES.map(e => (
                <button
                  key={e}
                  className={`ni-chip${ext === e ? ' ni-chip--active' : ''}`}
                  onMouseDown={ev => { ev.preventDefault(); setExt(e) }}
                  tabIndex={-1}
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="ni-actions">
          <button className="ni-btn ni-btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="ni-btn ni-btn--create"
            onClick={handleConfirm}
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
