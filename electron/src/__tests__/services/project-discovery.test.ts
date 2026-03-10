import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import path from 'path'
import { resolvePath } from '../../main/services/ProjectDiscovery'

// ─── Mock fs for controlled testing ─────────────────────────────────────────

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    statSync: vi.fn(),
    readdirSync: actual.readdirSync,
  }
})

const mockedStatSync = vi.mocked(fs.statSync)

const isWindows = process.platform === 'win32'

/**
 * Build platform-appropriate test data.
 * On Unix: path=/Users/nick, encoded=-Users-nick
 * On Windows: path=C:\Users\nick, encoded=C--Users-nick
 */
function p(...segments: string[]): string {
  if (isWindows) {
    return 'C:\\' + segments.join('\\')
  }
  return '/' + segments.join('/')
}

function encode(...segments: string[]): string {
  // Claude project encoding: replace path separators with dashes
  if (isWindows) {
    return 'C--' + segments.join('-')
  }
  return '-' + segments.join('-')
}

/** Build the mock for statSync that accepts a list of existing directories */
function mockExistingDirs(dirs: string[]) {
  mockedStatSync.mockImplementation((pathArg: fs.PathLike) => {
    const pathStr = path.normalize(pathArg.toString())
    if (dirs.some((d) => path.normalize(d) === pathStr)) {
      return { isDirectory: () => true } as fs.Stats
    }
    throw new Error('ENOENT')
  })
}

describe('ProjectDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resolvePath', () => {
    it('resolves a simple path with no ambiguity', () => {
      mockExistingDirs([p('Users'), p('Users', 'nick'), p('Users', 'nick', 'project')])

      const result = resolvePath(encode('Users', 'nick', 'project'))
      expect(result).toBe(p('Users', 'nick', 'project'))
    })

    it('resolves a path with dashes in directory names', () => {
      mockExistingDirs([
        p('Users'),
        p('Users', 'nick'),
        p('Users', 'nick', 'my-project'),
      ])

      const result = resolvePath(encode('Users', 'nick', 'my-project'))
      expect(result).toBe(p('Users', 'nick', 'my-project'))
    })

    it('resolves a path with dots in directory names', () => {
      // Encoded: double dash represents a dot
      mockExistingDirs([p('Users'), p('Users', 'nick'), p('Users', 'nick', '.config')])

      // On Unix: -Users-nick--config (-- = .)
      // On Windows: C--Users-nick--config (-- = .)
      const encoded = isWindows ? 'C--Users-nick--config' : '-Users-nick--config'
      const result = resolvePath(encoded)
      expect(result).toBe(p('Users', 'nick', '.config'))
    })

    it('resolves a path with spaces in directory names', () => {
      // Ambiguous with dashes — filesystem determines which wins
      mockExistingDirs([p('Users'), p('Users', 'nick'), p('Users', 'nick', 'my project')])

      const result = resolvePath(encode('Users', 'nick', 'my-project'))
      expect(result).toBe(p('Users', 'nick', 'my project'))
    })

    it('returns null for invalid encoded paths', () => {
      if (isWindows) {
        // On Windows, bare `-` is invalid (no drive letter)
        expect(resolvePath('-')).toBeNull()
      } else {
        // On Unix, bare `-` has no path segments after the root
        expect(resolvePath('-')).toBeNull()
      }
    })

    it('returns null when no valid path can be resolved', () => {
      mockedStatSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const encoded = isWindows ? 'C--nonexistent-path-here' : '-nonexistent-path-here'
      const result = resolvePath(encoded)
      expect(result).toBeNull()
    })

    it('returns null for strings that do not match encoding format', () => {
      const result = resolvePath('Users-nick-project')
      expect(result).toBeNull()
    })

    it('handles deep nested paths', () => {
      mockExistingDirs([
        p('Users'),
        p('Users', 'nick'),
        p('Users', 'nick', 'Documents'),
        p('Users', 'nick', 'Documents', 'projects'),
        p('Users', 'nick', 'Documents', 'projects', 'my-app'),
      ])

      const result = resolvePath(encode('Users', 'nick', 'Documents', 'projects', 'my-app'))
      expect(result).toBe(p('Users', 'nick', 'Documents', 'projects', 'my-app'))
    })

    it('respects timeout on complex encodings', () => {
      mockedStatSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const start = Date.now()
      const encoded = isWindows
        ? 'C--a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t-u-v-w-x-y-z'
        : '-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t-u-v-w-x-y-z'
      const result = resolvePath(encoded, 50)
      const elapsed = Date.now() - start

      expect(result).toBeNull()
      expect(elapsed).toBeLessThan(200)
    })

    it('resolves real-world Claude project encoding pattern', () => {
      mockExistingDirs([
        p('Users'),
        p('Users', 'nicknorris'),
        p('Users', 'nicknorris', 'Documents'),
        p('Users', 'nicknorris', 'Documents', 'claude-code-projects'),
        p('Users', 'nicknorris', 'Documents', 'claude-code-projects', 'claude-context-tool'),
      ])

      const result = resolvePath(
        encode('Users', 'nicknorris', 'Documents', 'claude-code-projects', 'claude-context-tool')
      )
      expect(result).toBe(
        p('Users', 'nicknorris', 'Documents', 'claude-code-projects', 'claude-context-tool')
      )
    })
  })
})
