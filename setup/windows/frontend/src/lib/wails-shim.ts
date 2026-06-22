// Wails shim for the C++ installer — routes window.go.main.App.* through IPC.
import { invoke, on } from './ipc'

;(window as any).go = {
  main: {
    App: {
      GetReleases:    () => invoke('installer.getReleases'),
      GetChannel:     () => invoke<string>('installer.getChannel'),
      GetInstallDir:  () => invoke<string>('installer.getInstallDir'),
      Install: (version: string, createDesktop: boolean) =>
        invoke('installer.install', { version, createDesktop }),
      LaunchAndClose: () => invoke('installer.launch'),
      CloseInstaller: () => invoke('installer.close'),
    },
  },
}

;(window as any).runtime = {
  EventsOn: (event: string, cb: (data: unknown) => void) => on(event, cb),
  EventsOff: () => {},
  EventsOnce: (event: string, cb: (data: unknown) => void) => {
    const unsub = on(event, (data) => { unsub(); cb(data) })
    return unsub
  },
}
