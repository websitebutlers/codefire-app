import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Electron Mocks ─────────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock hoisting, so these variables are available
// in the mock factory.

const { mockWindowInstances, nextWindowId, MockBW } = vi.hoisted(() => {
  const mockWindowInstances: Array<Record<string, unknown>> = []
  const nextWindowId = { value: 1 }

  class MockBW {
    id: number
    _isDestroyed = false
    _listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    _options: Record<string, unknown>
    webContents = { openDevTools: vi.fn() }
    focus = vi.fn()
    show = vi.fn()
    close = vi.fn(function (this: MockBW) {
      this._isDestroyed = true
      const handlers = this._listeners.get('closed') || []
      handlers.forEach((h) => h())
    })
    getBounds = vi.fn(function (this: MockBW) {
      return {
        x: (this._options.x as number) ?? 100,
        y: (this._options.y as number) ?? 100,
        width: (this._options.width as number) ?? 1400,
        height: (this._options.height as number) ?? 900,
      }
    })
    loadURL = vi.fn()
    loadFile = vi.fn()

    constructor(options: Record<string, unknown> = {}) {
      this.id = nextWindowId.value++
      this._options = options
      mockWindowInstances.push(this as unknown as Record<string, unknown>)
    }

    isDestroyed() {
      return this._isDestroyed
    }
    isMaximized() {
      return false
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!this._listeners.has(event)) this._listeners.set(event, [])
      this._listeners.get(event)!.push(handler)
      return this
    }
    once(event: string, handler: (...args: unknown[]) => void) {
      if (event === 'ready-to-show') handler()
      return this.on(event, handler)
    }
    destroy() {
      this._isDestroyed = true
    }

    static getAllWindows = vi.fn(() =>
      mockWindowInstances.filter((w) => !(w as { _isDestroyed: boolean })._isDestroyed)
    )
  }

  return { mockWindowInstances, nextWindowId, MockBW }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  BrowserWindow: MockBW,
  nativeImage: {
    createFromPath: vi.fn(() => ({})),
  },
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
  },
}))

import { WindowManager } from '../../main/windows/WindowManager'
import { WindowStateStore } from '../../main/windows/WindowStateStore'

