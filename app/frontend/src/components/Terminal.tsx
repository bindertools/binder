import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { getInstalledIds, isInstalled, getLoadedPlugins } from '../plugins/index'
import { Terminal as XTerm } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import {
  CreateTerminal,
  ExecuteCommand,
  InterruptCommand,
  CloseTerminal,
  GetClipboardText,
  SetClipboardText,
  GetTerminalCwd,
  SetTerminalCwd,
  SelectDirectory,
  GetCompletions,
  CtrlClickPath,
} from '../../wailsjs/go/main/App'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tabId: string
  active: boolean
  xtermTheme: ITheme
  initialCwd?: string
  defaultZoom?: number
  onCwdChange?: (cwd: string) => void
}

// Completion dropdown state (React state for rendering)
interface MenuState {
  matches: string[]
  descriptions?: string[]  // optional right-side labels (slash commands)
  selectedIdx: number
  applied: boolean         // true after first Tab press
  appliedLen: number       // chars currently in terminal for this token
  originalPartial: string  // what user typed before any Tab
  prefix: string           // line up to (not including) the completion token
  top: number              // fixed px position
  left: number
}

// Built-in slash commands always available — no plugin required.
const STATIC_SLASH_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: '/config',          desc: 'open settings & theme UI' },
  { cmd: '/config --raw',    desc: 'edit config.json directly' },
  { cmd: '/config --reload', desc: 'reload config from disk' },
  { cmd: '/config --reset',  desc: 'reset to defaults' },
  { cmd: '/themes',          desc: 'list available theme names' },
  { cmd: '/preview',         desc: 'preview .md/.html or a URL/port' },
  { cmd: '/problems',        desc: 'show project diagnostics' },
  { cmd: '/debug',           desc: 'show OS, shell, config, git info' },
  { cmd: '/kill',            desc: 'kill process on a port' },
  { cmd: '/explorer',        desc: 'open native file explorer' },
  { cmd: '/pack',            desc: 'zip current directory' },
  { cmd: '/pack --dryrun',   desc: 'preview what would be zipped' },
  { cmd: '/ports',           desc: 'open ports monitor tab' },
  { cmd: '/performance',     desc: 'open performance monitor tab' },
  { cmd: '/fullscreen',      desc: 'open fullscreen IDE explorer' },
  { cmd: '/fs',              desc: 'open fullscreen IDE explorer (alias)' },
  ...(__PLUGINS__ ? [{ cmd: '/plugins', desc: 'open plugin store' }] : []),
  { cmd: '/version',         desc: 'show app version info' },
  { cmd: '/help',            desc: 'show all commands' },
]

// Build a command-name → plugin metadata map from currently loaded plugins.
// Called at command-dispatch time so it always reflects the latest install state.
function getPluginCommandMap(): Record<string, { pluginId: string; tabType: string; title: string; displayName: string }> {
  const map: Record<string, { pluginId: string; tabType: string; title: string; displayName: string }> = {}
  for (const plugin of getLoadedPlugins()) {
    for (const cmd of plugin.commands ?? []) {
      map[cmd.name.toLowerCase()] = {
        pluginId:    plugin.id,
        tabType:     plugin.tabType ?? plugin.id,
        title:       plugin.tabTitle ?? plugin.id,
        displayName: plugin.name,
      }
    }
  }
  return map
}

// Build the full slash command list for autocomplete, filtered by installed plugins.
function buildSlashCommands(): { cmd: string; desc: string }[] {
  const installed = new Set(getInstalledIds())
  const pluginEntries: { cmd: string; desc: string }[] = []
  for (const plugin of getLoadedPlugins()) {
    if (!installed.has(plugin.id)) continue
    for (const cmd of plugin.commands ?? []) {
      pluginEntries.push({ cmd: `/${cmd.name}`, desc: cmd.description })
    }
  }
  return [...STATIC_SLASH_COMMANDS, ...pluginEntries]
}


