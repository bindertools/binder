// Wails compatibility shim for the C++ WebView host.
// Patches window.go.main.App.* and window.runtime.* to route through ipc.ts.
// Only loaded when isWebViewHost() === true.
//
// IPC type names must match exactly what cpp/host/dispatch.cpp handles.
// Full C++ implementation: Phase I.3.

import { invoke, on, offAll } from './ipc'

// ── File content codec ────────────────────────────────────────────────────────
// C++ readfile returns base64-encoded bytes; writefile expects the same.
function b64ToText(b64: string): string {
  const binStr = atob(b64)
  const bytes = new Uint8Array(binStr.length)
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function textToB64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binStr = ''
  for (let i = 0; i < bytes.length; i++) binStr += String.fromCharCode(bytes[i])
  return btoa(binStr)
}

// ── window.go.main.App patch ──────────────────────────────────────────────────
;(window as any).go = {
  main: {
    App: {
      // ── Terminal ──────────────────────────────────────────────────────────
      // Frontend calls CreateTerminal(id, cwd) — 2nd arg is working directory,
      // NOT the shell. Let C++ auto-detect shell via COMSPEC.
      CreateTerminal: (id: string, cwd: string, alignment?: string) =>
        invoke('terminal.start', { id, shell: '', cwd, cols: 80, rows: 24, alignment: alignment ?? 'default' }),

      CloseTerminal: (id: string) =>
        invoke('terminal.stop', { id }),

      TerminalInput: (id: string, data: string) =>
        invoke('terminal.input', { id, data }),

      ResizeTerminal: (id: string, cols: number, rows: number) =>
        invoke('terminal.resize', { id, cols, rows }),

      InterruptCommand: (id: string) =>
        invoke('terminal.interrupt', { id }),

      SetTerminalCwd: (id: string, cwd: string) =>
        invoke('terminal.setcwd', { id, cwd }),

      GetTerminalCwd: (id: string) =>
        invoke<string>('terminal.cwd', { id }),

      SetTerminalAlignment: (id: string, alignment: string) =>
        invoke('terminal.setalignment', { id, alignment }),

      ExecuteCommand: (id: string, cmd: string) =>
        invoke('terminal.execute', { id, cmd }),

      // ── File ops ──────────────────────────────────────────────────────────
      ExplorerGetTree: () =>
        invoke('fs.tree', { path: '.' }),

      ExplorerOpen: (path: string) =>
        invoke('fs.tree', { path }),

      ExplorerGetFile: async (path: string) => {
        const r = await invoke<{ content: string }>('fs.readfile', { path })
        return b64ToText(r.content)
      },

      ReadFile: async (path: string) => {
        const r = await invoke<{ content: string }>('fs.readfile', { path })
        return b64ToText(r.content)
      },

      ExplorerSaveFile: (path: string, content: string) =>
        invoke('fs.writefile', { path, content: textToB64(content) }),

      WriteFile: (path: string, content: string) =>
        invoke('fs.writefile', { path, content: textToB64(content) }),

      ExplorerDelete: (path: string) =>
        invoke('fs.delete', { path }),

      DeleteFile: (path: string) =>
        invoke('fs.delete', { path }),

      ExplorerRename: (from: string, to: string) =>
        invoke('fs.rename', { from, to }),

      ExplorerMove: (from: string, to: string) =>
        invoke('fs.rename', { from, to }),

      ExplorerCreateFile: (path: string) =>
        invoke('fs.create', { path }),

      ExplorerCreateDir: (path: string) =>
        invoke('fs.mkdir', { path }),

      ExplorerReveal: (path: string) =>
        invoke('shell.reveal', { path }),

      CtrlClickPath: (tabId: string, path: string) =>
        invoke('shell.ctrlclick', { tabId, path }),

      GetFileLanguage: (path: string) =>
        invoke<string>('fs.language', { path }),

      // ── Config ────────────────────────────────────────────────────────────
      GetAppConfig: () =>
        invoke('config.get'),

      SaveAppConfig: (cfg: unknown) =>
        invoke('config.setall', { config: cfg }),

      SaveCustomTheme: (theme: Record<string, string>) =>
        invoke('config.set', { key: 'customTheme', value: theme }),

      // ── Search / completions ──────────────────────────────────────────────
      // Terminal.tsx calls GetCompletions(tabId, dir, partial) for filesystem completions.
      // Route to complete.path so C++ can resolve paths relative to the session cwd.
      GetCompletions: (tabId: string, dir: string, partial: string) =>
        invoke<string[]>('complete.path', { tabId, dir, prefix: partial }),

      // search.files: pass the first arg as "path". The C++ handler also accepts
      // a terminal session ID as "path" and resolves it to the session's CWD.
      SearchFiles: (root: string, query: string) =>
        invoke<any[]>('search.files', { path: root, query }),

      // ExecSilent(workingDir, cmd, args) — note: workingDir is the first arg here
      // (the original Wails Go binding used the same order).
      ExecSilent: (workingDir: string, cmd: string, args: string[]) =>
        invoke<string>('shell.exec', { cmd, dir: workingDir, args }),

      SelectDirectory: () =>
        invoke<string>('shell.selectdir'),

      // ── System info ───────────────────────────────────────────────────────
      // C++ replies with {ports:[...]}; frontend expects a flat array.
      GetSystemPorts: () =>
        invoke<any>('sysinfo.ports').then((r: any) => Array.isArray(r) ? r : (r?.ports ?? [])),

      GetSystemPerf: () =>
        invoke('sysinfo.perf'),

      StartPerfMonitor: (id: string) =>
        invoke('sysinfo.perf.start', { id }),

      StopPerfMonitor: (id: string) =>
        invoke('sysinfo.perf.stop', { id }),

      KillPort: (port: string) =>
        invoke<string>('sysinfo.ports.kill', { port }),

      // ── Session ───────────────────────────────────────────────────────────
      // C++ returns {session:{tabs:[...]}} or {session:{}}; frontend expects a
      // flat array of tab objects.
      LoadSession: () =>
        invoke<any>('session.load').then((r: any) => {
          if (Array.isArray(r)) return r           // already an array
          if (Array.isArray(r?.session?.tabs)) return r.session.tabs
          if (Array.isArray(r?.tabs)) return r.tabs
          return []
        }),

      SaveSession: (tabs: unknown[]) =>
        invoke('session.save', { tabs }),

      // ── Updater ───────────────────────────────────────────────────────────
      CheckForUpdate: () =>
        invoke<string>('updater.check'),

      PerformUpdate: (version: string) =>
        invoke('updater.download', { version }),

      // ── Preview ───────────────────────────────────────────────────────────
      // (handled by preview events)

      // ── Plugins ───────────────────────────────────────────────────────────
      FetchExternalPlugin: (id: string) =>
        invoke('plugin.fetch', { id }),

      // ── Misc ──────────────────────────────────────────────────────────────
      GetCppBackendStatus: () =>
        invoke<string>('debug.version'),

      GetClipboardText: () =>
        invoke<string>('clipboard.get'),

      SetClipboardText: (text: string) =>
        invoke('clipboard.set', { text }),

      OpenNewWindow: () =>
        invoke('window.new'),

      ReadDatabase: (path: string) =>
        invoke('db.read', { path }),

      ScanProblems: (path: string) =>
        invoke('problems.scan', { path }),

      ScanCWE: (path: string) =>
        invoke('problems.cwe', { path }),
    },
  },
}

