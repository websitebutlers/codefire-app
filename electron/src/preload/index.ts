import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel } from '@shared/types'

/**
 * Allowed channels for fire-and-forget `send` (renderer → main).
 * Kept as a Set for O(1) lookup.
 */
const ALLOWED_SEND_CHANNELS = new Set<string>([
  'terminal:write',
  'terminal:writeToActive',
  'terminal:resize',
])

/** Prefixes allowed for dynamic send channels (e.g., browser:commandResult:123) */
const ALLOWED_SEND_PREFIXES = [
  'browser:commandResult:',
]

/**
 * Allowed channels for `on` (main → renderer event listeners).
 */
const ALLOWED_RECEIVE_CHANNELS = new Set<string>([
  'terminal:data',
  'terminal:exit',
  'terminal:created',
  'deeplink:result',
  'mcp:statusChanged',
  'menu:openSettings',
  'browser:commandRequest',
  'sessions:liveUpdate',
  'sessions:updated',
  'tasks:updated',
  'agent:update',
])

function isSendAllowed(channel: string): boolean {
  if (ALLOWED_SEND_CHANNELS.has(channel)) return true
  return ALLOWED_SEND_PREFIXES.some((prefix) => channel.startsWith(prefix))
}

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: IpcChannel, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      console.warn(`[preload] Blocked on() for unrecognized channel: ${channel}`)
      return () => {} // no-op unsubscribe
    }
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  send: (channel: string, ...args: unknown[]) => {
    if (!isSendAllowed(channel)) {
      console.warn(`[preload] Blocked send() for unrecognized channel: ${channel}`)
      return
    }
    ipcRenderer.send(channel, ...args)
  },
  homePath: process.env.USERPROFILE || process.env.HOME || '',
})