export default function Terminal({ tabId, active, xtermTheme, initialCwd, defaultZoom = 1, onCwdChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])

  const xtermThemeRef = useRef(xtermTheme)
  useEffect(() => { xtermThemeRef.current = xtermTheme }, [xtermTheme])
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme
  }, [xtermTheme])

  const cwdRef = useRef('')        // tracks cwd without causing re-renders; read by plugin-tab dispatch
  const [, setCwd] = useState('')
  const [fontSize, setFontSize] = useState(() => Math.round(13 * defaultZoom))
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<MenuState | null>(null)
  useEffect(() => { menuRef.current = menu }, [menu])

  // Refs so JSX handlers can call functions defined inside the main useEffect
  const applyMatchRef = useRef<((match: string) => void) | null>(null)

  // Command history (persists for the lifetime of this terminal tab)
  const historyRef    = useRef<string[]>([])
  const historyIdxRef = useRef(-1)   // -1 = not navigating history
  const savedInputRef = useRef('')   // current input saved when entering history

  useEffect(() => {
    GetTerminalCwd(tabId).then(p => { if (p) { cwdRef.current = p; setCwd(p); onCwdChange?.(p) } }).catch(() => {})
  }, [tabId])

  useEffect(() => {
    const event = `terminal:cwd:${tabId}`
    EventsOn(event, (path: string) => { cwdRef.current = path; setCwd(path); onCwdChange?.(path) })
    return () => EventsOff(event)
  }, [tabId])

  useEffect(() => {
    const handler = (e: Event) => {
      const { terminalId } = (e as CustomEvent).detail
      if (terminalId !== tabId) return
      SelectDirectory().then(path => { if (path) SetTerminalCwd(tabId, path) }).catch(() => {})
    }
    window.addEventListener('terminal:select-dir', handler)
    return () => window.removeEventListener('terminal:select-dir', handler)
  }, [tabId])

  // When defaultZoom changes (config reload), update xterm font size and refit.
  useEffect(() => {
    const newSize = Math.round(13 * defaultZoom)
    setFontSize(newSize)
    if (termRef.current) {
      termRef.current.options.fontSize = newSize
      const id = setTimeout(() => fitRef.current?.fit(), 50)
      return () => clearTimeout(id)
    }
  }, [defaultZoom])

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current

    const term = new XTerm({
      theme: xtermThemeRef.current,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
      fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 5000,
      convertEol: false,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    // Custom handler: open URLs in an in-app preview tab instead of the system browser
    term.loadAddon(new WebLinksAddon((e, url) => {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('ide:open-url', { detail: { url, tabId } }))
    }))
    term.open(container)
    fitAddon.fit()
    termRef.current = term
    fitRef.current = fitAddon

    // Ctrl+C: copy on first press with selection, kill on second press (or no selection).
    // Must use attachCustomKeyEventHandler — it's the only xterm API that runs before
    // xterm clears the selection and before onData fires.
    let ctrlCCopies = 0
    let ctrlCTimer: ReturnType<typeof setTimeout> | null = null
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.key !== 'c') return true
      const selection = term.getSelection()
      if (selection) {
        ctrlCCopies++
        if (ctrlCTimer) clearTimeout(ctrlCTimer)
        if (ctrlCCopies === 1) {
          // First press with selection: copy, keep selection, block kill
          SetClipboardText(selection).catch(() => {})
          ctrlCTimer = setTimeout(() => { ctrlCCopies = 0 }, 1000)
          return false // block xterm from sending ^C
        }
        // Second press with selection: kill
        ctrlCCopies = 0
        term.clearSelection()
        return true // let xterm send ^C normally
      }
      // No selection: always kill
      ctrlCCopies = 0
      return true
    })

    // ── Ctrl+Click: open files / cd into directories ─────────────────────────
    // Direct mouse-event approach — more reliable than registerLinkProvider in
    // the WebView2 host.  When Ctrl is held:
    //   • cursor turns into a pointer over the terminal canvas
    //   • clicking resolves the word under the cursor as a path relative to cwd
    //   • directories  → cd (SetCwd + new prompt)
    //   • files        → open in editor tab

    const isPathChar = (c: string) => /[a-zA-Z0-9_./\\-]/.test(c)

    // Set the cursor on the xterm canvas/row elements so the user sees a pointer
    // while Ctrl is held, indicating that clicking is available.
    const setCtrlCursor = (pointer: boolean) => {
      container.querySelectorAll<HTMLElement>('canvas, .xterm-rows').forEach(el => {
        el.style.cursor = pointer ? 'pointer' : ''
      })
    }

    const handleCtrlMouseMove = (e: MouseEvent) => setCtrlCursor(e.ctrlKey)
    const handleCtrlKeyDown   = (e: KeyboardEvent) => { if (e.key === 'Control') setCtrlCursor(true)  }
    const handleCtrlKeyUp     = (e: KeyboardEvent) => { if (e.key === 'Control') setCtrlCursor(false) }

    const handleCtrlClick = (e: MouseEvent) => {
      if (!e.ctrlKey) return

      // Use the xterm screen element as the coordinate reference
      const screen = container.querySelector('.xterm-screen') as HTMLElement | null
      if (!screen) return

      // Cell dimensions via xterm's internal render service
      const core  = (term as any)._core
      const cellW = core?._renderService?.dimensions?.css?.cell?.width  as number | undefined
      const cellH = core?._renderService?.dimensions?.css?.cell?.height as number | undefined
      if (!cellW || !cellH) return

      // Convert click pixel position → terminal column + viewport row
      const rect = screen.getBoundingClientRect()
      const col  = Math.floor((e.clientX - rect.left) / cellW)
      const row  = Math.floor((e.clientY - rect.top)  / cellH)
      if (col < 0 || row < 0) return

      // viewportY is the first buffer line visible in the viewport (scrollback offset)
      const bufferRow = term.buffer.active.viewportY + row
      const bufLine   = term.buffer.active.getLine(bufferRow)
      if (!bufLine) return

      const lineText = bufLine.translateToString(true)
      if (!lineText.trim()) return

      // Expand left and right from the clicked column to extract the full token
      const clampedCol = Math.max(0, Math.min(col, lineText.length - 1))
      if (!isPathChar(lineText[clampedCol])) return

      let start = clampedCol
      while (start > 0 && isPathChar(lineText[start - 1])) start--
      let end = clampedCol + 1
      while (end < lineText.length && isPathChar(lineText[end])) end++

      const token = lineText.slice(start, end).replace(/[/\\]$/, '') // strip trailing slash
      if (!token) return

      // URL detection — expand with URL-safe chars (isPathChar excludes ':' so http:// splits)
      const isUrlChar = (c: string) => /[a-zA-Z0-9_./:?#&=@%~!-]/.test(c)
      let us = clampedCol, ue = clampedCol + 1
      while (us > 0 && isUrlChar(lineText[us - 1])) us--
      while (ue < lineText.length && isUrlChar(lineText[ue])) ue++
      const urlCandidate = lineText.slice(us, ue)
      const isUrl = /^https?:\/\//i.test(urlCandidate)
        || /^(localhost|[\d]{1,3}(\.[\d]{1,3}){3}|[\w.-]+\.\w{2,}):\d+/.test(urlCandidate)

      if (isUrl) {
        const url = /^https?:\/\//i.test(urlCandidate) ? urlCandidate : 'http://' + urlCandidate
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('ide:open-url', { detail: { url, tabId } }))
        return
      }

      CtrlClickPath(tabId, token).catch(() => {})
    }

    container.addEventListener('mousemove', handleCtrlMouseMove)
    container.addEventListener('mousedown', handleCtrlClick)
    window.addEventListener('keydown', handleCtrlKeyDown)
    window.addEventListener('keyup',   handleCtrlKeyUp)

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const current = termRef.current?.options.fontSize ?? 13
      const next = e.deltaY < 0 ? Math.min(current + 1, 36) : Math.max(current - 1, 8)
      if (termRef.current) termRef.current.options.fontSize = next
      fitRef.current?.fit()
      setFontSize(next)
    }
    container.addEventListener('wheel', handleWheel, { passive: false })

    CreateTerminal(tabId, initialCwd ?? '').catch(() => {})

    const outEvent = `terminal:output:${tabId}`
    EventsOn(outEvent, (data: string) => { term.write(data) })

    const lineRef = { current: '' }

    // ── helpers ───────────────────────────────────────────────────────────────

    const processPaste = (text: string) => {
      setMenu(null)
      const segments = text.split(/\r?\n/)
      segments.forEach((seg, i) => {
        if (seg) { lineRef.current += seg; term.write(seg) }
        if (i < segments.length - 1) {
          const cmd = lineRef.current
          lineRef.current = ''
          term.write('\r\n')
          ExecuteCommand(tabId, cmd)
        }
      })
    }

    const eraseChars = (count: number) => {
      if (count <= 0) return
      term.write(`\x1b[${count}D\x1b[K`)
      lineRef.current = lineRef.current.slice(0, -count)
    }

    // Returns the dir/partial/prefix for the token the cursor is on, or null if
    // we're still typing the command name (no space yet).
    const parseToken = () => {
      const line = lineRef.current
      const lastSpace = line.lastIndexOf(' ')
      if (lastSpace < 0) return null
      const token = line.slice(lastSpace + 1)
      const lastSlash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'))
      const dir = lastSlash >= 0 ? token.slice(0, lastSlash + 1) : ''
      const partial = lastSlash >= 0 ? token.slice(lastSlash + 1) : token
      const prefix = line.slice(0, line.length - partial.length)
      return { dir, partial, prefix }
    }

    // Get xterm cell dimensions (internal API, with fallback).
    const cellDims = () => {
      const core = (term as any)._core
      const h = core?._renderService?.dimensions?.css?.cell?.height ?? (fontSize * 1.2)
      const w = core?._renderService?.dimensions?.css?.cell?.width ?? (fontSize * 0.62)
      return { h, w }
    }

    // ── completion menu ───────────────────────────────────────────────────────

    // Slash-command autocomplete: shown when the line starts with '/' and
    // contains no space yet (user is still typing the command name).
    // Returns true when it handled the update (even if it cleared the menu).
    const updateSlashMenu = (): boolean => {
      const line = lineRef.current
      if (!line.startsWith('/') || line.includes(' ')) return false

      const filtered = buildSlashCommands().filter(c => c.cmd.startsWith(line))
      if (filtered.length === 0) { setMenu(null); return true }

      const { h, w } = cellDims()
      const rect = container.getBoundingClientRect()
      const cursorRow = term.buffer.active.cursorY
      const cursorCol = term.buffer.active.cursorX

      // Align left with the '/' character, not the container edge
      const slashCol = Math.max(0, cursorCol - line.length)
      const left = rect.left + 8 + slashCol * w

      // Place below the cursor; flip above if it would overflow the viewport
      const ITEM_H = 26
      const menuH = Math.min(filtered.length * ITEM_H + 8, 220)
      const below = rect.top + 6 + (cursorRow + 1) * h
      const above = rect.top + 6 + cursorRow * h - menuH
      const top = below + menuH > window.innerHeight - 8 ? above : below

      setMenu({
        matches:      filtered.map(c => c.cmd),
        descriptions: filtered.map(c => c.desc),
        selectedIdx: 0,
        applied: false,
        appliedLen: line.length,
        originalPartial: line,
        prefix: '',
        top,
        left,
      })
      return true
    }

    const updateMenu = () => {
      if (updateSlashMenu()) return

      const parsed = parseToken()
      if (!parsed) { setMenu(null); return }
      const { dir, partial, prefix } = parsed

      GetCompletions(tabId, dir, partial)
        .then((matches: string[]) => {
          if (!matches || matches.length === 0) { setMenu(null); return }

          const { h, w } = cellDims()
          const rect = container.getBoundingClientRect()
          const cursorRow = term.buffer.active.cursorY
          const cursorCol = term.buffer.active.cursorX
          const partialStartCol = cursorCol - partial.length

          // Place below the cursor; flip above if it would overflow the viewport
          const ITEM_H = 26
          const menuH = Math.min(matches.length * ITEM_H + 8, 220)
          const below = rect.top + 6 + (cursorRow + 1) * h
          const above = rect.top + 6 + cursorRow * h - menuH
          const top = below + menuH > window.innerHeight - 8 ? above : below
          const left = Math.max(rect.left + 8, rect.left + 8 + partialStartCol * w)

          setMenu({
            matches,
            selectedIdx: 0,
            applied: false,
            appliedLen: partial.length,
            originalPartial: partial,
            prefix,
            top,
            left,
          })
        })
        .catch(() => setMenu(null))
    }

    // Apply a specific match from the menu (used by click handler).
    applyMatchRef.current = (match: string) => {
      const m = menuRef.current
      if (!m) return
      eraseChars(m.appliedLen)
      term.write(match)
      lineRef.current = m.prefix + match
      setMenu(null)
      term.focus()
    }

    // Tab: apply selected match, then advance selection for next Tab.
    const handleTab = () => {
      const m = menuRef.current
      if (!m || m.matches.length === 0) return

      if (!m.applied) {
        // First Tab: apply the first (selected) match
        const match = m.matches[0]
        eraseChars(m.appliedLen)
        term.write(match)
        lineRef.current = m.prefix + match
        setMenu({ ...m, applied: true, appliedLen: match.length, selectedIdx: 0 })
      } else {
        // Subsequent Tab: cycle to next match
        const nextIdx = (m.selectedIdx + 1) % m.matches.length
        const match = m.matches[nextIdx]
        eraseChars(m.appliedLen)
        term.write(match)
        lineRef.current = m.prefix + match
        setMenu({ ...m, appliedLen: match.length, selectedIdx: nextIdx })
      }
    }

    // ── keyboard ──────────────────────────────────────────────────────────────

    // Replace whatever is currently typed on the line with `text`.
    const replaceInput = (text: string) => {
      const cur = lineRef.current
      if (cur.length > 0) term.write('\b \b'.repeat(cur.length))
      term.write(text)
      lineRef.current = text
    }

    const onContainerKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        handleTab()
        return
      }
      if (e.key === 'Escape') {
        const m = menuRef.current
        if (m) {
          e.preventDefault()
          if (m.applied) {
            eraseChars(m.appliedLen)
            term.write(m.originalPartial)
            lineRef.current = m.prefix + m.originalPartial
          }
          setMenu(null)
        }
        return
      }

      // ── Up/Down arrows: command history navigation ───────────────────────
      // Runs in capture phase so stopImmediatePropagation prevents xterm from
      // generating the \x1b[A / \x1b[B escape sequences entirely.
      if (e.key === 'ArrowUp' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const hist = historyRef.current
        if (hist.length === 0) return
        if (historyIdxRef.current === -1) {
          savedInputRef.current = lineRef.current
          historyIdxRef.current = hist.length - 1
        } else if (historyIdxRef.current > 0) {
          historyIdxRef.current--
        } else {
          return // already at oldest entry
        }
        setMenu(null)
        replaceInput(hist[historyIdxRef.current])
        return
      }

      if (e.key === 'ArrowDown' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (historyIdxRef.current === -1) return
        const hist = historyRef.current
        if (historyIdxRef.current === hist.length - 1) {
          historyIdxRef.current = -1
          setMenu(null)
          replaceInput(savedInputRef.current)
        } else {
          historyIdxRef.current++
          setMenu(null)
          replaceInput(hist[historyIdxRef.current])
        }
        return
      }
    }
    container.addEventListener('keydown', onContainerKeyDown, { capture: true })

    // ── paste ─────────────────────────────────────────────────────────────────

    const onWindowPaste = (e: ClipboardEvent) => {
      if (!activeRef.current) return
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text) processPaste(text)
    }
    window.addEventListener('paste', onWindowPaste)

    // ── input ─────────────────────────────────────────────────────────────────

    const undoStack: string[] = []

    term.onData((data: string) => {
      // Enter
      if (data === '\r' || data === '\n') {
        setMenu(null)
        undoStack.length = 0
        const line = lineRef.current
        lineRef.current = ''
        // Push non-empty commands to history, avoid consecutive duplicates
        if (line.trim()) {
          const hist = historyRef.current
          if (hist.length === 0 || hist[hist.length - 1] !== line) {
            hist.push(line)
            if (hist.length > 500) hist.shift()
          }
        }
        historyIdxRef.current = -1
        savedInputRef.current = ''
        term.write('\r\n')

        // Intercept plugin slash commands on the frontend so install state
        // is enforced before anything reaches Go.
        if (line.startsWith('/')) {
          const cmdName = line.slice(1).split(/\s+/)[0].toLowerCase()
          const pluginCmd = getPluginCommandMap()[cmdName]
          if (pluginCmd) {
            if (isInstalled(pluginCmd.pluginId)) {
              window.dispatchEvent(new CustomEvent('terminal:open-plugin-tab', {
                detail: { type: pluginCmd.tabType, title: pluginCmd.title, terminalId: tabId, cwd: cwdRef.current },
              }))
            } else {
              term.write(
                `\x1b[38;5;203m"/${cmdName}" requires the ${pluginCmd.displayName} plugin.\x1b[0m\r\n` +
                `\x1b[38;5;246mRun /plugins to open the Plugin Store and install it.\x1b[0m`
              )
            }
            // Ask Go to re-draw the prompt so the terminal stays usable.
            ExecuteCommand(tabId, '')
            return
          }
        }

        ExecuteCommand(tabId, line)
        return
      }

      // Backspace
      if (data === '\x7f' || data === '\b') {
        if (lineRef.current.length > 0) {
          undoStack.push(lineRef.current)
          lineRef.current = lineRef.current.slice(0, -1)
          term.write('\b \b')
          updateMenu()
        } else {
          setMenu(null)
        }
        return
      }

      // Ctrl+C — kill (copy-with-selection is handled in the keydown capture listener)
      if (data === '\x03') {
        setMenu(null)
        undoStack.length = 0
        historyIdxRef.current = -1
        savedInputRef.current = ''
        term.write('^C\r\n')
        lineRef.current = ''
        InterruptCommand(tabId)
        return
      }

      // Ctrl+A — select current input line (visually move to start)
      if (data === '\x01') {
        if (lineRef.current.length > 0) {
          // Move cursor back to beginning of line
          term.write('\x1b[' + lineRef.current.length + 'D')
          // Select all by re-writing (can't easily use xterm selection API here)
          // Re-draw so cursor is at start, content is still there
          term.write(lineRef.current)
          term.write('\x1b[' + lineRef.current.length + 'D')
        }
        return
      }

      // Ctrl+Z — undo last typed characters
      if (data === '\x1a') {
        if (undoStack.length > 0) {
          const prev = undoStack.pop()!
          const cur = lineRef.current
          // Erase current, write previous
          if (cur.length > 0) {
            term.write('\b \b'.repeat(cur.length))
          }
          term.write(prev)
          lineRef.current = prev
          updateMenu()
        }
        return
      }

      // Ctrl+L
      if (data === '\x0c') {
        setMenu(null)
        term.write('\x1b[2J\x1b[H')
        lineRef.current = ''
        ExecuteCommand(tabId, 'clear')
        return
      }

      // Ctrl+U
      if (data === '\x15') {
        setMenu(null)
        if (lineRef.current.length > 0) {
          undoStack.push(lineRef.current)
          term.write('\x1b[' + lineRef.current.length + 'D' +
            ' '.repeat(lineRef.current.length) +
            '\x1b[' + lineRef.current.length + 'D')
          lineRef.current = ''
        }
        return
      }

      // Tab — handled by container keydown listener
      if (data === '\x09') return

      // Ctrl+V
      if (data === '\x16') {
        GetClipboardText().then(text => { if (text) processPaste(text) }).catch(() => {})
        return
      }

      // Other control characters
      if (data.charCodeAt(0) < 32) return

      // Printable: write, update menu in real time
      if (data.length > 1) {
        processPaste(data)
      } else {
        undoStack.push(lineRef.current)
        if (undoStack.length > 100) undoStack.shift()
        lineRef.current += data
        term.write(data)
        updateMenu()
      }
    })

    // Allow plugins to execute commands in this terminal
    const handlePluginExec = (e: Event) => {
      const { terminalId, cmd } = (e as CustomEvent).detail
      if (terminalId === tabId) ExecuteCommand(tabId, cmd)
    }
    window.addEventListener('plugin:execute', handlePluginExec)

    const ro = new ResizeObserver(() => fitAddon.fit())
    ro.observe(containerRef.current!)

    return () => {
      ro.disconnect()
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('keydown', onContainerKeyDown, { capture: true })
      container.removeEventListener('mousemove', handleCtrlMouseMove)
      container.removeEventListener('mousedown', handleCtrlClick)
      window.removeEventListener('keydown', handleCtrlKeyDown)
      window.removeEventListener('keyup',   handleCtrlKeyUp)
      window.removeEventListener('paste', onWindowPaste)
      window.removeEventListener('plugin:execute', handlePluginExec)
      EventsOff(outEvent)
      CloseTerminal(tabId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      applyMatchRef.current = null
    }
  }, [tabId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active) {
      fitRef.current?.fit()
      termRef.current?.focus()
    }
  }, [active])

  return (
    <div className="terminal-pane">
      <div ref={containerRef} className="terminal-container" />

      {menu && ReactDOM.createPortal(
        <div
          className="completion-menu"
          style={{ top: menu.top, left: menu.left }}
        >
          {menu.matches.map((m, i) => (
            <div
              key={m + i}
              className={`completion-item${i === menu.selectedIdx && menu.applied ? ' applied' : ''}${i === menu.selectedIdx ? ' selected' : ''}`}
              onMouseDown={e => {
                e.preventDefault() // keep terminal focus
                applyMatchRef.current?.(m)
              }}
            >
              <span className="completion-item__name">{m}</span>
              {menu.descriptions?.[i] && (
                <span className="completion-item__desc">{menu.descriptions[i]}</span>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
