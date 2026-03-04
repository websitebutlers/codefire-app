import { contextBridge, ipcRenderer } from 'electron'
import { homedir } from 'os'
import type { IpcChannel } from '@shared/types'

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: IpcChannel, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  homePath: homedir(),
})
