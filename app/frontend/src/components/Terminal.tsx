import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import type { InstalledPluginCommand } from '../plugins'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import {
  CreateTerminal,
  SetTerminalAlignment,
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
  TerminalInput,
  ResizeTerminal,
} from '../../wailsjs/go/main/App'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tabId: string
  active: boolean
  xtermTheme: ITheme
  initialCwd?: string
  defaultZoom?: number
  commandAlignment?: 'default' | 'top' | 'bottom'
  pluginCommands?: Record<string, InstalledPluginCommand>
  quickPaths?: string[]
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
  { cmd: '/uptime',          desc: 'show host-device system uptime' },
  { cmd: '/lang-map',        desc: 'language breakdown for current directory' },
  { cmd: '/lang-map <dir>',  desc: 'language breakdown for a directory' },
  { cmd: '/version',         desc: 'show app version info' },
  { cmd: '/help',            desc: 'show all commands' },
]

// Build the full slash command list for autocomplete from installed plugins.
function buildSlashCommands(pluginCommands: Record<string, InstalledPluginCommand>): { cmd: string; desc: string }[] {
  const pluginEntries = Object.values(pluginCommands)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(command => ({
      cmd: `/${command.name}`,
      desc: command.description,
    }))


  return [...STATIC_SLASH_COMMANDS, ...pluginEntries]
}


