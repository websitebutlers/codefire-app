import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock node-pty ────────────────────────────────────────────────────────────

const mockPty = vi.hoisted(() => {
  const createMockIPty = () => ({
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    pid: 12345,
    cols: 80,
    rows: 24,
    process: '/bin/zsh',
  })

  return {
    spawn: vi.fn(() => createMockIPty()),
    createMockIPty,
  }
})

vi.mock('node-pty', () => ({
  default: mockPty,
  spawn: mockPty.spawn,
}))

import { TerminalService } from '../../main/services/TerminalService'

describe('TerminalService', () => {
  let service: TerminalService

  beforeEach(() => {
    service = new TerminalService()
    vi.clearAllMocks()
  })

  // ─── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a PTY session and stores it', () => {
      service.create('test-1', '/tmp/project')

      expect(mockPty.spawn).toHaveBeenCalledOnce()
      expect(mockPty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: '/tmp/project',
        })
      )
      expect(service.has('test-1')).toBe(true)
    })

    it('does not create duplicate sessions for the same id', () => {
      service.create('test-1', '/tmp/project')
      service.create('test-1', '/tmp/project')

      expect(mockPty.spawn).toHaveBeenCalledOnce()
    })

    it('creates separate sessions for different ids', () => {
      service.create('test-1', '/tmp/project1')
      service.create('test-2', '/tmp/project2')

      expect(mockPty.spawn).toHaveBeenCalledTimes(2)
      expect(service.has('test-1')).toBe(true)
      expect(service.has('test-2')).toBe(true)
    })

    it('sets TERM environment variable', () => {
      service.create('test-1', '/tmp/project')

      const spawnCall = mockPty.spawn.mock.calls[0] as unknown[]
      const options = spawnCall[2] as { env: Record<string, string> }
      expect(options.env.TERM).toBe('xterm-256color')
    })
  })

  // ─── write ──────────────────────────────────────────────────────────────

  describe('write', () => {
    it('writes data to the PTY', () => {
      service.create('test-1', '/tmp/project')
      const ptyInstance = mockPty.spawn.mock.results[0].value

      service.write('test-1', 'ls -la\r')

      expect(ptyInstance.write).toHaveBeenCalledWith('ls -la\r')
    })

    it('does nothing for nonexistent session', () => {
      // Should not throw
      expect(() => service.write('nonexistent', 'data')).not.toThrow()
    })
  })

  // ─── resize ─────────────────────────────────────────────────────────────

  describe('resize', () => {
    it('resizes the PTY', () => {
      service.create('test-1', '/tmp/project')
      const ptyInstance = mockPty.spawn.mock.results[0].value

      service.resize('test-1', 120, 40)

      expect(ptyInstance.resize).toHaveBeenCalledWith(120, 40)
    })

    it('does nothing for nonexistent session', () => {
      expect(() => service.resize('nonexistent', 80, 24)).not.toThrow()
    })
  })

  // ─── onData ─────────────────────────────────────────────────────────────

  describe('onData', () => {
    it('registers a data callback on the PTY', () => {
      service.create('test-1', '/tmp/project')
      const ptyInstance = mockPty.spawn.mock.results[0].value
      const callback = vi.fn()

      service.onData('test-1', callback)

      expect(ptyInstance.onData).toHaveBeenCalledWith(callback)
    })

    it('does nothing for nonexistent session', () => {
      expect(() => service.onData('nonexistent', vi.fn())).not.toThrow()
    })
  })

  // ─── onExit ─────────────────────────────────────────────────────────────

  describe('onExit', () => {
    it('registers an exit callback on the PTY', () => {
      service.create('test-1', '/tmp/project')
      const ptyInstance = mockPty.spawn.mock.results[0].value
      const callback = vi.fn()

      service.onExit('test-1', callback)

      expect(ptyInstance.onExit).toHaveBeenCalledOnce()

      // Simulate PTY exit by calling the registered handler
      const registeredHandler = ptyInstance.onExit.mock.calls[0][0]
      registeredHandler({ exitCode: 0, signal: 15 })

      expect(callback).toHaveBeenCalledWith(0, 15)
    })

    it('does nothing for nonexistent session', () => {
      expect(() => service.onExit('nonexistent', vi.fn())).not.toThrow()
    })
  })

  // ─── kill ───────────────────────────────────────────────────────────────

  describe('kill', () => {
    it('kills the PTY and removes it from the map', () => {
      service.create('test-1', '/tmp/project')
      const ptyInstance = mockPty.spawn.mock.results[0].value

      service.kill('test-1')

      expect(ptyInstance.kill).toHaveBeenCalledOnce()
      expect(service.has('test-1')).toBe(false)
    })

    it('does nothing for nonexistent session', () => {
      expect(() => service.kill('nonexistent')).not.toThrow()
    })
  })

  // ─── killAll ────────────────────────────────────────────────────────────

  describe('killAll', () => {
    it('kills all sessions and clears the map', () => {
      service.create('test-1', '/tmp/project1')
      service.create('test-2', '/tmp/project2')
      service.create('test-3', '/tmp/project3')

      const pty1 = mockPty.spawn.mock.results[0].value
      const pty2 = mockPty.spawn.mock.results[1].value
      const pty3 = mockPty.spawn.mock.results[2].value

      service.killAll()

      expect(pty1.kill).toHaveBeenCalledOnce()
      expect(pty2.kill).toHaveBeenCalledOnce()
      expect(pty3.kill).toHaveBeenCalledOnce()
      expect(service.has('test-1')).toBe(false)
      expect(service.has('test-2')).toBe(false)
      expect(service.has('test-3')).toBe(false)
    })

    it('handles empty service gracefully', () => {
      expect(() => service.killAll()).not.toThrow()
    })
  })

  // ─── has ────────────────────────────────────────────────────────────────

  describe('has', () => {
    it('returns true for existing session', () => {
      service.create('test-1', '/tmp/project')
      expect(service.has('test-1')).toBe(true)
    })

    it('returns false for nonexistent session', () => {
      expect(service.has('nonexistent')).toBe(false)
    })

    it('returns false after killing a session', () => {
      service.create('test-1', '/tmp/project')
      service.kill('test-1')
      expect(service.has('test-1')).toBe(false)
    })
  })
})
