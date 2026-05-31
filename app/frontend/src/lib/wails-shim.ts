// Wails compatibility shim for the C++ WebView host.
// Patches window.go.main.App.* and window.runtime.* to route through ipc.ts.
// Only loaded when isWebViewHost() === true.
//
// IPC type names must match exactly what cpp/host/dispatch.cpp handles.
// Full C++ implementation: Phase I.3.

import { invoke, on, off } from './ipc'

// ── window.go.main.App patch ──────────────────────────────────────────────────
;(window as any).go = {
  main: {
    App: {
      // ── Terminal ──────────────────────────────────────────────────────────
      CreateTerminal: (id: string, shell: string) =>
        invoke('terminal.start', { id, shell, cwd: '', cols: 80, rows: 24 }),

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
        invoke('terminal.input', { id, data: cmd + '\r' }),

      // ── File ops ──────────────────────────────────────────────────────────
      ExplorerGetTree: () =>
        invoke('fs.tree', { path: '.' }),

      ExplorerOpen: (path: string) =>
        invoke('fs.tree', { path }),

      ExplorerGetFile: (path: string) =>
        invoke<string>('fs.readfile', { path }),

      ReadFile: (path: string) =>
        invoke<string>('fs.readfile', { path }),

      ExplorerSaveFile: (path: string, content: string) =>
        invoke('fs.writefile', { path, content }),

      WriteFile: (path: string, content: string) =>
        invoke('fs.writefile', { path, content }),

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

      CtrlClickPath: (path: string, cwd: string) =>
        invoke('shell.ctrlclick', { path, cwd }),

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
      SearchFiles: (root: string, query: string) =>
        invoke('search.files', { root, query }),

      GetCompletions: (type: string, path: string, partial: string) =>
        type === 'path'
          ? invoke('complete.path', { path, partial })
          : invoke('complete.command', { cwd: path, partial }),

      ExecSilent: (cmd: string, dir: string, args: string[]) =>
        invoke<string>('shell.exec', { cmd, dir, args }),

      SelectDirectory: () =>
        invoke<string>('shell.selectdir'),

      // ── System info ───────────────────────────────────────────────────────
      GetSystemPorts: () =>
        invoke('sysinfo.ports'),

      GetSystemPerf: () =>
        invoke('sysinfo.perf'),

      StartPerfMonitor: (id: string) =>
        invoke('sysinfo.perf.start', { id }),

      StopPerfMonitor: (id: string) =>
        invoke('sysinfo.perf.stop', { id }),

      KillPort: (port: string) =>
        invoke<string>('sysinfo.ports.kill', { port }),

      // ── Session ───────────────────────────────────────────────────────────
      LoadSession: () =>
        invoke('session.load'),

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

      ReadDatabase: (key: string) =>
        invoke('db.read', { key }),

      ScanProblems: (path: string) =>
        invoke('problems.scan', { path }),
    },
  },
}

// ── window.runtime patch ──────────────────────────────────────────────────────
;(window as any).runtime = {
  EventsOn:  (event: string, cb: (data: unknown) => void) => on(event, cb),
  EventsOff: (event: string, ...names: string[]) => {
    // wails EventsOff removes all listeners for the event (we pass undefined as handler to remove all)
    // For simplicity, just use the first event name
    off(event, (() => {}) as any)
    names.forEach(n => off(n, (() => {}) as any))
  },
  EventsOnce: (event: string, cb: (data: unknown) => void) => {
    const unsub = on(event, (data) => { unsub(); cb(data) })
    return unsub
  },
  EventsOnMultiple: (event: string, cb: (data: unknown) => void, max: number) => {
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