export default function Terminal({
  tabId,
  active,
  xtermTheme,
  initialCwd,
  defaultZoom = 1,
  commandAlignment = 'default',
  pluginCommands = {},
  quickPaths,
  onCwdChange,
}: Props) {
  const containerRef           = useRef<HTMLDivElement>(null)
  const termRef                = useRef<XTerm | null>(null)
  const fitRef                 = useRef<FitAddon | null>(null)
  const activeRef              = useRef(active)
  const hasShownQuickPathsRef  = useRef(false)
  useEffect(() => { activeRef.current = active }, [active])
  const ptyModeRef = useRef(false)

  const xtermThemeRef = useRef(xtermTheme)
  useEffect(() => { xtermThemeRef.current = xtermTheme }, [xtermTheme])
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme
  }, [xtermTheme])

  // ── command-bar mode ───────────────────────────────────────────────────────
  // lineRef is shared between xterm input (default) and the input bar (top/bottom).
  // It must live outside the main useEffect so component-level handlers can read it.
  const lineRef             = useRef('')
  const commandAlignmentRef = useRef(commandAlignment)
  const inputBarRef         = useRef<HTMLInputElement>(null)
  const handleTabRef        = useRef<() => void>(() => {})
  const submitRef           = useRef<(val: string) => void>(() => {})
  const updateMenuRef       = useRef<() => void>(() => {})

  useEffect(() => { commandAlignmentRef.current = commandAlignment }, [commandAlignment])

  const [inputBarValue, setInputBarValue] = useState('')
  const [isPtyActive,   setIsPtyActive]   = useState(false)

  // Focus management: when a PTY process starts/ends, transfer focus to/from the input bar.
  useEffect(() => {
    if (commandAlignment === 'default') return
    const startEv = `terminal:pty:start:${tabId}`
    const endEv   = `terminal:pty:end:${tabId}`
    EventsOn(startEv, () => { setIsPtyActive(true);  termRef.current?.focus() })
    EventsOn(endEv,   () => { setIsPtyActive(false); setTimeout(() => inputBarRef.current?.focus(), 50) })
    return () => { EventsOff(startEv); EventsOff(endEv) }
  }, [tabId, commandAlignment])

  // Keep Go terminal in sync when the user changes alignment via Settings.
  useEffect(() => {
    SetTerminalAlignment(tabId, commandAlignment).catch(() => {})
  }, [tabId, commandAlignment])

  // Structured prompt data pushed from Go when alignment is top/bottom.
  const [barPrompt, setBarPrompt] = useState({ path: '', branch: '', ts: '' })
  // Ref so the submitRef closure always sees the latest bar prompt without going stale.
  const barPromptRef = useRef({ path: '', branch: '', ts: '' })
  useEffect(() => { barPromptRef.current = barPrompt }, [barPrompt])

  useEffect(() => {
    if (commandAlignment === 'default') return
    const ev = `terminal:bar-prompt:${tabId}`
    EventsOn(ev, (data: { path: string; branch: string; ts: string }) => {
      setBarPrompt(data)
      barPromptRef.current = data
    })
    return () => EventsOff(ev)
  }, [tabId, commandAlignment])

  const cwdRef = useRef('')        // tracks current cwd so plugin-tab dispatch can read it
  const [cwd, setCwd] = useState('')
  const [fontSize, setFontSize] = useState(() => Math.round(13 * defaultZoom))
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<MenuState | null>(null)
  useEffect(() => { menuRef.current = menu }, [menu])
  const pluginCommandsRef = useRef(pluginCommands)
  useEffect(() => { pluginCommandsRef.current = pluginCommands }, [pluginCommands])

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
      SelectDirectory().then(path => { if (path) SetTerminalCwd(tabId, path).catch(() => {}) }).catch(() => {})
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

    // GPU-accelerated rendering: WebGL primary, Canvas fallback, DOM last resort.
    // Must be loaded after open() so the canvas element exists.
    const tryCanvas = () => {
      try { term.loadAddon(new CanvasAddon()) } catch { /* stay on DOM renderer */ }
    }
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        try { webgl.dispose() } catch { /* already disposed */ }
        tryCanvas()
      })
      term.loadAddon(webgl)
    } catch {
      tryCanvas()
    }

    if (container.offsetWidth > 0 && container.offsetHeight > 0) fitAddon.fit()
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

    const isPathChar = (c: string) => /[a-zA-Z0-9_./\\-]/.test(c) || c === ':'

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

      e.preventDefault()
      CtrlClickPath(tabId, token).then((result: unknown) => {
        const r = result as { resolved: string; isDir: boolean; exists: boolean }
        if (r.exists && r.isDir) {
          const escaped = r.resolved.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          ExecuteCommand(tabId, 'cd "' + escaped + '"').catch(() => {})
        } else if (r.exists && !r.isDir) {
          window.dispatchEvent(new CustomEvent('ide:ctrl-click-file', { detail: { path: r.resolved } }))
        }
      }).catch(() => {})
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

    CreateTerminal(tabId, initialCwd ?? '', commandAlignmentRef.current).catch(() => {})

    if (quickPaths && quickPaths.length > 0 && !hasShownQuickPathsRef.current) {
      hasShownQuickPathsRef.current = true
      term.write('\r\n\x1b[2m  Recent paths:\x1b[0m\r\n')
      quickPaths.forEach(p => {
        const display = p.replace(/\\/g, '/')
        term.write(`  \x1b[36;4m${display}\x1b[0m\r\n`)
      })
      term.write('\r\n')
    }

    const outEvent = `terminal:output:${tabId}`
    // Use termRef.current (not the closure `term`) so that if the component
    // remounts and creates a new xterm instance, the handler always writes to
    // the currently-active terminal, not a stale/disposed one.
    EventsOn(outEvent, (data: string) => { termRef.current?.write(data) })

    // PTY mode: switch to raw pass-through when an interactive process is running
    const ptyStartEvent = `terminal:pty:start:${tabId}`
    const ptyEndEvent   = `terminal:pty:end:${tabId}`
    EventsOn(ptyStartEvent, () => { ptyModeRef.current = true  })
    EventsOn(ptyEndEvent,   () => { ptyModeRef.current = false })

    // Forward xterm resize events to the backend PTY.
    // Guard against 0×0 — ConPTY panics on zero-dimension resize (can happen
    // during panel split layout transitions before the container gets its final size).
    term.onResize(({ cols, rows }) => {
      if (cols > 0 && rows > 0) ResizeTerminal(tabId, cols, rows).catch(() => {})
    })

    // lineRef is declared at component scope (useRef) — accessible here and in handlers.

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
          void ExecuteCommand(tabId, cmd)
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
    // Compute menu top/left for bar mode (relative to the input bar DOM element).
    const barMenuPos = (menuH: number): { top: number; left: number } => {
      const br = inputBarRef.current!.getBoundingClientRect()
      const top = commandAlignmentRef.current === 'bottom'
        ? br.top - menuH - 4
        : br.bottom + 4
      return { top, left: br.left + 52 }  // 52 ≈ width of the CWD + ❯ prompt area
    }

    const updateSlashMenu = (): boolean => {
      const line = lineRef.current
      if (!line.startsWith('/') || line.includes(' ')) return false

      const filtered = buildSlashCommands(pluginCommandsRef.current).filter(c => c.cmd.startsWith(line))
      if (filtered.length === 0) { setMenu(null); return true }

      const ITEM_H = 26
      const menuH = Math.min(filtered.length * ITEM_H + 8, 220)

      let top: number, left: number
      if (commandAlignmentRef.current !== 'default' && inputBarRef.current) {
        ;({ top, left } = barMenuPos(menuH))
      } else {
        const { h, w } = cellDims()
        const rect = container.getBoundingClientRect()
        const cursorRow = term.buffer.active.cursorY
        const cursorCol = term.buffer.active.cursorX
        const slashCol = Math.max(0, cursorCol - line.length)
        left = rect.left + 8 + slashCol * w
        const below = rect.top + 6 + (cursorRow + 1) * h
        const above = rect.top + 6 + cursorRow * h - menuH
        top = below + menuH > window.innerHeight - 8 ? above : below
      }

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

          // For 'cd', only offer directories (C++ marks them with a trailing '/').
          const cmdWord = prefix.trimStart().split(/\s+/)[0]
          const filtered = cmdWord === 'cd'
            ? matches.filter(m => m.endsWith('/'))
            : matches
          if (filtered.length === 0) { setMenu(null); return }

          const ITEM_H = 26
          const menuH = Math.min(filtered.length * ITEM_H + 8, 220)

          let top: number, left: number
          if (commandAlignmentRef.current !== 'default' && inputBarRef.current) {
            ;({ top, left } = barMenuPos(menuH))
          } else {
            const { h, w } = cellDims()
            const rect = container.getBoundingClientRect()
            const cursorRow = term.buffer.active.cursorY
            const cursorCol = term.buffer.active.cursorX
            const partialStartCol = cursorCol - partial.length
            const below = rect.top + 6 + (cursorRow + 1) * h
            const above = rect.top + 6 + cursorRow * h - menuH
            top = below + menuH > window.innerHeight - 8 ? above : below
            left = Math.max(rect.left + 8, rect.left + 8 + partialStartCol * w)
          }

          setMenu({
            matches: filtered,
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
    updateMenuRef.current = updateMenu

    // Input-bar submit: echo the command to xterm then execute it.
    // Slash-command plugin interception is replicated here so /plugins etc. still work.
    submitRef.current = (value: string) => {
      if (!value.trim()) { term.write('\r\n'); return }
      const hist = historyRef.current
      if (hist.length === 0 || hist[hist.length - 1] !== value) {
        hist.push(value)
        if (hist.length > 500) hist.shift()
      }
      historyIdxRef.current = -1
      savedInputRef.current = ''
      lineRef.current = ''
      if (value.startsWith('/')) {
        const cmdName = value.slice(1).split(/\s+/)[0].toLowerCase()
        const pluginCmd = pluginCommandsRef.current[cmdName]
        if (pluginCmd) {
          if (pluginCmd.handler) { pluginCmd.handler() }
          else if (pluginCmd.tabType) {
            window.dispatchEvent(new CustomEvent('terminal:open-plugin-tab', {
              detail: { type: pluginCmd.tabType, title: pluginCmd.title, terminalId: tabId, cwd: cwdRef.current },
            }))
          }
          void ExecuteCommand(tabId, '')
          return
        }
      }
      // In bar mode, echo the command with a styled prompt prefix so it looks
      // identical to the default-mode "prompt + command" line.
      // Bar already shows path/time/branch — just echo the command itself.
      if (commandAlignmentRef.current !== 'default') {
        term.write(`\x1b[38;5;246m❯\x1b[0m ${value}\r\n`)
      } else {
        term.write(value + '\r\n')
      }
      void ExecuteCommand(tabId, value)
    }

    // Apply a specific match from the menu (used by click handler).
    applyMatchRef.current = (match: string) => {
      const m = menuRef.current
      if (!m) return
      if (commandAlignmentRef.current !== 'default') {
        // Input-bar mode: update the bar's value, keep focus on bar
        const newVal = m.prefix + match
        setInputBarValue(newVal)
        lineRef.current = newVal
        setMenu(null)
        inputBarRef.current?.focus()
      } else {
        eraseChars(m.appliedLen)
        term.write(match)
        lineRef.current = m.prefix + match
        setMenu(null)
        term.focus()
      }
    }

    // Tab: apply selected match, then advance selection for next Tab.
    const handleTab = () => {
      const m = menuRef.current
      if (!m || m.matches.length === 0) return
      const isBar = commandAlignmentRef.current !== 'default'

      if (!m.applied) {
        const match = m.matches[0]
        if (isBar) {
          const newVal = m.prefix + match
          setInputBarValue(newVal)
          lineRef.current = newVal
        } else {
          eraseChars(m.appliedLen)
          term.write(match)
          lineRef.current = m.prefix + match
        }
        setMenu({ ...m, applied: true, appliedLen: match.length, selectedIdx: 0 })
      } else {
        const nextIdx = (m.selectedIdx + 1) % m.matches.length
        const match = m.matches[nextIdx]
        if (isBar) {
          const newVal = m.prefix + match
          setInputBarValue(newVal)
          lineRef.current = newVal
        } else {
          eraseChars(m.appliedLen)
          term.write(match)
          lineRef.current = m.prefix + match
        }
        setMenu({ ...m, appliedLen: match.length, selectedIdx: nextIdx })
      }
    }
    handleTabRef.current = handleTab

    // ── keyboard ──────────────────────────────────────────────────────────────

    // Replace whatever is currently typed on the line with `text`.
    const replaceInput = (text: string) => {
      const cur = lineRef.current
      if (cur.length > 0) term.write('\b \b'.repeat(cur.length))
      term.write(text)
      lineRef.current = text
    }

    const onContainerKeyDown = (e: KeyboardEvent) => {
      if (ptyModeRef.current) return

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
      // In bar mode the browser handles paste natively in the <input> element
      if (document.activeElement === inputBarRef.current) return
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!text) return
      if (ptyModeRef.current) {
        TerminalInput(tabId, text).catch(() => {})
      } else {
        processPaste(text)
      }
    }
    window.addEventListener('paste', onWindowPaste)

    // ── input ─────────────────────────────────────────────────────────────────

    const undoStack: string[] = []

    term.onData((data: string) => {
      // In bar mode xterm is display-only; the input bar handles all typing.
      if (commandAlignmentRef.current !== 'default' && !ptyModeRef.current) return

      // PTY mode: raw pass-through — the process drives the display
      if (ptyModeRef.current) {
        TerminalInput(tabId, data).catch(() => {})
        return
      }

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

        // Intercept installed plugin slash commands on the frontend so
        // metadata-driven tabs and command handlers work before reaching Go.
        if (line.startsWith('/')) {
          const cmdName = line.slice(1).split(/\s+/)[0].toLowerCase()
          const pluginCmd = pluginCommandsRef.current[cmdName]
          if (pluginCmd) {
            if (pluginCmd.handler) {
              pluginCmd.handler()
            } else if (pluginCmd.tabType) {
              window.dispatchEvent(new CustomEvent('terminal:open-plugin-tab', {
                detail: { type: pluginCmd.tabType, title: pluginCmd.title, terminalId: tabId, cwd: cwdRef.current },
              }))
            }
            // Ask Go to re-draw the prompt so the terminal stays usable.
            void ExecuteCommand(tabId, '')
            return
          }
        }

        void ExecuteCommand(tabId, line)
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
        void InterruptCommand(tabId)
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
        void ExecuteCommand(tabId, 'clear')
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
        GetClipboardText().then(text => {
          if (!text) return
          if (ptyModeRef.current) {
            TerminalInput(tabId, text).catch(() => {})
          } else {
            processPaste(text)
          }
        }).catch(() => {})
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
      if (terminalId === tabId) void ExecuteCommand(tabId, cmd)
    }
    window.addEventListener('plugin:execute', handlePluginExec)

    // Guard: skip fit() when the container has no size (e.g. during panel split
    // layout transitions) to prevent xterm from resizing to 0 cols/rows.
    const ro = new ResizeObserver(() => {
      const el = containerRef.current
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) fitAddon.fit()
    })
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
      EventsOff(ptyStartEvent)
      EventsOff(ptyEndEvent)
      ptyModeRef.current = false
      void CloseTerminal(tabId)
      try { term.dispose() } catch { /* GPU context may already be gone */ }
      termRef.current = null
      fitRef.current = null
      applyMatchRef.current = null
    }
  }, [tabId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active) {
      const el = containerRef.current
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) fitRef.current?.fit()
      if (commandAlignment !== 'default' && !isPtyActive) {
        setTimeout(() => inputBarRef.current?.focus(), 50)
      } else {
        termRef.current?.focus()
      }
    }
  }, [active, commandAlignment, isPtyActive])

  // ── input-bar handlers (bar modes only) ─────────────────────────────────────
  const handleInputBarChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputBarValue(value)
    lineRef.current = value
    updateMenuRef.current()
  }, [])

  const handleInputBarKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = inputBarValue
      setInputBarValue('')
      setMenu(null)
      lineRef.current = ''
      submitRef.current(value)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      lineRef.current = inputBarValue
      handleTabRef.current()
    } else if (e.key === 'Escape') {
      setMenu(null)
    } else if (e.ctrlKey && (e.key === 'c' || e.key === 'u')) {
      e.preventDefault()
      setInputBarValue('')
      setMenu(null)
      lineRef.current = ''
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const hist = historyRef.current
      if (hist.length === 0) return
      if (historyIdxRef.current === -1) {
        savedInputRef.current = inputBarValue
        historyIdxRef.current = hist.length - 1
      } else if (historyIdxRef.current > 0) {
        historyIdxRef.current--
      } else { return }
      const v = hist[historyIdxRef.current]
      setInputBarValue(v); lineRef.current = v
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdxRef.current === -1) return
      const hist = historyRef.current
      if (historyIdxRef.current === hist.length - 1) {
        historyIdxRef.current = -1
        const v = savedInputRef.current
        setInputBarValue(v); lineRef.current = v
      } else {
        historyIdxRef.current++
        const v = hist[historyIdxRef.current]
        setInputBarValue(v); lineRef.current = v
      }
    }
  }, [inputBarValue]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── render ────────────────────────────────────────────────────────────────────
  const cwdLabel = React.useMemo(() => {
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length === 0) return '~'
    return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/')
  }, [cwd])

  // barPath: prefer Go's formatted path (respects minimal_pwd); fall back to
  // the CWD-state-derived cwdLabel while Go hasn't sent a bar-prompt yet.
  const barPath = barPrompt.path || cwdLabel

  // ── Breadcrumb bar ─────────────────────────────────────────────────────────
  // CSS border-triangle technique: each segment is a plain <div> with a solid
  // background.  An absolutely-positioned child with width:0/height:0 and
  // transparent top/bottom borders + solid left border creates a right-pointing
  // triangle that extends OVER the next segment.  Because the triangle's
  // transparent halves reveal the next segment's background, the join is
  // seamless — no clip-path, no characters, no gaps.
  const H  = 36  // bar height px (h-9)
  const _AW = 34  // arrow width  px
  const hasTs = !!barPrompt.ts
  const hasBr = !!barPrompt.branch

  const inputBar = commandAlignment !== 'default' ? (
    <div
      className={[
        'flex items-stretch h-9 shrink-0',
        commandAlignment === 'top' ? 'border-b' : 'border-t',
        'border-[var(--border-color)]',
      ].join(' ')}
    >
      {!isPtyActive && (
        <div style={{ display: 'flex', flexShrink: 0, height: H, gap: 0, margin: 0, padding: 0 }}>

          {hasTs && (
            <div style={{
              display: 'flex', alignItems: 'center',
              background: 'rgb(18,48,100)', color: 'rgb(110,190,255)',
              height: H, margin: 0, marginRight: -1, paddingLeft: 10, paddingRight: 10,
              fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', userSelect: 'none',
              position: 'relative', zIndex: 2,
            }}>
              {barPrompt.ts}
            </div>
          )}

          <div style={{
            display: 'flex', alignItems: 'center',
            background: 'rgb(12,60,18)', color: 'rgb(140,230,110)',
            height: H, margin: 0, marginRight: hasBr ? -1 : 0, paddingLeft: 10, paddingRight: 10,
            fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', userSelect: 'none',
            maxWidth: 260, overflow: 'hidden',
            position: 'relative', zIndex: 1,
          }}>
            {barPath}
          </div>

          {hasBr && (
            <div style={{
              display: 'flex', alignItems: 'center',
              background: 'rgb(80,38,0)', color: 'rgb(255,175,50)',
              height: H, margin: 0, paddingLeft: 10, paddingRight: 10,
              fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', userSelect: 'none',
              position: 'relative', zIndex: 0,
            }}>
              {barPrompt.branch}
            </div>
          )}
        </div>
      )}

      {isPtyActive && (
        <div className="flex items-center px-4 text-[11px] font-mono text-[var(--tab-color)] opacity-40 italic select-none shrink-0">
          Running…
        </div>
      )}

      {/* ── text input ──────────────────────────────────────────────────── */}
      <div className="flex items-center flex-1 min-w-0 px-3">
        <input
          ref={inputBarRef}
          type="text"
          value={isPtyActive ? '' : inputBarValue}
          onChange={handleInputBarChange}
          onKeyDown={handleInputBarKeyDown}
          disabled={isPtyActive}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--info-bar-hover-color)] font-mono text-[13px] caret-[var(--info-bar-hover-color)]"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  ) : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {commandAlignment === 'top' && inputBar}
      <div ref={containerRef} className="flex-1 px-3 py-2 bg-[var(--app-bg)] overflow-hidden" />
      {commandAlignment === 'bottom' && inputBar}

      {menu && ReactDOM.createPortal(
        <div
          className="fixed z-[9999] bg-[var(--info-bar-bg)] border border-[var(--border-color)] rounded-md overflow-y-auto max-h-[220px] min-w-[180px] shadow-lg font-mono text-[12px] py-1 backdrop-blur-[12px] no-scrollbar"
          style={{ top: menu.top, left: menu.left }}
        >
          {menu.matches.map((m, i) => (
            <div
              key={m + i}
              className={`flex items-center justify-between gap-4 px-3 py-[5px] cursor-pointer text-[var(--info-bar-hover-color)] whitespace-nowrap leading-[1.4] transition-[background] duration-[100ms]${i === menu.selectedIdx && menu.applied ? ' bg-surface-selected text-accent-hover' : i === menu.selectedIdx ? ' bg-surface-overlay text-[var(--info-bar-hover-color)]' : ' hover:bg-surface-raised'}`}
              onMouseDown={e => {
                e.preventDefault() // keep terminal focus
                applyMatchRef.current?.(m)
              }}
            >
              <span className="shrink-0">{m}</span>
              {menu.descriptions?.[i] && (
                <span className="text-[var(--info-bar-color)] text-[11px] shrink-0">{menu.descriptions[i]}</span>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
