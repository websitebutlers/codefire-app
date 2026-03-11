import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
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

  ipcMain.handle('mcp:checkProjectConfig', (_event, projectPath: string) => {
    const mcpJsonPath = path.join(projectPath, '.mcp.json')
    try {
      if (fs.existsSync(mcpJsonPath)) {
        const config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'))
        if (config?.mcpServers?.codefire) return { connected: true }
      }
    } catch { /* ignore parse errors */ }
    return { connected: false }
  })

  ipcMain.handle('mcp:installProjectConfig', (_event, projectPath: string) => {
    const serverPath = MCPServerManager.getMcpServerPath()
    const mcpJsonPath = path.join(projectPath, '.mcp.json')

    let config: Record<string, unknown> = {}
    try {
      if (fs.existsSync(mcpJsonPath)) {
        config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'))
      }
    } catch { /* start fresh */ }

    const servers = (config.mcpServers as Record<string, unknown>) ?? {}
    servers['codefire'] = {
      type: 'stdio',
      command: 'node',
      args: [serverPath],
    }
    config.mcpServers = servers

    fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true })
    fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    return { success: true }
  })
}
