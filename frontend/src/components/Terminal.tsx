import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import {
  CreateTerminal,
  ExecuteCommand,
  InterruptCommand,
  CloseTerminal,
  GetClipboardText,
  GetTerminalCwd,
  SetTerminalCwd,
  SelectDirectory,
  GetCompletions,
} from '../../wailsjs/go/main/App'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tabId: string
  active: boolean
}

function abbreviatePath(path: string): string {
  return path.replace(/\\/g, '/')
}

// Completion state stored in a ref so it's accessible inside xterm callbacks
// without triggering re-renders.
interface CompletionState {
  matches: string[]  // all matching filenames (with "/" suffix for dirs)
  index: number      // which one is currently displayed
  prefix: string     // everything in the line before the partial (e.g. "open src/")
  applied: string    // the completion string currently written to the terminal
}

export default function Terminal({ tabId, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])

  const [cwd, setCwd] = useState('')

  useEffect(() => {
    GetTerminalCwd(tabId).then(p => { if (p) setCwd(p) }).catch(() => {})
  }, [tabId])

  useEffect(() => {
    const event = `terminal:cwd:${tabId}`
    EventsOn(event, (path: string) => setCwd(path))
    return () => EventsOff(event)
  }, [tabId])

  const handleCwdClick = async () => {
    const path = await SelectDirectory().catch(() => '')
    if (path) SetTerminalCwd(tabId, path)
  }

  // Per-terminal font size — survives tab switches because the xterm instance
  // stays mounted (display:none). State is kept in sync so if the terminal
  // ever reconstructs it starts at the last-used size.
  const [fontSize, setFontSize] = useState(13)

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current

    const term = new XTerm({
      theme: {
        background: '#0d0d0d',
        foreground: '#cccccc',
        cursor: '#cccccc',
        cursorAccent: '#0d0d0d',
        selectionBackground: '#264f7855',
        black: '#1a1a1a', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
        blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
        brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
        brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
        brightCyan: '#29b8db', brightWhite: '#ffffff',
      },
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
      fontSize,
      lineHeight: 1.45,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 5000,
      convertEol: false,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    fitAddon.fit()
    termRef.current = term
    fitRef.current = fitAddon

    // Ctrl+Wheel — zoom this terminal's font size independently
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

    CreateTerminal(tabId).catch(() => {})

    const outEvent = `terminal:output:${tabId}`
    EventsOn(outEvent, (data: string) => { term.write(data) })

    const lineRef = { current: '' }
    const completionRef: { current: CompletionState | null } = { current: null }

    // ── helpers ──────────────────────────────────────────────────────────────

    const processPaste = (text: string) => {
      completionRef.current = null
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

    // Erase `count` characters from the terminal display and lineRef
    const eraseChars = (count: number) => {
      if (count <= 0) return
      term.write('\b \b'.repeat(count))
      lineRef.current = lineRef.current.slice(0, -count)
    }

    // ── Tab completion ────────────────────────────────────────────────────────

    const handleTab = () => {
      const comp = completionRef.current

      if (comp) {
        // Cycle to next match
        const nextIdx = (comp.index + 1) % comp.matches.length
        const nextMatch = comp.matches[nextIdx]
        eraseChars(comp.applied.length)
        term.write(nextMatch)
        lineRef.current = comp.prefix + nextMatch
        comp.index = nextIdx
        comp.applied = nextMatch
        return
      }

      // Start a new completion from the current line
      const line = lineRef.current
      const lastSpace = line.lastIndexOf(' ')
      if (lastSpace < 0) return // still typing the command name — skip

      const token = line.slice(lastSpace + 1)
      const lastSlash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'))
      const dir = lastSlash >= 0 ? token.slice(0, lastSlash + 1) : ''
      const partial = lastSlash >= 0 ? token.slice(lastSlash + 1) : token
      const prefix = line.slice(0, line.length - partial.length)

      GetCompletions(tabId, dir, partial)
        .then((matches: string[]) => {
          if (!matches || matches.length === 0) return

          // If there's only one match and it's an exact match, do nothing
          if (matches.length === 1 && matches[0].replace(/\/$/, '') === partial) return

          const first = matches[0]
          eraseChars(partial.length)
          term.write(first)
          lineRef.current = prefix + first

          completionRef.current = { matches, index: 0, prefix, applied: first }
        })
        .catch(() => {})
    }

    // ── Tab — capture at window level before WebView2 swallows it ────────────
    // WebView2 intercepts Tab for native focus cycling before DOM events reach
    // xterm's onData. Capturing here ensures we always see it first.

    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (!activeRef.current) return
      e.preventDefault()
      e.stopImmediatePropagation()
      handleTab()
    }
    window.addEventListener('keydown', onWindowKeyDown, { capture: true })

    // ── paste ─────────────────────────────────────────────────────────────────

    const onWindowPaste = (e: ClipboardEvent) => {
      if (!activeRef.current) return
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text) processPaste(text)
    }
    window.addEventListener('paste', onWindowPaste)

    // ── input ─────────────────────────────────────────────────────────────────

    term.onData((data: string) => {
      // Enter
      if (data === '\r' || data === '\n') {
        completionRef.current = null
        const line = lineRef.current
        lineRef.current = ''
        term.write('\r\n')
        ExecuteCommand(tabId, line)
        return
      }

      // Backspace
      if (data === '\x7f' || data === '\b') {
        completionRef.current = null
        if (lineRef.current.length > 0) {
          lineRef.current = lineRef.current.slice(0, -1)
          term.write('\b \b')
        }
        return
      }

      // Ctrl+C
      if (data === '\x03') {
        completionRef.current = null
        term.write('^C\r\n')
        lineRef.current = ''
        InterruptCommand(tabId)
        return
      }

      // Ctrl+L
      if (data === '\x0c') {
        completionRef.current = null
        term.write('\x1b[2J\x1b[H')
        lineRef.current = ''
        ExecuteCommand(tabId, 'clear')
        return
      }

      // Ctrl+U
      if (data === '\x15') {
        completionRef.current = null
        if (lineRef.current.length > 0) {
          term.write('\x1b[' + lineRef.current.length + 'D' +
            ' '.repeat(lineRef.current.length) +
            '\x1b[' + lineRef.current.length + 'D')
          lineRef.current = ''
        }
        return
      }

      // Tab (\x09) — handled by the window keydown capture listener above.
      // Ignore here to avoid double-firing in environments where onData still
      // receives it after capture (e.g. non-WebView2 dev mode).
      if (data === '\x09') return

      // Ctrl+V — WebView2 sends raw \x16
      if (data === '\x16') {
        GetClipboardText().then(text => { if (text) processPaste(text) }).catch(() => {})
        return
      }

      // Other control characters (arrows, fn keys, etc.)
      if (data.charCodeAt(0) < 32) return

      // Any printable input resets completion
      completionRef.current = null

      if (data.length > 1) {
        processPaste(data)
      } else {
        lineRef.current += data
        term.write(data)
      }
    })

    const ro = new ResizeObserver(() => fitAddon.fit())
    ro.observe(containerRef.current!)

    return () => {
      ro.disconnect()
      container.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', onWindowKeyDown, { capture: true })
      window.removeEventListener('paste', onWindowPaste)
      EventsOff(outEvent)
      CloseTerminal(tabId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
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
      <div
        className="terminal-cwd"
        onClick={handleCwdClick}
        title="Click to change directory"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <path d="M1 4.5A1.5 1.5 0 012.5 3h3.086a1.5 1.5 0 011.06.44l.915.914A1.5 1.5 0 008.62 4.5H13.5A1.5 1.5 0 0115 6v6a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12V4.5z"
            stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        </svg>
        <span>{abbreviatePath(cwd)}</span>
      </div>
      <div ref={containerRef} className="terminal-container" />
    </div>
  )
}
