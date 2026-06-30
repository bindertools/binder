import React, { useEffect } from 'react'

interface Props {
  targets: Array<{ name: string; isDir: boolean }>
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteConfirmDialog({ targets, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onConfirm, onCancel])

  const isSingle = targets.length === 1
  const title    = isSingle
    ? `Delete ${targets[0].isDir ? 'Folder' : 'File'}`
    : `Delete ${targets.length} Items`

  return (
    <div className="del-dialog-overlay" onMouseDown={onCancel}>
      <div className="del-dialog" onMouseDown={e => e.stopPropagation()}>
        <div className="del-dialog__title">{title}</div>
        <div className="del-dialog__body">
          {isSingle ? (
            <>
              Are you sure you want to delete <strong>"{targets[0].name}"</strong>?
              {targets[0].isDir && (
                <span className="del-dialog__warn"> All contents will be removed.</span>
              )}
            </>
          ) : (
            <>
              Are you sure you want to delete <strong>{targets.length} items</strong>?
              <span className="del-dialog__warn"> Folders and their contents will be removed.</span>
            </>
          )}
          <span className="del-dialog__note"> This cannot be undone.</span>
        </div>
        <div className="del-dialog__actions">
          <button className="del-dialog__btn del-dialog__btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="del-dialog__btn del-dialog__btn--delete" onClick={onConfirm} autoFocus>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
