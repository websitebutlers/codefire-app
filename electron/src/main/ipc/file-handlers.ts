import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/** Directories to skip when listing files */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.DS_Store',
])

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

/**
 * Register IPC handlers for file system operations.
 */
export function registerFileHandlers() {
  ipcMain.handle('dialog:selectFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory'] as ('openDirectory')[] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'files:list',
    (_event, dirPath: string): FileEntry[] => {
      if (!dirPath || typeof dirPath !== 'string') {
        throw new Error('dirPath is required and must be a string')
      }

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        const result: FileEntry[] = []

        for (const entry of entries) {
          // Skip hidden files/dirs (except .env files) and known skip dirs
          if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) {
            continue
          }
          if (SKIP_DIRS.has(entry.name)) {
            continue
          }

          const fullPath = path.join(dirPath, entry.name)
          const fileEntry: FileEntry = {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
          }

          if (!entry.isDirectory()) {
            try {
              const stat = fs.statSync(fullPath)
              fileEntry.size = stat.size
            } catch {
              // Ignore stat errors
            }
          }

          result.push(fileEntry)
        }

        // Sort: directories first, then alphabetical
        result.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
          }
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })

        return result
      } catch (err) {
        throw new Error(
          `Failed to list directory: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle('shell:showInExplorer', (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required and must be a string')
    }
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(
    'files:read',
    (_event, filePath: string): string => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        // Limit file size to 2MB to avoid loading huge files
        const stat = fs.statSync(filePath)
        if (stat.size > 2 * 1024 * 1024) {
          throw new Error('File too large (>2MB)')
        }
        return fs.readFileSync(filePath, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to read file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'files:write',
    (_event, filePath: string, content: string): void => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }
      if (typeof content !== 'string') {
        throw new Error('content must be a string')
      }

      try {
        // Ensure parent directory exists
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(filePath, content, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to write file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )
}
