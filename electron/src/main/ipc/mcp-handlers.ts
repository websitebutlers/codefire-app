import { ipcMain } from 'electron'
import { MCPServerManager } from '../services/MCPServerManager'

export function registerMCPHandlers(mcpManager: MCPServerManager) {
  ipcMain.handle('mcp:status', () => ({
    status: mcpManager.status,
    sessionCount: mcpManager.sessionCount,
  }))

  ipcMain.handle('mcp:getServerPath', () => {
    return MCPServerManager.getMcpServerPath()
  })

  ipcMain.handle('mcp:listConnections', () => mcpManager.listConnections())

  ipcMain.handle('mcp:start', () => {
    mcpManager.start()
    return { success: true }
  })

  ipcMain.handle('mcp:stop', () => {
    mcpManager.stop()
    return { success: true }
  })
}
