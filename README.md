<p align="center">
  <img src="assets/codefire-logo.png" alt="CodeFire" width="128">
</p>

<h1 align="center">CodeFire</h1>

<p align="center">
  <strong>Persistent memory for AI coding agents</strong><br>
  A companion app for Claude Code, Gemini CLI, Codex CLI, and OpenCode
</p>

<p align="center">
  <a href="https://github.com/websitebutlers/codefire-app/releases/latest"><img src="https://img.shields.io/badge/download-macOS_Beta-orange?style=flat-square" alt="Download macOS"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License"></a>
</p>

---

## Platform Support

| Platform | Technology | Status | Directory |
|----------|-----------|--------|-----------|
| **macOS** | Swift / SwiftUI | Beta | [`swift/`](swift/) |
| **Windows** | Electron / React | Alpha | [`electron/`](electron/) |
| **Linux** | Electron / React | Alpha | [`electron/`](electron/) |

Both apps share the same SQLite database schema and MCP server protocol, so your tasks, notes, and project data work across platforms.

## What is CodeFire?

Your AI coding agent forgets everything between sessions. CodeFire fixes that. It auto-discovers your projects, tracks tasks and sessions, monitors live coding activity, and exposes project data back to your AI via MCP — creating a feedback loop where your agent knows what you're working on and can act on it.

### Key Features

- **Project management dashboard** with auto-discovery of Claude Code projects
- **Task tracking** with drag-and-drop Kanban board
- **Live session monitoring** with token usage and cost tracking
- **Built-in terminal** with tabbed sessions
- **Git & GitHub integration** — commits, PRs, CI status
- **MCP server** exposing project data to any AI coding tool
- **Semantic code search** across your indexed codebase
- **Notes, recordings, image generation**, and more

<p align="center">
  <img src="assets/screenshot-01.png" alt="CodeFire — Planner view" width="100%">
</p>

## Quick Start

### macOS (Beta)

Download `CodeFire.zip` from [GitHub Releases](https://github.com/websitebutlers/codefire-app/releases/latest), unzip, and drag to Applications. The app is signed and notarized by Apple.

**Build from source:**

```bash
cd swift
swift build -c release
```

See [`swift/README.md`](swift/) for full build and signing instructions.

### Windows / Linux (Alpha)

```bash
cd electron
npm install
npm run build
```

See [`electron/README.md`](electron/) for detailed setup and development instructions.

## MCP Server

CodeFire includes a companion MCP server that exposes your project data to any AI coding tool. Configure it with:

```bash
# Claude Code
claude mcp add codefire ~/Library/Application\ Support/CodeFire/bin/CodeFireMCP
```

See the [macOS README](swift/) for other CLI configurations (Gemini CLI, Codex CLI, OpenCode).

## Repository Structure

```
swift/          macOS app (Swift/SwiftUI) — Beta
electron/       Windows/Linux app (Electron/React) — Alpha
landing/        Marketing website
assets/         Shared screenshots and branding
scripts/        Build and packaging scripts
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on working with this monorepo.

## Requirements

- **macOS app:** macOS 14.0 (Sonoma) or later
- **Electron app:** Node.js 18+, Windows 10+ or Ubuntu 20.04+
- An AI coding CLI: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex), or [OpenCode](https://github.com/sst/opencode)

## License

MIT
