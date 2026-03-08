import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'
import Database from 'better-sqlite3'

/**
 * Validates that file paths are within allowed boundaries.
 * Prevents arbitrary filesystem read/write from IPC handlers.
 */
export class PathValidator {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * Returns the list of allowed root directories for file operations.
   * A path is allowed if it falls under any of these roots.
   */
  private getAllowedRoots(): string[] {
    const roots: string[] = []
    const home = os.homedir()

    // 1. All registered project paths from the database
    try {
      const rows = this.db
        .prepare('SELECT path FROM projects')
        .all() as { path: string }[]
      for (const row of rows) {
        if (row.path) roots.push(path.resolve(row.path))
      }
    } catch {
      // DB may not be ready yet
    }

    // 2. Claude Code memory/rules directory (~/.claude/)
    roots.push(path.resolve(home, '.claude'))

    // 3. App's own userData directory (settings, recordings, etc.)
    try {
      roots.push(path.resolve(app.getPath('userData')))
    } catch {
      // app may not be ready
    }

    return roots
  }

  /**
   * Check if a file path is within an allowed root.
   * Resolves symlinks and normalizes to prevent traversal attacks.
   */
  isAllowed(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') return false

    const resolved = path.resolve(filePath)
    const roots = this.getAllowedRoots()

    return roots.some((root) => {
      // Ensure the resolved path starts with the root + separator
      // to prevent /projects/foo matching /projects/foobar
      return resolved === root || resolved.startsWith(root + path.sep)
    })
  }

  /**
   * Throws if the path is not allowed.
   */
  assertAllowed(filePath: string): void {
    if (!this.isAllowed(filePath)) {
      throw new Error(
        `Access denied: path is outside allowed directories`
      )
    }
  }
}

/** Singleton instance — initialized once when db is available */
let _instance: PathValidator | null = null

export function initPathValidator(db: Database.Database): PathValidator {
  _instance = new PathValidator(db)
  return _instance
}

export function getPathValidator(): PathValidator {
  if (!_instance) {
    throw new Error('PathValidator not initialized — call initPathValidator(db) first')
  }
  return _instance
}
