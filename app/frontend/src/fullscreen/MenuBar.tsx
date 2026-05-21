import { useState, useEffect, useRef, useCallback } from 'react'
import './MenuBar.css'

type Act = () => void

type MenuItem =
  | { kind: 'action'; label: string; shortcut?: string; run: Act }
  | { kind: 'separator' }

interface Menu { label: string; items: MenuItem[] }

interface Props {
  onSave:            Act
  onCloseActive:     Act
  onCloseAll:        Act
  onToggleExplorer:  Act
  onToggleSplit:     Act
  onZoomIn:          Act
  onZoomOut:         Act
  onResetZoom:       Act
  getEditor:         () => any
}

export default function MenuBar({
  onSave, onCloseActive, onCloseAll,
  onToggleExplorer, onToggleSplit,
  onZoomIn, onZoomOut, onResetZoom,
  getEditor,
}: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Run a menu action then close the dropdown
  const exec = useCallback((fn: Act) => { setOpen(null); fn() }, [])

  // Trigger a Monaco editor command by ID
  const trigger = useCallback((cmd: string) => {
    setOpen(null)
    const ed = getEditor()
    if (ed) { ed.focus(); ed.trigger('menu', cmd, null) }
  }, [getEditor])

  // Open a URL in the in-app preview tab
  const openUrl = (url: string) =>
    window.dispatchEvent(new CustomEvent('ide:open-url', { detail: { url, tabId: '' } }))

  // Close when clicking outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { kind: 'action', label: 'Save',               shortcut: 'Ctrl+S',       run: onSave },
        { kind: 'separator' },
        { kind: 'action', label: 'Close Editor',        shortcut: 'Ctrl+W',       run: onCloseActive },
        { kind: 'action', label: 'Close All Editors',                             run: onCloseAll },
      ],
    },
    {
      label: 'Edit',
      items: [
        { kind: 'action', label: 'Undo',                shortcut: 'Ctrl+Z',       run: () => trigger('undo') },
        { kind: 'action', label: 'Redo',                shortcut: 'Ctrl+Y',       run: () => trigger('redo') },
        { kind: 'separator' },
        { kind: 'action', label: 'Cut',                 shortcut: 'Ctrl+X',       run: () => trigger('editor.action.clipboardCutAction') },
        { kind: 'action', label: 'Copy',                shortcut: 'Ctrl+C',       run: () => trigger('editor.action.clipboardCopyAction') },
        { kind: 'action', label: 'Paste',               shortcut: 'Ctrl+V',       run: () => trigger('editor.action.clipboardPasteAction') },
        { kind: 'separator' },
        { kind: 'action', label: 'Find',                shortcut: 'Ctrl+F',       run: () => trigger('actions.find') },
        { kind: 'action', label: 'Replace',             shortcut: 'Ctrl+H',       run: () => trigger('editor.action.startFindReplaceAction') },
        { kind: 'separator' },
        { kind: 'action', label: 'Toggle Comment',      shortcut: 'Ctrl+/',       run: () => trigger('editor.action.commentLine') },
        { kind: 'action', label: 'Format Document',     shortcut: 'Shift+Alt+F',  run: () => trigger('editor.action.formatDocument') },
      ],
    },
    {
      label: 'Selection',
      items: [
        { kind: 'action', label: 'Select All',          shortcut: 'Ctrl+A',       run: () => trigger('editor.action.selectAll') },
        { kind: 'separator' },
        { kind: 'action', label: 'Copy Line Up',        shortcut: 'Shift+Alt+↑',  run: () => trigger('editor.action.copyLinesUpAction') },
        { kind: 'action', label: 'Copy Line Down',      shortcut: 'Shift+Alt+↓',  run: () => trigger('editor.action.copyLinesDownAction') },
        { kind: 'action', label: 'Move Line Up',        shortcut: 'Alt+↑',        run: () => trigger('editor.action.moveLinesUpAction') },
        { kind: 'action', label: 'Move Line Down',      shortcut: 'Alt+↓',        run: () => trigger('editor.action.moveLinesDownAction') },
        { kind: 'separator' },
        { kind: 'action', label: 'Add Cursor Above',    shortcut: 'Ctrl+Alt+↑',   run: () => trigger('editor.action.insertCursorAbove') },
        { kind: 'action', label: 'Add Cursor Below',    shortcut: 'Ctrl+Alt+↓',   run: () => trigger('editor.action.insertCursorBelow') },
        { kind: 'action', label: 'Expand Selection',    shortcut: 'Shift+Alt+→',  run: () => trigger('editor.action.smartSelect.expand') },
        { kind: 'action', label: 'Shrink Selection',    shortcut: 'Shift+Alt+←',  run: () => trigger('editor.action.smartSelect.shrink') },
      ],
    },
    {
      label: 'View',
      items: [
        { kind: 'action', label: 'Toggle Explorer',                               run: onToggleExplorer },
        { kind: 'action', label: 'Toggle Split Editor',                           run: onToggleSplit },
        { kind: 'separator' },
        { kind: 'action', label: 'Zoom In',             shortcut: 'Ctrl++',       run: onZoomIn },
        { kind: 'action', label: 'Zoom Out',            shortcut: 'Ctrl+-',       run: onZoomOut },
        { kind: 'action', label: 'Reset Zoom',          shortcut: 'Ctrl+0',       run: onResetZoom },
        { kind: 'separator' },
        { kind: 'action', label: 'Minimap',                                       run: () => trigger('editor.action.toggleMinimap') },
        { kind: 'action', label: 'Word Wrap',           shortcut: 'Alt+Z',        run: () => trigger('editor.action.toggleWordWrap') },
      ],
    },
    {
      label: 'Go',
      items: [
        { kind: 'action', label: 'Go to Line…',         shortcut: 'Ctrl+G',       run: () => trigger('editor.action.gotoLine') },
        { kind: 'action', label: 'Go to Symbol…',       shortcut: 'Ctrl+Shift+O', run: () => trigger('editor.action.quickOutline') },
        { kind: 'separator' },
        { kind: 'action', label: 'Go to Definition',    shortcut: 'F12',          run: () => trigger('editor.action.revealDefinition') },
        { kind: 'action', label: 'Go to References',    shortcut: 'Shift+F12',    run: () => trigger('editor.action.goToReferences') },
        { kind: 'separator' },
        { kind: 'action', label: 'Go Back',             shortcut: 'Alt+←',        run: () => trigger('workbench.action.navigateBack') },
        { kind: 'action', label: 'Go Forward',          shortcut: 'Alt+→',        run: () => trigger('workbench.action.navigateForward') },
      ],
    },
    {
      label: 'Run',
      items: [
        { kind: 'action', label: 'Run in Terminal',     shortcut: 'F5',           run: () => {} },
      ],
    },
    {
      label: 'Terminal',
      items: [
        { kind: 'action', label: 'New Terminal',                                  run: () => {} },
        { kind: 'action', label: 'Split Terminal',                                run: () => {} },
        { kind: 'separator' },
        { kind: 'action', label: 'Clear Terminal',                                run: () => {} },
      ],
    },
    {
      label: 'Help',
      items: [
        { kind: 'action', label: 'Documentation',                                 run: () => openUrl('https://github.com/Command-IDE/cmd-ide/wiki') },
        { kind: 'action', label: 'GitHub Repository',                             run: () => openUrl('https://github.com/Command-IDE/cmd-ide') },
        { kind: 'separator' },
        { kind: 'action', label: 'Report Issue',                                  run: () => openUrl('https://github.com/Command-IDE/cmd-ide/issues') },
      ],
    },
  ]

  return (
    <div className="ide-menubar" ref={barRef}>
      {menus.map(menu => (
        <div key={menu.label} className="ide-menubar__menu">
          <button
            className={`ide-menubar__trigger${open === menu.label ? ' ide-menubar__trigger--open' : ''}`}
            onMouseDown={e => { e.preventDefault(); setOpen(o => o === menu.label ? null : menu.label) }}
            onMouseEnter={() => { if (open !== null && open !== menu.label) setOpen(menu.label) }}
          >
            {menu.label}
          </button>

          {open === menu.label && (
            <div className="ide-menubar__dropdown">
              {menu.items.map((item, i) =>
                item.kind === 'separator' ? (
                  <div key={i} className="ide-menubar__sep" />
                ) : (
                  <button
                    key={i}
                    className="ide-menubar__item"
                    onMouseDown={e => { e.preventDefault(); exec(item.run) }}
                  >
                    <span className="ide-menubar__item-label">{item.label}</span>
                    {item.shortcut && (
                      <span className="ide-menubar__item-shortcut">{item.shortcut}</span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
