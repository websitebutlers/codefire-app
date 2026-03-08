import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface MemoryEntry {
  name: string
  path: string
  isMain: boolean
}

/**
 * Encode a project path for use in the Claude memory directory structure.
 * Replaces '/' with '-' and prepends '-'.
 */
function encodeProjectPath(projectPath: string): string {
  // Replace colons, forward slashes, and backslashes with dashes
  // e.g. "C:\Users\foo\project" → "C--Users-foo-project"
  // e.g. "/Users/foo/project" → "-Users-foo-project"
  return projectPath.replace(/[:/\\]/g, '-')
}

/**
 * Get the memory directory path for a given project path.
 */
function getMemoryDir(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath)
  return path.join(os.homedir(), '.claude', 'projects', encoded, 'memory')
}

/**
 * Register IPC handlers for memory file operations.
 */
export function registerMemoryHandlers() {
  ipcMain.handle(
    'memory:getDir',
    (_event, projectPath: string): string => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      return getMemoryDir(projectPath)
    }
  )

  ipcMain.handle(
    'memory:list',
    (_event, projectPath: string): MemoryEntry[] => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      const memDir = getMemoryDir(projectPath)

      try {
        if (!fs.existsSync(memDir)) {
          return []
        }

        const entries = fs.readdirSync(memDir, { withFileTypes: true })
        const result: MemoryEntry[] = []

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) {
            continue
          }

          const fullPath = path.join(memDir, entry.name)
          result.push({
            name: entry.name,
            path: fullPath,
            isMain: entry.name === 'MEMORY.md',
          })
        }

        // Sort: MEMORY.md first, then alphabetical
        result.sort((a, b) => {
          if (a.isMain !== b.isMain) {
            return a.isMain ? -1 : 1
          }
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })

        return result
      } catch (err) {
        throw new Error(
          `Failed to list memory files: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'memory:read',
    (_event, filePath: string): string => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        const stat = fs.statSync(filePath)
        if (stat.size > 2 * 1024 * 1024) {
          throw new Error('File too large (>2MB)')
        }
        return fs.readFileSync(filePath, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to read memory file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'memory:write',
    (_event, filePath: string, content: string): void => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }
      if (typeof content !== 'string') {
        throw new Error('content must be a string')
      }

      try {
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(filePath, content, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to write memory file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'memory:delete',
    (_event, filePath: string): void => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        fs.unlinkSync(filePath)
      } catch (err) {
        throw new Error(
          `Failed to delete memory file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'memory:create',
    (_event, projectPath: string, fileName: string): MemoryEntry => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }
      if (!fileName || typeof fileName !== 'string') {
        throw new Error('fileName is required and must be a string')
      }

      // Ensure .md extension
      const name = fileName.endsWith('.md') ? fileName : `${fileName}.md`
      const memDir = getMemoryDir(projectPath)

      try {
        if (!fs.existsSync(memDir)) {
          fs.mkdirSync(memDir, { recursive: true })
        }

        const fullPath = path.join(memDir, name)
        if (fs.existsSync(fullPath)) {
          throw new Error(`Memory file already exists: ${name}`)
        }

        fs.writeFileSync(fullPath, '', 'utf-8')

        return {
          name,
          path: fullPath,
          isMain: name === 'MEMORY.md',
        }
      } catch (err) {
        throw new Error(
          `Failed to create memory file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )
}
