import React, { useEffect } from 'react'

interface Props {
  name: string
  isDir: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteConfirmDialog({ name, isDir, onConfirm, onCancel }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onConfirm, onCancel])

  return (
    <div className="del-dialog-overlay" onMouseDown={onCancel}>
      <div className="del-dialog" onMouseDown={e => e.stopPropagation()}>
        <div className="del-dialog__title">
          Delete {isDir ? 'Folder' : 'File'}
        </div>
        <div className="del-dialog__body">
          Are you sure you want to delete <strong>"{name}"</strong>?
          {isDir && (
            <span className="del-dialog__warn"> All contents will be removed.</span>
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