describe('WindowManager', () => {
  let stateStorePath: string
  let stateStore: WindowStateStore
  let manager: WindowManager

  beforeEach(() => {
    stateStorePath = path.join(
      os.tmpdir(),
      `test-wm-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
    stateStore = new WindowStateStore(stateStorePath)
    manager = new WindowManager(stateStore)
    mockWindowInstances.length = 0
    nextWindowId.value = 1

    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173'
  })

  afterEach(() => {
    WindowManager.resetInstance()
    try {
      fs.unlinkSync(stateStorePath)
    } catch {
      // ignore
    }
    delete process.env.VITE_DEV_SERVER_URL
  })

  // ─── Singleton ────────────────────────────────────────────────────────────

  describe('singleton', () => {
    it('returns the same instance', () => {
      const a = WindowManager.getInstance()
      const b = WindowManager.getInstance()
      expect(a).toBe(b)
    })

    it('resets on resetInstance', () => {
      const a = WindowManager.getInstance()
      WindowManager.resetInstance()
      const b = WindowManager.getInstance()
      expect(a).not.toBe(b)
    })
  })

  // ─── Main Window ──────────────────────────────────────────────────────────

  describe('main window', () => {
    it('creates a main window', () => {
      const win = manager.createMainWindow()
      expect(win).toBeDefined()
      expect(win.id).toBe(1)
    })

    it('returns existing main window on second call', () => {
      const win1 = manager.createMainWindow()
      const win2 = manager.createMainWindow()
      expect(win1.id).toBe(win2.id)
      expect(win1.focus).toHaveBeenCalled()
    })

    it('getMainWindow returns null initially', () => {
      expect(manager.getMainWindow()).toBeNull()
    })

    it('getMainWindow returns the window after creation', () => {
      manager.createMainWindow()
      expect(manager.getMainWindow()).toBeDefined()
    })

    it('getMainWindow returns null after window is destroyed', () => {
      const win = manager.createMainWindow()
      const mockWin = mockWindowInstances.find(
        (w) => (w as { id: number }).id === win.id
      ) as unknown as InstanceType<typeof MockBW>
      mockWin.destroy()
      expect(manager.getMainWindow()).toBeNull()
    })

    it('loads URL in dev mode', () => {
      const win = manager.createMainWindow()
      expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    })

    it('loads file in production mode', () => {
      delete process.env.VITE_DEV_SERVER_URL
      process.env.DIST = '/app/dist'
      const win = manager.createMainWindow()
      expect(win.loadFile).toHaveBeenCalled()
      delete process.env.DIST
    })
  })

  // ─── Project Windows ──────────────────────────────────────────────────────

  describe('project windows', () => {
    it('creates a project window', () => {
      const win = manager.createProjectWindow('project-1')
      expect(win).toBeDefined()
      expect(win.id).toBeGreaterThan(0)
    })

    it('passes projectId via query string in dev mode', () => {
      const win = manager.createProjectWindow('project-1')
      expect(win.loadURL).toHaveBeenCalledWith(
        expect.stringContaining('projectId=project-1')
      )
    })

    it('passes projectId via query string in production mode', () => {
      delete process.env.VITE_DEV_SERVER_URL
      process.env.DIST = '/app/dist'
      const win = manager.createProjectWindow('project-1')
      expect(win.loadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ query: { projectId: 'project-1' } })
      )
      delete process.env.DIST
    })

    it('prevents duplicate windows for the same project', () => {
      const win1 = manager.createProjectWindow('project-1')
      const win2 = manager.createProjectWindow('project-1')
      expect(win1.id).toBe(win2.id)
      expect(win1.focus).toHaveBeenCalled()
    })

    it('allows different projects to have their own windows', () => {
      const win1 = manager.createProjectWindow('project-1')
      const win2 = manager.createProjectWindow('project-2')
      expect(win1.id).not.toBe(win2.id)
    })

    it('getProjectWindow returns null for unknown project', () => {
      expect(manager.getProjectWindow('nonexistent')).toBeNull()
    })

    it('getProjectWindow returns the window', () => {
      manager.createProjectWindow('project-1')
      const win = manager.getProjectWindow('project-1')
      expect(win).toBeDefined()
    })

    it('getProjectWindow returns null after window is destroyed', () => {
      const win = manager.createProjectWindow('project-1')
      const mockWin = mockWindowInstances.find(
        (w) => (w as { id: number }).id === win.id
      ) as unknown as InstanceType<typeof MockBW>
      mockWin.destroy()
      expect(manager.getProjectWindow('project-1')).toBeNull()
    })

    it('getAllProjectWindows returns all open project windows', () => {
      manager.createProjectWindow('project-1')
      manager.createProjectWindow('project-2')
      const all = manager.getAllProjectWindows()
      expect(all.size).toBe(2)
      expect(all.has('project-1')).toBe(true)
      expect(all.has('project-2')).toBe(true)
    })

    it('getAllProjectWindows cleans up destroyed windows', () => {
      manager.createProjectWindow('project-1')
      const win2 = manager.createProjectWindow('project-2')
      const mockWin2 = mockWindowInstances.find(
        (w) => (w as { id: number }).id === win2.id
      ) as unknown as InstanceType<typeof MockBW>
      mockWin2.destroy()
      const all = manager.getAllProjectWindows()
      expect(all.size).toBe(1)
      expect(all.has('project-1')).toBe(true)
    })

    it('closeProjectWindow closes the window', () => {
      const win = manager.createProjectWindow('project-1')
      const result = manager.closeProjectWindow('project-1')
      expect(result).toBe(true)
      expect(win.close).toHaveBeenCalled()
    })

    it('closeProjectWindow returns false for unknown project', () => {
      expect(manager.closeProjectWindow('nonexistent')).toBe(false)
    })

    it('getProjectWindowCount returns correct count', () => {
      expect(manager.getProjectWindowCount()).toBe(0)
      manager.createProjectWindow('project-1')
      expect(manager.getProjectWindowCount()).toBe(1)
      manager.createProjectWindow('project-2')
      expect(manager.getProjectWindowCount()).toBe(2)
      manager.closeProjectWindow('project-1')
      expect(manager.getProjectWindowCount()).toBe(1)
    })

    it('cleans up stale entry when destroyed window is re-opened', () => {
      const win1 = manager.createProjectWindow('project-1')
      const mockWin1 = mockWindowInstances.find(
        (w) => (w as { id: number }).id === win1.id
      ) as unknown as InstanceType<typeof MockBW>
      mockWin1.destroy()
      const win2 = manager.createProjectWindow('project-1')
      expect(win2.id).not.toBe(win1.id)
    })

    it('removes from map when closed event fires', () => {
      manager.createProjectWindow('project-1')
      const win = manager.getProjectWindow('project-1')
      expect(win).not.toBeNull()
      win!.close()
      expect(manager.getProjectWindow('project-1')).toBeNull()
    })
  })

  // ─── closeAll ─────────────────────────────────────────────────────────────

  describe('closeAll', () => {
    it('closes all windows', () => {
      const main = manager.createMainWindow()
      const proj1 = manager.createProjectWindow('project-1')
      const proj2 = manager.createProjectWindow('project-2')

      manager.closeAll()

      expect(proj1.close).toHaveBeenCalled()
      expect(proj2.close).toHaveBeenCalled()
      expect(main.close).toHaveBeenCalled()
    })

    it('handles case where no windows are open', () => {
      expect(() => manager.closeAll()).not.toThrow()
    })
  })
})
