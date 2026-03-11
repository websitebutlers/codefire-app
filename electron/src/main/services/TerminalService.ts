import type * as ptyType from 'node-pty'

let pty: typeof ptyType | null = null
try {
  pty = require('node-pty')
} catch {
  // node-pty not available — terminal features will be disabled
}

interface TerminalSession {
  id: string
  pty: ptyType.IPty
  projectPath: string
  listenersRegistered: boolean
  generation: number
}

/**
 * Manages PTY (pseudo-terminal) sessions for project windows.
 *
 * Each terminal tab in a project window gets its own PTY session,
 * spawned with the user's default shell and the project's working directory.
 */
export class TerminalService {
  private sessions = new Map<string, TerminalSession>()

  /**
   * Whether the terminal backend (node-pty) is available.
   * Returns false if native build tools were not present at install time.
   */
  isAvailable(): boolean {
    return pty !== null && typeof pty.spawn === 'function'
  }

  /**
   * Create a new PTY session.
   *
   * @param id - Unique identifier for this terminal (e.g. `${projectId}-${tabIndex}`)
   * @param projectPath - Working directory for the shell
   */
  create(id: string, projectPath: string): void {
    if (!this.isAvailable()) {
      throw new Error('Terminal is not available — node-pty failed to load. Install system build tools and reinstall.')
    }

    // If a session already exists for this ID (e.g. restart after exit),
    // kill the old PTY before creating a fresh one
    if (this.sessions.has(id)) {
      this.kill(id)
    }

    const isWindows = process.platform === 'win32'
    const shell = isWindows
      ? 'powershell.exe'
      : process.env.SHELL || '/bin/zsh'

    // Spawn as login shell on macOS/Linux (matches Terminal.app / iTerm2 / Swift build).
    // Login shells source .zprofile/.zlogin, which sets up PATH, history, etc.
    // Without this, packaged .app bundles get a minimal env where zsh history
    // and other features break (e.g. up-arrow blanks the terminal).
    const shellArgs = isWindows ? [] : ['-l']

    // Clean environment: remove vars that make Claude Code think it's nested
    const cleanEnv = { ...process.env } as Record<string, string>
    delete cleanEnv.ELECTRON_RUN_AS_NODE
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT
    delete cleanEnv.CLAUDE_SPAWNED
    delete cleanEnv.CLAUDECODE
    cleanEnv.TERM = 'xterm-256color'
    cleanEnv.COLORTERM = 'truecolor'

    // Ensure critical env vars are set — packaged .app launched from Finder
    // may have a minimal environment missing these
    if (!cleanEnv.HOME) {
      cleanEnv.HOME = require('os').homedir()
    }
    if (!cleanEnv.USER) {
      cleanEnv.USER = require('os').userInfo().username
    }
    if (!cleanEnv.LOGNAME) {
      cleanEnv.LOGNAME = cleanEnv.USER
    }
    if (!cleanEnv.SHELL) {
      cleanEnv.SHELL = shell
    }

    // Verify shell exists before attempting spawn
    const fs = require('fs')
    if (!isWindows && !fs.existsSync(shell)) {
      throw new Error(`Shell not found at "${shell}". Set SHELL env var to a valid shell path.`)
    }

    // Verify cwd exists — fallback to HOME if project dir is gone
    const actualCwd = fs.existsSync(projectPath) ? projectPath : (cleanEnv.HOME || '/')

    console.log(`[TERMINAL] Creating PTY: id=${id} shell=${shell} cwd=${actualCwd}`)

    const term = pty!.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: actualCwd,
      env: cleanEnv,
    })

    const prev = this.sessions.get(id)
    const generation = (prev?.generation ?? 0) + 1
    this.sessions.set(id, { id, pty: term, projectPath, listenersRegistered: false, generation })
  }

  /**
   * Write data (keystrokes) to the PTY.
   */
  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  /**
   * Resize the PTY to match the terminal panel dimensions.
   */
  resize(id: string, cols: number, rows: number): void {
    // Guard against invalid dimensions — xterm.js FitAddon can briefly
    // report 0 cols/rows during layout transitions (e.g. panel swap).
    // node-pty throws on non-positive values.
    const safeCols = Math.max(1, Math.min(Math.floor(cols) || 80, 65535))
    const safeRows = Math.max(1, Math.min(Math.floor(rows) || 24, 65535))
    this.sessions.get(id)?.pty.resize(safeCols, safeRows)
  }

  /**
   * Register a callback for data output from the PTY.
   */
  onData(id: string, callback: (data: string) => void): void {
    this.sessions.get(id)?.pty.onData(callback)
  }

  /**
   * Register a callback for when the PTY process exits.
   */
  onExit(id: string, callback: (exitCode: number, signal?: number) => void): void {
    this.sessions.get(id)?.pty.onExit(({ exitCode, signal }) =>
      callback(exitCode, signal)
    )
  }

  /**
   * Kill a PTY session and remove it from the map.
   */
  kill(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.kill()
      this.sessions.delete(id)
    }
  }

  /**
   * Kill all PTY sessions. Called on app quit.
   */
  killAll(): void {
    for (const session of this.sessions.values()) {
      session.pty.kill()
    }
    this.sessions.clear()
  }

  /**
   * Check if a session exists.
   */
  has(id: string): boolean {
    return this.sessions.has(id)
  }

  /**
   * Get session info (for reading projectPath on restart).
   */
  getSession(id: string): { projectPath: string; generation: number } | undefined {
    const session = this.sessions.get(id)
    return session ? { projectPath: session.projectPath, generation: session.generation } : undefined
  }

  /**
   * Mark listeners as registered for a session. Returns true if this is the
   * first time (i.e. listeners should be wired up), false if already done.
   */
  markListenersRegistered(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session || session.listenersRegistered) return false
    session.listenersRegistered = true
    return true
  }

  /**
   * Get all active session IDs.
   */
  getActiveIds(): string[] {
    return Array.from(this.sessions.keys())
  }
}
