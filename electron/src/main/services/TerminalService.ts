import * as pty from 'node-pty'

interface TerminalSession {
  id: string
  pty: pty.IPty
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
   * Create a new PTY session.
   *
   * @param id - Unique identifier for this terminal (e.g. `${projectId}-${tabIndex}`)
   * @param projectPath - Working directory for the shell
   */
  create(id: string, projectPath: string): void {
    // Don't create duplicate sessions
    if (this.sessions.has(id)) {
      return
    }

    const shell =
      process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/zsh'

    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: projectPath,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
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
}
