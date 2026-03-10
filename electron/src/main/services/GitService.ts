import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string
  files: GitStatusFile[]
  isClean: boolean
}

export interface GitStatusFile {
  status: string // 'M', 'A', 'D', '??', 'R', etc.
  path: string
}

export interface GitLogEntry {
  hash: string
  author: string
  email: string
  date: string // ISO format
  subject: string
  body: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GIT_TIMEOUT_MS = 30_000
const LOG_ENTRY_SEPARATOR = '---END---'

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Shells out to the `git` CLI for all git operations.
 *
 * Every method takes a `projectPath` as its first argument, which is
 * passed as `git -C <path>` to set the working directory.
 */
export class GitService {
  /**
   * Execute a git command in the given project directory.
   * Captures both stdout and stderr. Times out after 30 seconds.
   */
  private async exec(
    projectPath: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync('git', ['-C', projectPath, ...args], {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      })
      return { stdout: result.stdout, stderr: result.stderr }
    } catch (error: unknown) {
      const execError = error as {
        code?: string | number
        stderr?: string
        message?: string
        killed?: boolean
      }

      // Timeout
      if (execError.killed) {
        throw new Error(`Git command timed out after ${GIT_TIMEOUT_MS}ms`)
      }

      // git not installed (ENOENT means the executable wasn't found)
      if (execError.code === 'ENOENT') {
        throw new Error(
          'Git is not installed or not found in PATH. Please install git and try again.'
        )
      }

      // Not a git repository or other git errors
      const stderr = execError.stderr || execError.message || 'Unknown git error'
      if (stderr.includes('not a git repository')) {
        throw new Error(
          `"${projectPath}" is not a git repository. Initialize one with "git init".`
        )
      }

      throw new Error(`Git error: ${stderr}`)
    }
  }

  // ─── status ──────────────────────────────────────────────────────────────

  /**
   * Get the current git status.
   *
   * Runs: `git -C <path> status --porcelain=v1 -b`
   */
  async status(projectPath: string): Promise<GitStatus> {
    const { stdout } = await this.exec(projectPath, [
      'status',
      '--porcelain=v1',
      '-b',
    ])

    const lines = stdout.split('\n').filter((l) => l.length > 0)
    let branch = ''
    const files: GitStatusFile[] = []

    for (const line of lines) {
      if (line.startsWith('## ')) {
        // Branch line: "## main...origin/main" or "## main" or "## No commits yet on main"
        const branchPart = line.slice(3)
        if (branchPart.startsWith('No commits yet on ')) {
          branch = branchPart.replace('No commits yet on ', '')
        } else {
          // Strip tracking info after "..."
          const dotIdx = branchPart.indexOf('...')
          branch = dotIdx >= 0 ? branchPart.slice(0, dotIdx) : branchPart
        }
      } else {
        // File status line: "XY path" where XY is two characters
        const statusCode = line.slice(0, 2).trim()
        const filePath = line.slice(3)
        if (statusCode && filePath) {
          files.push({ status: statusCode, path: filePath })
        }
      }
    }

    return { branch, files, isClean: files.length === 0 }
  }

  // ─── diff ────────────────────────────────────────────────────────────────

  /**
   * Get the diff output.
   *
   * Runs: `git -C <path> diff [--staged] [-- file]`
   */
  async diff(
    projectPath: string,
    options?: { staged?: boolean; file?: string }
  ): Promise<string> {
    const args = ['diff']
    if (options?.staged) {
      args.push('--staged')
    }
    if (options?.file) {
      args.push('--', options.file)
    }

    const { stdout } = await this.exec(projectPath, args)
    return stdout
  }

  // ─── log ─────────────────────────────────────────────────────────────────

  /**
   * Get the commit log.
   *
   * Runs: `git -C <path> log --pretty=format:'...' [-n limit] [-- file]`
   */
  async log(
    projectPath: string,
    options?: { limit?: number; file?: string }
  ): Promise<GitLogEntry[]> {
    const format = `%H%n%an%n%ae%n%at%n%s%n%b${LOG_ENTRY_SEPARATOR}`
    const args = ['log', `--pretty=format:${format}`]

    if (options?.limit && options.limit > 0) {
      args.push(`-n`, String(options.limit))
    }
    if (options?.file) {
      args.push('--', options.file)
    }

    const { stdout } = await this.exec(projectPath, args)
    if (!stdout.trim()) {
      return []
    }

    return this.parseLogOutput(stdout)
  }

  /**
   * Parse the formatted git log output into structured entries.
   */
  private parseLogOutput(output: string): GitLogEntry[] {
    const entries: GitLogEntry[] = []
    const rawEntries = output.split(LOG_ENTRY_SEPARATOR).filter((e) => e.trim())

    for (const raw of rawEntries) {
      const lines = raw.split('\n')
      // Skip leading empty lines
      const start = lines.findIndex((l) => l.length > 0)
      if (start < 0) continue

      const meaningful = lines.slice(start)
      if (meaningful.length < 5) continue

      const hash = meaningful[0]
      const author = meaningful[1]
      const email = meaningful[2]
      const timestamp = meaningful[3]
      const subject = meaningful[4]
      // Body is everything after the subject, joined and trimmed
      const body = meaningful.slice(5).join('\n').trim()

      // Convert unix timestamp to ISO string
      const date = new Date(parseInt(timestamp, 10) * 1000).toISOString()

      entries.push({ hash, author, email, date, subject, body })
    }

    return entries
  }

  // ─── stage ───────────────────────────────────────────────────────────────

  /**
   * Stage files for commit.
   *
   * Runs: `git -C <path> add <files...>`
   */
  async stage(projectPath: string, files: string[]): Promise<void> {
    if (files.length === 0) {
      throw new Error('No files specified to stage')
    }
    await this.exec(projectPath, ['add', ...files])
  }

  // ─── unstage ─────────────────────────────────────────────────────────────

  /**
   * Unstage files (remove from the index but keep working tree changes).
   *
   * Runs: `git -C <path> reset HEAD -- <files...>`
   */
  async unstage(projectPath: string, files: string[]): Promise<void> {
    if (files.length === 0) {
      throw new Error('No files specified to unstage')
    }
    await this.exec(projectPath, ['reset', 'HEAD', '--', ...files])
  }

  // ─── discard ─────────────────────────────────────────────────────────────

  /**
   * Discard working tree changes for tracked files, or remove untracked files.
   *
   * For tracked files: `git -C <path> checkout -- <files...>`
   * For untracked files: `git -C <path> clean -f -- <files...>`
   */
  async discard(
    projectPath: string,
    files: string[],
    untracked: boolean = false
  ): Promise<void> {
    if (files.length === 0) {
      throw new Error('No files specified to discard')
    }
    if (untracked) {
      await this.exec(projectPath, ['clean', '-f', '--', ...files])
    } else {
      await this.exec(projectPath, ['checkout', '--', ...files])
    }
  }

  // ─── commit ──────────────────────────────────────────────────────────────

  /**
   * Create a commit with the given message.
   *
   * Runs: `git -C <path> commit -m <message>`
   * Returns the commit hash from the output.
   */
  async commit(
    projectPath: string,
    message: string
  ): Promise<{ hash: string }> {
    if (!message || !message.trim()) {
      throw new Error('Commit message cannot be empty')
    }

    const { stdout } = await this.exec(projectPath, ['commit', '-m', message])

    // Parse commit hash from output like "[main abc1234] commit message"
    const match = stdout.match(/\[.+\s+([a-f0-9]+)\]/)
    const hash = match ? match[1] : ''

    return { hash }
  }
}
