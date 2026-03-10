import { ipcMain } from 'electron'
import type { AgentProcessWatcher } from '../services/AgentProcessWatcher'

export function registerAgentHandlers(watcher: AgentProcessWatcher): void {
  ipcMain.handle('agent:getState', () => {
    return watcher.getState()
  })
}
