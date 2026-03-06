# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is CodeFire?

Persistent memory companion app for AI coding agents (Claude Code, Gemini CLI, Codex CLI, OpenCode). Auto-discovers projects, tracks tasks/sessions, monitors coding activity, and exposes data via MCP server. Two platform implementations share a common SQLite schema and MCP protocol.

## Repository Layout

- `swift/` — macOS app (Swift/SwiftUI) — Beta, primary platform
- `electron/` — Windows/Linux app (Electron/React/TypeScript) — Early Alpha
- `landing/` — Marketing website
- `scripts/` — Build and packaging scripts (icon generation, packaging)

## Development Commands

### Electron (Windows/Linux)

```bash
cd electron
npm install          # Install dependencies
npm run dev          # Start Vite dev server + Electron
npm run build        # TypeScript compile + Vite build
npm test             # Run vitest tests (vitest run)
npm run test:watch   # Run vitest in watch mode
npm run dist:win     # Build Windows installer (NSIS)
npm run dist:linux   # Build Linux packages (AppImage + deb)
```

### macOS (Swift)

```bash
cd swift
swift build              # Build
swift build -c release   # Release build
swift run CodeFire       # Run
```

## Electron Architecture

The Electron app follows a strict **main/preload/renderer** process separation:

**Main process** (`src/main/`):
- `index.ts` — App entry. Initializes database, WindowManager, TerminalService, GitService, registers all IPC handlers.
- `database/` — SQLite via better-sqlite3. `connection.ts` for DB singleton, `migrations/` for schema, `dao/` for data access objects (one per entity: ProjectDAO, TaskDAO, SessionDAO, etc.).
- `ipc/` — IPC handler files, one per domain (e.g., `task-handlers.ts`, `git-handlers.ts`). All registered in `ipc/index.ts`.
- `services/` — Business logic: GitService, TerminalService (node-pty), SearchEngine, SessionParser, ProjectDiscovery, ImageGenerationService, GmailService, etc.
- `windows/WindowManager.ts` — Manages main window and per-project windows.

**Preload** (`src/preload/index.ts`):
- Exposes `window.api` with typed `invoke`/`on`/`send` methods via contextBridge.

**Renderer** (`src/renderer/`):
- React 19 + Tailwind CSS 4 + Vite
- `App.tsx` routes to `MainLayout` or `ProjectLayout` based on `?projectId=` URL param
- `views/` — One view per feature (TasksView, GitView, SessionsView, etc.)
- `components/` — Feature-grouped components (Kanban/, Git/, Terminal/, etc.)
- `hooks/` — Custom hooks per domain (useTasks, useGit, useSessions, etc.)
- `layouts/` — MainLayout (home) and ProjectLayout (project window)

**Shared** (`src/shared/`):
- `types.ts` — IPC channel type definitions (all channel names are typed)
- `models.ts` — Core data interfaces (Project, Session, TaskItem, Note, etc.)
- `theme.ts` — Theme configuration

Path aliases: `@shared` → `src/shared`, `@renderer` → `src/renderer`, `@main` → `src/main`

## Key Patterns

- **IPC communication**: Renderer calls `window.api.invoke('domain:action', ...args)`. Main process handles via `ipcMain.handle`. Channel names follow `domain:action` convention and are typed in `src/shared/types.ts`.
- **Terminal**: Uses fire-and-forget `send` for writes/resizes, `handle` for create/kill, and `webContents.send` for data back to renderer.
- **Database**: All DB access goes through DAO classes. If you modify the schema, you must update migrations in both `swift/Sources/CodeFire/Services/DatabaseService.swift` and `electron/src/main/database/migrations/index.ts`.
- **Native modules**: `better-sqlite3` and `node-pty` are externalized from Vite bundling and unpacked from asar. `better-sqlite3` is rebuilt against Electron's Node headers via a `postinstall` script (`electron-rebuild`). `node-pty` ships N-API prebuilds that are ABI-stable across Node/Electron versions.
- **Multi-window**: Main window shows home/global views. Project windows open separately with `?projectId=` param.

## Release Workflow

When creating a GitHub release:

1. **Always include a Downloads table** at the top of the release notes, before the changelog. Format:
   ```markdown
   ## Downloads

   | Asset | Size | Platform |
   |-------|------|----------|
   | [filename](download-url) | size | platform description |
   ```
   - Link each asset name to its direct download URL
   - Include size in MB (rounded)
   - List all platform variants (Swift macOS, Electron macOS DMG/zip, Windows exe, Linux AppImage, Linux deb)

2. **Update README download links** to point to the new version's assets
3. **Repo:** `websitebutlers/codefire-app`

## Branch Naming

- `feature/<description>`, `fix/<description>`, `chore/<description>`

## Testing

Tests are in `electron/src/__tests__/` using Vitest with jsdom. Setup file at `electron/src/__tests__/setup.ts`.
