import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock Electron ────────────────────────────────────────────────────────────

const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockOnHandlers = new Map<string, (...args: unknown[]) => void>()
const mockWebContentsSend = vi.fn()
const mockBrowserWindow = {
  isDestroyed: vi.fn(() => false),
  webContents: { send: mockWebContentsSend },
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      mockOnHandlers.set(channel, handler)
    }),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => mockBrowserWindow),
  },
}))

// ─── Mock TerminalService ─────────────────────────────────────────────────────

const mockTerminalService = {
  create: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  killAll: vi.fn(),
  has: vi.fn(),
  onData: vi.fn(),
  onExit: vi.fn(),
}

import { registerTerminalHandlers } from '../../main/ipc/terminal-handlers'

describe('terminal-handlers', () => {
  beforeEach(() => {
    mockHandlers.clear()
    mockOnHandlers.clear()
    vi.clearAllMocks()

    registerTerminalHandlers(mockTerminalService as any)
  })

  // ─── Registration ───────────────────────────────────────────────────────

  describe('registration', () => {
    it('registers handle channels for create and kill', () => {
      expect(mockHandlers.has('terminal:create')).toBe(true)
      expect(mockHandlers.has('terminal:kill')).toBe(true)
    })

    it('registers on channels for write and resize', () => {
      expect(mockOnHandlers.has('terminal:write')).toBe(true)
      expect(mockOnHandlers.has('terminal:resize')).toBe(true)
    })
  })

  // ─── terminal:create ────────────────────────────────────────────────────

  describe('terminal:create', () => {
    it('creates a terminal and wires up data/exit handlers', async () => {
      const handler = mockHandlers.get('terminal:create')!
      const mockEvent = { sender: {} }

      const result = await handler(mockEvent, 'term-1', '/tmp/project')

      expect(mockTerminalService.create).toHaveBeenCalledWith('term-1', '/tmp/project')
      expect(mockTerminalService.onData).toHaveBeenCalledWith('term-1', expect.any(Function))
      expect(mockTerminalService.onExit).toHaveBeenCalledWith('term-1', expect.any(Function))
      expect(result).toEqual({ id: 'term-1' })
    })

    it('throws if id is missing', () => {
      const handler = mockHandlers.get('terminal:create')!
      const mockEvent = { sender: {} }

      expect(() => handler(mockEvent, '', '/tmp/project')).toThrow(
        'Terminal id is required'
      )
    })

    it('throws if projectPath is missing', () => {
      const handler = mockHandlers.get('terminal:create')!
      const mockEvent = { sender: {} }

      expect(() => handler(mockEvent, 'term-1', '')).toThrow(
        'projectPath is required'
      )
    })

    it('forwards PTY data to the renderer window', async () => {
      const handler = mockHandlers.get('terminal:create')!
      const mockEvent = { sender: {} }

      await handler(mockEvent, 'term-1', '/tmp/project')

      // Get the data callback that was registered
      const dataCallback = mockTerminalService.onData.mock.calls[0][1]
      dataCallback('hello output')

      expect(mockWebContentsSend).toHaveBeenCalledWith('terminal:data', 'term-1', 'hello output')
    })

    it('forwards PTY exit to the renderer window', async () => {
      const handler = mockHandlers.get('terminal:create')!
      const mockEvent = { sender: {} }

      await handler(mockEvent, 'term-1', '/tmp/project')

      // Get the exit callback that was registered
      const exitCallback = mockTerminalService.onExit.mock.calls[0][1]
      exitCallback(0, 15)

      expect(mockWebContentsSend).toHaveBeenCalledWith('terminal:exit', 'term-1', 0, 15)
      // Should also clean up
      expect(mockTerminalService.kill).toHaveBeenCalledWith('term-1')
    })

    it('does not send to destroyed window', async () => {
      mockBrowserWindow.isDestroyed.mockReturnValueOnce(true)

      const handler = mockHandlers.get('terminal:create')!
      const mockEvent = { sender: {} }

      await handler(mockEvent, 'term-1', '/tmp/project')

      const dataCallback = mockTerminalService.onData.mock.calls[0][1]
      dataCallback('hello')

      // Should not send because window is destroyed
      expect(mockWebContentsSend).not.toHaveBeenCalled()
    })
  })

  // ─── terminal:kill ──────────────────────────────────────────────────────

  describe('terminal:kill', () => {
    it('kills the terminal session', async () => {
      const handler = mockHandlers.get('terminal:kill')!
      const mockEvent = {}

      const result = await handler(mockEvent, 'term-1')

      expect(mockTerminalService.kill).toHaveBeenCalledWith('term-1')
      expect(result).toEqual({ success: true })
    })

    it('throws if id is missing', () => {
      const handler = mockHandlers.get('terminal:kill')!
      const mockEvent = {}

      expect(() => handler(mockEvent, '')).toThrow('Terminal id is required')
    })
  })

  // ─── terminal:write ─────────────────────────────────────────────────────

  describe('terminal:write', () => {
    it('writes data to the terminal', () => {
      const handler = mockOnHandlers.get('terminal:write')!
      const mockEvent = {}

      handler(mockEvent, 'term-1', 'ls -la\r')

      expect(mockTerminalService.write).toHaveBeenCalledWith('term-1', 'ls -la\r')
    })
  })

  // ─── terminal:resize ───────────────────────────────────────────────────

  describe('terminal:resize', () => {
    it('resizes the terminal', () => {
      const handler = mockOnHandlers.get('terminal:resize')!
      const mockEvent = {}

      handler(mockEvent, 'term-1', 120, 40)

      expect(mockTerminalService.resize).toHaveBeenCalledWith('term-1', 120, 40)
    })
  })
})