// ── window.runtime patch ──────────────────────────────────────────────────────
;(window as any).runtime = {
  EventsOn:  (event: string, cb: (data: unknown) => void) => on(event, cb),
  EventsOff: (event: string, ...names: string[]) => {
    // Remove ALL handlers for this event — Wails EventsOff does not take a
    // handler reference, it removes every listener for the named event(s).
    // Bug was: passing () => {} to off() which never matched the real handler.
    offAll(event)
    names.forEach(n => offAll(n))
  },
  EventsOnce: (event: string, cb: (data: unknown) => void) => {
    const unsub = on(event, (data) => { unsub(); cb(data) })
    return unsub
  },
  EventsOnMultiple: (event: string, cb: (data: unknown) => void, max: number) => {
    // max < 0 means unlimited (Wails convention: -1 = EventsOn)
    if (max < 0) return on(event, cb)
    let count = 0
    const unsub = on(event, (data) => {
      cb(data)
      if (++count >= max) unsub()
    })
    return unsub
  },
  EventsEmit: (event: string, ...args: unknown[]) => {
    console.warn('EventsEmit not supported in C++ host:', event, args)
  },
  EventsOffAll: () => {
    console.warn('EventsOffAll not supported in C++ host')
  },
  // Quit — called by the close button (Quit() from wailsjs/runtime/runtime)
  Quit: () => invoke('window.close'),
  WindowSetTitle: (title: string) =>
    invoke('window.setTitle', { title }),
  WindowMinimise: () =>
    invoke('window.minimise'),
  WindowMaximise: () =>
    invoke('window.maximise'),
  WindowUnmaximise: () =>
    invoke('window.unmaximise'),
  WindowToggleMaximise: () =>
    invoke('window.toggleMaximise'),
  WindowIsMaximised: () =>
    invoke<boolean>('window.isMaximised'),
  WindowIsMinimised: () =>
    invoke<boolean>('window.isMinimised'),
  WindowCenter:       () => invoke('window.centre'),
  WindowReload:       () => { window.location.reload() },
  WindowReloadApp:    () => { window.location.reload() },
  WindowFullscreen:   () => invoke('window.fullscreen'),
  WindowUnfullscreen: () => invoke('window.unfullscreen'),
  WindowIsFullscreen: () => invoke<boolean>('window.isFullscreen'),
  WindowSetSize:      (w: number, h: number) => invoke('window.setSize', { width: w, height: h }),
  WindowGetSize:      () => invoke('window.getSize'),
  WindowSetPosition:  (x: number, y: number) => invoke('window.setPosition', { x, y }),
  WindowGetPosition:  () => invoke('window.getPosition'),
  BrowserOpenURL:     (url: string) => invoke('shell.openUrl', { url }),
  WindowSetAlwaysOnTop: (b: boolean) => invoke('window.alwaysOnTop', { value: b }),
  WindowSetMaxSize:   (w: number, h: number) => invoke('window.setMaxSize', { width: w, height: h }),
  WindowSetMinSize:   (w: number, h: number) => invoke('window.setMinSize', { width: w, height: h }),
  // Log stubs (C++ uses spdlog, not Wails log)
  LogPrint:   (m: string) => console.log('[wails]', m),
  LogTrace:   (m: string) => console.debug('[wails]', m),
  LogDebug:   (m: string) => console.debug('[wails]', m),
  LogInfo:    (m: string) => console.info('[wails]', m),
  LogWarning: (m: string) => console.warn('[wails]', m),
  LogError:   (m: string) => console.error('[wails]', m),
  LogFatal:   (m: string) => { console.error('[wails fatal]', m); throw new Error(m) },
  // Screen / environment
  ScreenGetAll: () => Promise.resolve([]),
  Environment: () => Promise.resolve({ platform: 'windows', arch: 'amd64', buildType: 'production' }),
}
