<p align="center">
  <img src="assets/codefire-logo.png" alt="CodeFire" width="128">
</p>

<h1 align="center">CodeFire</h1>

<p align="center">
  <strong>Persistent memory for AI coding agents</strong><br>
  A cross-platform companion app for Claude Code, Gemini CLI, Codex CLI, and OpenCode
</p>

<p align="center">
  <a href="https://github.com/websitebutlers/codefire-app/releases/latest"><img src="https://img.shields.io/badge/download-macOS-orange?style=flat-square" alt="Download macOS"></a>
  <a href="https://github.com/websitebutlers/codefire-app/releases/latest"><img src="https://img.shields.io/badge/download-Windows-blue?style=flat-square" alt="Download Windows"></a>
  <a href="https://github.com/websitebutlers/codefire-app/releases/latest"><img src="https://img.shields.io/badge/download-Linux-green?style=flat-square" alt="Download Linux"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://codefire.app">Website</a> · <a href="https://codefire.app/getting-started">Getting Started</a> · <a href="https://discord.gg/cMtjR83D">Discord</a> · <a href="https://github.com/websitebutlers/codefire-app/discussions">Community</a> · <a href="https://github.com/websitebutlers/codefire-app/releases/latest">Download</a>
</p>

---

## What is CodeFire?

Your AI coding agent forgets everything between sessions. CodeFire fixes that.

It auto-discovers your projects, tracks tasks and sessions, monitors live coding activity, and exposes project data back to your AI via MCP — creating a persistent memory layer where your agent knows what you were working on, what decisions were made, and what's left to do.

Two platform implementations share the same SQLite database schema and MCP protocol:

| Platform | Technology | Status |
|----------|-----------|--------|
| **macOS (Apple Silicon)** | Swift / SwiftUI | Beta — primary platform |
| **Windows (x64)** | Electron / React / TypeScript | Early Alpha |
| **Linux (x64)** | Electron / React / TypeScript | Early Alpha |
| **macOS (Intel)** | Electron / React / TypeScript | Early Alpha |

### Features

- **Persistent memory** — Tasks, notes, and session context that survive across CLI sessions
- **Task tracking** — Drag-and-drop Kanban board with priorities, labels, and task notes
- **Live session monitoring** — Real-time token usage, cost tracking, and tool call stats
- **Semantic code search** — Vector + keyword hybrid search across your indexed codebase
- **Multi-tab file editor** — Browse and edit project files in tabs, with syntax highlighting, line numbers, Cmd+F find, unsaved-change protection, and a right-click context menu to turn any selection into a task, note, or terminal command
- **Rendered markdown** — Notes and Claude Code memory files render as styled markdown (tables, headings, code blocks) with a one-click Edit/Preview toggle
- **Claude Code memory editor** — Edit the memory files Claude Code auto-loads every session, straight from the app
- **Built-in terminal** — Tabbed terminal sessions alongside your project views, with show/hide toggle
- **Browser automation** — 40+ MCP tools for navigating, clicking, typing, screenshotting (Electron)
- **Git integration** — Commits, staged changes, diffs, and branch management
- **AI chat** — Ask questions about your codebase with RAG-powered context
- **Image generation** — Text-to-image via OpenRouter (Gemini, DALL-E, etc.)
- **Notes & briefings** — Pin architecture decisions, capture gotchas, get AI-generated daily briefings
- **Gmail integration** — Sync emails into tasks with whitelist rules
- **MCP server** — 63 tools exposing project data to any AI coding CLI
- **Universal compatibility** — Works with Claude Code, Gemini CLI, Codex CLI, and OpenCode

<p align="center">
  <img src="assets/screenshot-01.png" alt="CodeFire — Planner view with Kanban board, task tracking, and project intelligence" width="100%">
</p>

## Download

