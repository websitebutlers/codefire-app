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

    // Don't create duplicate sessions
    if (this.sessions.has(id)) {
      return
    }

    const shell =
      process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/zsh'

    // Clean environment: remove vars that make Claude Code think it's nested
    const cleanEnv = { ...process.env } as Record<string, string>
    delete cleanEnv.ELECTRON_RUN_AS_NODE
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT
    delete cleanEnv.CLAUDE_SPAWNED
    delete cleanEnv.CLAUDECODE
    cleanEnv.TERM = 'xterm-256color'

    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: projectPath,
      env: cleanEnv,
    })

    this.sessions.set(id, { id, pty: term, projectPath })
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
    this.sessions.get(id)?.pty.resize(cols, rows)
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
   * Get all active session IDs.
   */
  getActiveIds(): string[] {
    return Array.from(this.sessions.keys())
  }
}
