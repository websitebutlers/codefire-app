import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock child_process.execFile ─────────────────────────────────────────────

const mockExecFile = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    default: { ...actual, execFile: mockExecFile },
    execFile: mockExecFile,
  }
})

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    default: { ...actual, execFile: mockExecFile },
    execFile: mockExecFile,
  }
})

import { GitService } from '../../main/services/GitService'

/**
 * Helper: make mockExecFile resolve with stdout/stderr.
 * node's execFile with callback signature: (cmd, args, opts, callback)
 */
function mockGitOutput(stdout: string, stderr = '') {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      callback: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, { stdout, stderr })
    }
  )
}

/**
 * Helper: make mockExecFile reject with an error.
 */
function mockGitError(
  message: string,
  extras: { code?: string | number; stderr?: string; killed?: boolean } = {}
) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      callback: (err: unknown) => void
    ) => {
      const err = Object.assign(new Error(message), extras)
      callback(err)
    }
  )
}

describe('GitService', () => {
  let git: GitService

  beforeEach(() => {
    git = new GitService()
    vi.clearAllMocks()
  })

  // ─── status ──────────────────────────────────────────────────────────────

  describe('status', () => {
    it('parses branch and file statuses from porcelain output', async () => {
      mockGitOutput(
        '## main...origin/main\n' +
          ' M src/app.ts\n' +
          '?? newfile.txt\n' +
          'A  staged.ts\n'
      )

      const result = await git.status('/tmp/project')

      expect(result.branch).toBe('main')
      expect(result.isClean).toBe(false)
      expect(result.files).toEqual([
        { status: 'M', path: 'src/app.ts' },
        { status: '??', path: 'newfile.txt' },
        { status: 'A', path: 'staged.ts' },
      ])

      // Verify the correct git args
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'status', '--porcelain=v1', '-b'],
        expect.objectContaining({ timeout: 30_000 }),
        expect.any(Function)
      )
    })

    it('handles a clean repo with no modified files', async () => {
      mockGitOutput('## develop...origin/develop\n')

      const result = await git.status('/tmp/project')

      expect(result.branch).toBe('develop')
      expect(result.isClean).toBe(true)
      expect(result.files).toEqual([])
    })

    it('handles branch without tracking info', async () => {
      mockGitOutput('## feature/new-thing\n M file.ts\n')

      const result = await git.status('/tmp/project')

      expect(result.branch).toBe('feature/new-thing')
      expect(result.files).toHaveLength(1)
    })

    it('handles "No commits yet" branch', async () => {
      mockGitOutput('## No commits yet on main\n?? README.md\n')

      const result = await git.status('/tmp/project')

      expect(result.branch).toBe('main')
      expect(result.files).toEqual([{ status: '??', path: 'README.md' }])
    })

    it('handles empty output', async () => {
      mockGitOutput('')

      const result = await git.status('/tmp/project')

      expect(result.branch).toBe('')
      expect(result.isClean).toBe(true)
      expect(result.files).toEqual([])
    })
  })

  // ─── diff ────────────────────────────────────────────────────────────────

  describe('diff', () => {
    it('returns raw diff output', async () => {
      const diffOutput =
        'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n'
      mockGitOutput(diffOutput)

      const result = await git.diff('/tmp/project')

      expect(result).toBe(diffOutput)
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'diff'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('passes --staged flag when requested', async () => {
      mockGitOutput('')

      await git.diff('/tmp/project', { staged: true })

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'diff', '--staged'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('passes file argument when specified', async () => {
      mockGitOutput('')

      await git.diff('/tmp/project', { file: 'src/main.ts' })

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'diff', '--', 'src/main.ts'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('passes both --staged and file arguments', async () => {
      mockGitOutput('')

      await git.diff('/tmp/project', { staged: true, file: 'app.ts' })

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'diff', '--staged', '--', 'app.ts'],
        expect.any(Object),
        expect.any(Function)
      )
    })
  })

  // ─── log ─────────────────────────────────────────────────────────────────

  describe('log', () => {
    it('parses formatted log output into structured entries', async () => {
      const logOutput =
        'abc1234567890def1234567890abc1234567890de\n' +
        'John Doe\n' +
        'john@example.com\n' +
        '1700000000\n' +
        'feat: add new feature\n' +
        'This is the body of the commit.\n' +
        '---END---'

      mockGitOutput(logOutput)

      const result = await git.log('/tmp/project')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hash: 'abc1234567890def1234567890abc1234567890de',
        author: 'John Doe',
        email: 'john@example.com',
        date: new Date(1700000000 * 1000).toISOString(),
        subject: 'feat: add new feature',
        body: 'This is the body of the commit.',
      })
    })

    it('parses multiple log entries', async () => {
      const logOutput =
        'aaa111\nAlice\nalice@test.com\n1700000000\nfirst commit\n\n---END---\n' +
        'bbb222\nBob\nbob@test.com\n1700001000\nsecond commit\nwith body\n---END---'

      mockGitOutput(logOutput)

      const result = await git.log('/tmp/project')

      expect(result).toHaveLength(2)
      expect(result[0].hash).toBe('aaa111')
      expect(result[0].subject).toBe('first commit')
      expect(result[0].body).toBe('')
      expect(result[1].hash).toBe('bbb222')
      expect(result[1].subject).toBe('second commit')
      expect(result[1].body).toBe('with body')
    })

    it('handles empty log output', async () => {
      mockGitOutput('')

      const result = await git.log('/tmp/project')

      expect(result).toEqual([])
    })

    it('passes limit option', async () => {
      mockGitOutput('')

      await git.log('/tmp/project', { limit: 10 })

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['-n', '10']),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('passes file option', async () => {
      mockGitOutput('')

      await git.log('/tmp/project', { file: 'src/index.ts' })

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--', 'src/index.ts']),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('handles commit with no body', async () => {
      const logOutput =
        'abc123\nJane\njane@test.com\n1700000000\nquick fix\n---END---'

      mockGitOutput(logOutput)

      const result = await git.log('/tmp/project')

      expect(result).toHaveLength(1)
      expect(result[0].body).toBe('')
    })
  })

  // ─── stage ───────────────────────────────────────────────────────────────

  describe('stage', () => {
    it('calls git add with the specified files', async () => {
      mockGitOutput('')

      await git.stage('/tmp/project', ['file1.ts', 'file2.ts'])

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'add', 'file1.ts', 'file2.ts'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('throws when no files specified', async () => {
      await expect(git.stage('/tmp/project', [])).rejects.toThrow(
        'No files specified to stage'
      )
    })
  })

  // ─── unstage ─────────────────────────────────────────────────────────────

  describe('unstage', () => {
    it('calls git reset HEAD with the specified files', async () => {
      mockGitOutput('')

      await git.unstage('/tmp/project', ['file1.ts', 'file2.ts'])

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'reset', 'HEAD', '--', 'file1.ts', 'file2.ts'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('throws when no files specified', async () => {
      await expect(git.unstage('/tmp/project', [])).rejects.toThrow(
        'No files specified to unstage'
      )
    })
  })

  // ─── commit ──────────────────────────────────────────────────────────────

  describe('commit', () => {
    it('creates a commit and returns the hash', async () => {
      mockGitOutput('[main abc1234] feat: add new feature\n 1 file changed\n')

      const result = await git.commit('/tmp/project', 'feat: add new feature')

      expect(result.hash).toBe('abc1234')
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'commit', '-m', 'feat: add new feature'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('handles commit output with long hash', async () => {
      mockGitOutput(
        '[feature/test abcdef1234567890] fix: resolve issue\n 2 files changed\n'
      )

      const result = await git.commit('/tmp/project', 'fix: resolve issue')

      expect(result.hash).toBe('abcdef1234567890')
    })

    it('returns empty hash when output cannot be parsed', async () => {
      mockGitOutput('Unexpected output format\n')

      const result = await git.commit('/tmp/project', 'some message')

      expect(result.hash).toBe('')
    })

    it('throws when message is empty', async () => {
      await expect(git.commit('/tmp/project', '')).rejects.toThrow(
        'Commit message cannot be empty'
      )
    })

    it('throws when message is whitespace only', async () => {
      await expect(git.commit('/tmp/project', '   ')).rejects.toThrow(
        'Commit message cannot be empty'
      )
    })
  })

  // ─── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws descriptive error when git is not installed', async () => {
      mockGitError('spawn git ENOENT', { code: 'ENOENT' })

      await expect(git.status('/tmp/project')).rejects.toThrow(
        'Git is not installed or not found in PATH'
      )
    })

    it('throws descriptive error for non-git directories', async () => {
      mockGitError('git error', {
        stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      })

      await expect(git.status('/tmp/not-a-repo')).rejects.toThrow(
        'is not a git repository'
      )
    })

    it('throws timeout error when command takes too long', async () => {
      mockGitError('Command timed out', { killed: true })

      await expect(git.status('/tmp/project')).rejects.toThrow(
        'Git command timed out'
      )
    })

    it('passes through other git errors', async () => {
      mockGitError('git error', {
        stderr: 'fatal: ambiguous argument',
      })

      await expect(git.diff('/tmp/project')).rejects.toThrow(
        'Git error: fatal: ambiguous argument'
      )
    })
  })
})
