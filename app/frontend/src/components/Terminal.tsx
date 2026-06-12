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
import TerminalBlockList from './TerminalBlockList'
import GitBranchIcon from './GitBranchIcon'
import { type CommandBlock, isBackgroundCommand, deriveStatus } from '../lib/terminalBlocks'

interface Props {
  tabId: string
  active: boolean
  xtermTheme: ITheme
  initialCwd?: string
  defaultZoom?: number
  commandAlignment?: 'default' | 'top' | 'bottom'
  pluginCommands?: Record<string, InstalledPluginCommand>
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
  onCwdChange,
}: Props) {
  const containerRef           = useRef<HTMLDivElement>(null)
  const rootRef                = useRef<HTMLDivElement>(null)
  const termRef                = useRef<XTerm | null>(null)
  const fitRef                 = useRef<FitAddon | null>(null)
  const activeRef              = useRef(active)
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
    const startEv = `terminal:pty:start:${tabId}`
    const endEv   = `terminal:pty:end:${tabId}`
    EventsOn(startEv, () => {
      setIsPtyActive(true)
      setTimeout(() => { fitRef.current?.fit(); termRef.current?.focus() }, 50)
    })
    EventsOn(endEv,   () => { setIsPtyActive(false); setTimeout(() => inputBarRef.current?.focus(), 50) })
    return () => { EventsOff(startEv); EventsOff(endEv) }
  }, [tabId])

  // Keep Go terminal in sync when the user changes alignment via Settings.
  useEffect(() => {
    SetTerminalAlignment(tabId, commandAlignment).catch(() => {})
  }, [tabId, commandAlignment])

  // Structured prompt data pushed from Go after each command completes.
  const [barPrompt, setBarPrompt] = useState({ path: '', branch: '', ts: '' })
  // Ref so the submitRef closure always sees the latest bar prompt without going stale.
  const barPromptRef = useRef({ path: '', branch: '', ts: '' })
  useEffect(() => { barPromptRef.current = barPrompt }, [barPrompt])

  // Command blocks: the primary visible output surface.
  const [blocks, setBlocks] = useState<CommandBlock[]>([])
  const blocksRef = useRef<CommandBlock[]>([])
  const blocksRafRef = useRef<number | null>(null)
  const scheduleBlocksUpdate = () => {
    if (blocksRafRef.current != null) return
    blocksRafRef.current = requestAnimationFrame(() => {
      blocksRafRef.current = null
      setBlocks([...blocksRef.current])
    })
  }

  useEffect(() => {
    const ev = `terminal:bar-prompt:${tabId}`
    EventsOn(ev, (data: { path: string; branch: string; ts: string; exitCode?: number }) => {
      setBarPrompt(data)
      barPromptRef.current = data
      const list = blocksRef.current
      const last = list[list.length - 1]
      if (last && last.status === 'running') {
        const exitCode = data.exitCode ?? 0
        last.exitCode = exitCode
        last.status = deriveStatus(exitCode, isBackgroundCommand(last.command))
        scheduleBlocksUpdate()
      }
    })
    return () => EventsOff(ev)
  }, [tabId])

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

  useEffect(() => {
    const handler = (e: Event) => {
      const { terminalId, path } = (e as CustomEvent<{ terminalId: string; path: string }>).detail
      if (terminalId !== tabId || !path) return
      SetTerminalCwd(tabId, path).catch(() => {})
    }
    window.addEventListener('terminal:cd-to', handler)
    return () => window.removeEventListener('terminal:cd-to', handler)
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

    // Ctrl+C must interrupt a running foreground command no matter what's
    // focused within this terminal — the input bar's own onKeyDown only fires
    // while it has focus. Skipped while a PTY is active (xterm's own custom
    // key handler above already forwards ^C to the pty) and while the input
    // bar has focus (its handler covers that case and would double-fire).
    const handleGlobalInterrupt = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.key === 'c')) return
      if (!activeRef.current || ptyModeRef.current) return
      if (document.activeElement === inputBarRef.current) return
      const last = blocksRef.current[blocksRef.current.length - 1]
      if (last?.status !== 'running') return
      const el = document.activeElement
      if (el && el !== document.body && !rootRef.current?.contains(el)) return
      e.preventDefault()
      void InterruptCommand(tabId)
    }
    window.addEventListener('keydown', handleGlobalInterrupt)

    // Ctrl+scroll zoom: applies to both the hidden xterm (PTY mode) and the
    // visible command-block UI (via the --term-font-size CSS variable below).
    // Attached to the root wrapper, not the xterm container, since the
    // container is zero-size whenever no PTY is active.
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const current = termRef.current?.options.fontSize ?? fontSize
      const next = e.deltaY < 0 ? Math.min(current + 1, 36) : Math.max(current - 1, 8)
      if (termRef.current) termRef.current.options.fontSize = next
      fitRef.current?.fit()
      setFontSize(next)
    }
    const root = rootRef.current
    root?.addEventListener('wheel', handleWheel, { passive: false })

    CreateTerminal(tabId, initialCwd ?? '', commandAlignmentRef.current).catch(() => {})

    const outEvent = `terminal:output:${tabId}`
    // Use termRef.current (not the closure `term`) so that if the component
    // remounts and creates a new xterm instance, the handler always writes to
    // the currently-active terminal, not a stale/disposed one.
    EventsOn(outEvent, (data: string) => {
      termRef.current?.write(data)
      if (ptyModeRef.current) return
      // 'clear'/'cls' sends an ANSI clear-screen sequence — drop every earlier
      // block (keeping only the in-flight 'clear' block itself) so the block
      // list actually empties instead of just printing a confirmation line.
      if (data.includes('\x1b[2J')) {
        const last = blocksRef.current[blocksRef.current.length - 1]
        blocksRef.current = last ? [last] : []
      }
      const list = blocksRef.current
      const last = list[list.length - 1]
      if (last && last.status === 'running') {
        last.outputRaw += data
        scheduleBlocksUpdate()
      }
    })

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
      const { top, left } = barMenuPos(menuH)

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
          const { top, left } = barMenuPos(menuH)

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

    // Input-bar submit: push a new command block, then execute it.
    submitRef.current = (value: string) => {
      if (!value.trim()) return
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

      const block: CommandBlock = {
        id: `${tabId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        command: value,
        cwd: barPromptRef.current.path || cwdRef.current,
        branch: barPromptRef.current.branch,
        ts: barPromptRef.current.ts,
        outputRaw: '',
        status: 'running',
        exitCode: null,
      }
      blocksRef.current = [...blocksRef.current, block].slice(-200)
      scheduleBlocksUpdate()

      void ExecuteCommand(tabId, value)
    }

    // Apply a specific match from the menu (used by click handler).
    applyMatchRef.current = (match: string) => {
      const m = menuRef.current
      if (!m) return
      const newVal = m.prefix + match
      setInputBarValue(newVal)
      lineRef.current = newVal
      setMenu(null)
      inputBarRef.current?.focus()
    }

    // Tab: apply selected match, then advance selection for next Tab.
    const handleTab = () => {
      const m = menuRef.current
      if (!m || m.matches.length === 0) return

      if (!m.applied) {
        const match = m.matches[0]
        const newVal = m.prefix + match
        setInputBarValue(newVal)
        lineRef.current = newVal
        setMenu({ ...m, applied: true, appliedLen: match.length, selectedIdx: 0 })
      } else {
        const nextIdx = (m.selectedIdx + 1) % m.matches.length
        const match = m.matches[nextIdx]
        const newVal = m.prefix + match
        setInputBarValue(newVal)
        lineRef.current = newVal
        setMenu({ ...m, appliedLen: match.length, selectedIdx: nextIdx })
      }
    }
    handleTabRef.current = handleTab

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

    // xterm is only the active input surface during PTY passthrough (interactive
    // full-screen programs); the input row handles everything else.
    term.onData((data: string) => {
      if (!ptyModeRef.current) return
      TerminalInput(tabId, data).catch(() => {})
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
      root?.removeEventListener('wheel', handleWheel)
      container.removeEventListener('mousemove', handleCtrlMouseMove)
      container.removeEventListener('mousedown', handleCtrlClick)
      window.removeEventListener('keydown', handleCtrlKeyDown)
      window.removeEventListener('keyup',   handleCtrlKeyUp)
      window.removeEventListener('keydown', handleGlobalInterrupt)
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
      if (!isPtyActive) {
        setTimeout(() => inputBarRef.current?.focus(), 50)
      } else {
        termRef.current?.focus()
      }
    }
  }, [active, isPtyActive])

  // True while the most recent command hasn't returned yet — locks the input
  // row like a traditional terminal waiting for its prompt back.
  const isCommandRunning = blocks.length > 0 && blocks[blocks.length - 1].status === 'running'

  // ── input-bar handlers (bar modes only) ─────────────────────────────────────
  const handleInputBarChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputBarValue(value)
    lineRef.current = value
    updateMenuRef.current()
  }, [])

  const handleInputBarKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // While the previous command is still running, the input is locked like a
    // traditional shell waiting for its prompt back — only Ctrl+C is honored.
    if (isCommandRunning) {
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault()
        void InterruptCommand(tabId)
      }
      return
    }
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
    } else if (e.ctrlKey && e.key === 'c') {
      e.preventDefault()
      setInputBarValue('')
      setMenu(null)
      lineRef.current = ''
      void InterruptCommand(tabId)
    } else if (e.ctrlKey && e.key === 'u') {
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
  }, [inputBarValue, isCommandRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── render ────────────────────────────────────────────────────────────────────
  const cwdLabel = React.useMemo(() => {
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length === 0) return '~'
    return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/')
  }, [cwd])

  // barPath: prefer Go's formatted path (respects minimal_pwd); fall back to
  // the CWD-state-derived cwdLabel while Go hasn't sent a bar-prompt yet.
  const barPath = barPrompt.path || cwdLabel

  // ── Input row ──────────────────────────────────────────────────────────────
  // Always-visible, styled like a command block header but hosting the live
  // input. Positioned above the block list ('top') or below it (default/'bottom').
  const inputRow = (
    <div
      className={[
        'term-input-row flex items-stretch min-h-9 shrink-0',
        commandAlignment === 'top' ? 'border-b' : 'border-t',
        'border-[var(--border-color)]',
      ].join(' ')}
    >
      <span className={`term-dot term-dot--${isPtyActive || isCommandRunning ? 'running' : 'idle'}`} />
      <span className="term-cwd">{barPath}</span>
      {barPrompt.branch && (
        <span className="term-branch-tag">
          <GitBranchIcon />
          {barPrompt.branch}
        </span>
      )}
      <span className="term-arrow">{'❯'}</span>
      {isPtyActive ? (
        <div className="flex items-center px-2 text-[11px] font-mono text-[var(--tab-color)] opacity-40 italic select-none shrink-0">
          Running…
        </div>
      ) : (
        <input
          ref={inputBarRef}
          type="text"
          value={isCommandRunning ? '' : inputBarValue}
          onChange={handleInputBarChange}
          onKeyDown={handleInputBarKeyDown}
          readOnly={isCommandRunning}
          placeholder={isCommandRunning ? 'Running… (Ctrl+C to interrupt)' : undefined}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--info-bar-hover-color)] font-mono caret-[var(--info-bar-hover-color)] px-2 placeholder:italic placeholder:opacity-40"
          style={{ fontSize: 'inherit' }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      )}
      {barPrompt.ts && <span className="term-ts">{barPrompt.ts}</span>}
    </div>
  )

  // In 'default' alignment the input row flows inline as the next line after
  // the last block's output (like a real shell prompt), instead of being
  // pinned to the bottom of the pane. 'top'/'bottom' remain pinned bars; a
  // pinned row is also kept in 'default' while a PTY is active so there's
  // still a status row once the block list is hidden.
  const showInlineInputRow = commandAlignment === 'default' && !isPtyActive
  const showPinnedInputRow = commandAlignment !== 'default' || isPtyActive

  // Clicking anywhere in the terminal pane (other than an interactive element,
  // like the "click to expand" output toggle) sends focus to the input bar so
  // the user can start typing immediately — mirrors opening/switching to this
  // terminal tab, which also focuses it via the effect above.
  const handlePaneMouseDown = (e: React.MouseEvent) => {
    if (isPtyActive) return
    const target = e.target as HTMLElement
    if (target.closest('input, button, a, .term-output-more')) return
    requestAnimationFrame(() => inputBarRef.current?.focus())
  }

  return (
    <div
      ref={rootRef}
      className="flex-1 flex flex-col overflow-hidden"
      style={{ '--term-font-size': `${fontSize}px` } as React.CSSProperties}
      onMouseDown={handlePaneMouseDown}
    >
      {commandAlignment === 'top' && inputRow}
      {!isPtyActive && (
        <TerminalBlockList blocks={blocks} inputRow={showInlineInputRow ? inputRow : undefined} />
      )}
      <div
        ref={containerRef}
        className={isPtyActive ? 'flex-1 px-3 py-2 bg-[var(--app-bg)] overflow-hidden' : 'term-xterm-hidden'}
      />
      {commandAlignment !== 'top' && showPinnedInputRow && inputRow}

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