| Platform | Download | Notes |
|----------|----------|-------|
| **macOS (Apple Silicon)** | [CodeFire-macOS.zip](https://github.com/websitebutlers/codefire-app/releases/latest/download/CodeFire-macOS.zip) | Native Swift app. Unzip and drag to Applications. |
| **macOS (Intel)** | [CodeFire Electron DMG](https://github.com/websitebutlers/codefire-app/releases/latest) | Electron app. Also runs on Apple Silicon via Rosetta 2. |
| **Windows** | [CodeFire Setup exe](https://github.com/websitebutlers/codefire-app/releases/latest) | NSIS installer. Windows 10+ required. |
| **Linux** | [Latest Release](https://github.com/websitebutlers/codefire-app/releases/latest) | AppImage + .deb available when built on Linux CI. |

> For detailed setup instructions including API key configuration, see the **[Getting Started guide](https://codefire.app/getting-started)**.

## Quick Start

### 1. Install & Open

Download for your platform above, install, and launch CodeFire.

### 2. Add Your OpenRouter API Key

Open Settings and go to the **Engine** tab (Electron) or **CodeFire Engine** tab (Swift). Paste your [OpenRouter API key](https://openrouter.ai/keys). This powers AI chat, semantic code search, and image generation.

### 3. Connect Your CLI

The fastest way is the one-click install — visit [codefire.app/getting-started](https://codefire.app/getting-started) and click the button for your CLI.

Or configure manually:

```bash
# Claude Code — macOS (Swift)
claude mcp add codefire ~/Library/Application\ Support/CodeFire/bin/CodeFireMCP

# Claude Code — Linux (AppImage, auto-synced on first launch)
claude mcp add codefire node ~/.local/share/CodeFire/mcp-server/server.js

# Claude Code — Windows
claude mcp add codefire node "%APPDATA%\CodeFire\resources\mcp-server\server.js"
```

<details>
<summary>Other CLI tools</summary>

**Gemini CLI** — `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "codefire": {
      "command": "~/Library/Application Support/CodeFire/bin/CodeFireMCP",
      "args": []
    }
  }
}
```

**Codex CLI** — `~/.codex/config.toml`:
```toml
[mcp_servers.codefire]
command = "~/Library/Application Support/CodeFire/bin/CodeFireMCP"
args = []
```

**OpenCode** — `opencode.json` (project root):
```json
{
  "mcpServers": {
    "codefire": {
      "type": "local",
      "command": ["~/Library/Application Support/CodeFire/bin/CodeFireMCP"]
    }
  }
}
```

> Electron users: the MCP server path differs by platform. See the [setup guides](#4-add-system-instructions) for exact paths. Linux AppImage users: the MCP server is automatically synced to `~/.local/share/CodeFire/mcp-server/` on first launch.

</details>

### 4. Add System Instructions

For the best experience, add CodeFire instructions to your CLI's system prompt file. This teaches your AI agent how to use CodeFire's tools effectively — session workflows, task tracking, notes, and more.

| CLI | Setup Guide |
|-----|-------------|
| Claude Code | [codefire-claude-md-setup.md](docs/codefire-claude-md-setup.md) |
| Gemini CLI | [codefire-gemini-setup.md](docs/codefire-gemini-setup.md) |
| Codex CLI | [codefire-codex-setup.md](docs/codefire-codex-setup.md) |
| OpenCode | [codefire-opencode-setup.md](docs/codefire-opencode-setup.md) |

Each guide includes platform-specific MCP connection instructions (macOS, Windows, Linux) and copy-pasteable system instructions.

### 5. Start Coding

Open a project folder in CodeFire, then start a CLI session. Your agent now has access to persistent memory, task tracking, browser automation, and code search — all through MCP.

## MCP Server

CodeFire's MCP server exposes **63 tools** to your AI coding agent:

| Category | Tools | Examples |
|----------|-------|---------|
| **Tasks** | 6 | Create, update, list, and annotate tasks with notes |
| **Notes** | 5 | Create, search, pin, and manage project notes |
| **Projects** | 2 | List projects, get current project context |
| **Sessions** | 2 | List and search session history |
| **Code Search** | 1 | Full-text search across indexed codebase |
| **Browser** | 40+ | Navigate, click, type, screenshot, eval JS, manage cookies |
| **Images** | 1 | List generated images |
| **Clients** | 2 | List and create client groups |

## Build from Source

### macOS (Swift)

```bash
cd swift
swift build -c release
```

See [`swift/README.md`](swift/) for full build and signing instructions.

### Windows / Linux / macOS Intel (Electron)

```bash
cd electron
npm install          # Install deps + rebuild native modules
npm run dev          # Start dev server + Electron
npm run build        # TypeScript compile + Vite build
npm test             # Run tests (Vitest)
npm run dist         # Package for current platform
npm run dist:win     # Windows installer (NSIS)
npm run dist:linux   # Linux packages (AppImage + deb)
npm run dist:mac     # macOS DMG + zip
```

See [`electron/README.md`](electron/) for detailed architecture and development docs.

## Repository Structure

```
swift/          macOS app (Swift/SwiftUI) — Beta
electron/       Windows/Linux/macOS Intel app (Electron/React/TypeScript) — Alpha
landing/        Marketing website (codefire.app)
assets/         Shared screenshots and branding
scripts/        Build and packaging scripts
CLAUDE.md       Architecture docs for AI coding agents
SECURITY.md     Security policy and vulnerability reporting
```

## Architecture

Both apps follow the same data model:

- **SQLite database** at `~/Library/Application Support/CodeFire/codefire.db` (macOS), `~/.config/CodeFire/codefire.db` (Linux), or `%APPDATA%\CodeFire\codefire.db` (Windows)
- **MCP server** communicates via stdio — no network listeners, fully local
- **Project discovery** scans `~/.claude/projects/` for Claude Code session data
- **Shared schema** — both Swift and Electron apps read/write the same database

### Electron Architecture

The Electron app follows strict **main/preload/renderer** process separation:

- **Main process** (`src/main/`) — Database, IPC handlers, services (Git, Terminal, Search, MCP)
- **Preload** (`src/preload/`) — Typed bridge exposing `window.api` via contextBridge
- **Renderer** (`src/renderer/`) — React 19 + Tailwind CSS 4 + Vite
- **MCP server** (`src/mcp/`) — Standalone Node.js process spawned by CLI tools

Path aliases: `@shared`, `@renderer`, `@main`

## Contributing

We're actively looking for contributors, especially for the Electron app on Windows and Linux.

- **[Getting Started guide](https://codefire.app/getting-started)** — Set up the app
- **[Testers Wanted](https://github.com/websitebutlers/codefire-app/discussions/48)** — Testing guide with platform-specific instructions
- **[Developer Wishlist](https://github.com/websitebutlers/codefire-app/discussions/49)** — Areas where we need help (search engine, browser automation, testing, MCP)
- **[Community Guidelines](https://github.com/websitebutlers/codefire-app/discussions/47)** — How to get involved
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Code style, branch naming, and PR guidelines
- **[SECURITY.md](SECURITY.md)** — Vulnerability reporting

### Priority Contribution Areas

1. **Semantic search improvements** — Local embedding fallback, reranking, better chunking
2. **Browser automation** — Network capture, session persistence, Web Vitals
3. **Testing** — Swift unit tests, MCP protocol tests, E2E browser tests, CI matrix builds
4. **Cross-platform parity** — Port features between Swift and Electron
5. **MCP server extensions** — Git operations, custom tool plugins, metrics

## Requirements

- **macOS (Swift):** macOS 14.0 (Sonoma) or later, Apple Silicon
- **Electron:** Windows 10+, Ubuntu 20.04+, or macOS 10.15+ (Intel or Apple Silicon via Rosetta)
- **OpenRouter API key** for AI-powered features ([get one here](https://openrouter.ai/keys))
- An AI coding CLI: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex), or [OpenCode](https://github.com/sst/opencode)

## License

MIT
