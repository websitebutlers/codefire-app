<p align="center">
  <img src="assets/codefire-logo.png" alt="CodeFire" width="128">
</p>

<h1 align="center">CodeFire</h1>

<p align="center">
  <strong>Persistent memory for AI coding agents</strong><br>
  A companion app for Claude Code, Gemini CLI, Codex CLI, and OpenCode
</p>

<p align="center">
  <a href="https://github.com/websitebutlers/codefire-app/releases/latest"><img src="https://img.shields.io/badge/download-macOS-orange?style=flat-square" alt="Download macOS"></a>
  <a href="https://github.com/websitebutlers/codefire-app/releases/latest"><img src="https://img.shields.io/badge/download-Windows_(early_alpha)-yellow?style=flat-square" alt="Download Windows"></a>
  <a href="https://github.com/websitebutlers/codefire-app/releases/latest"><img src="https://img.shields.io/badge/download-Linux_(early_alpha)-yellow?style=flat-square" alt="Download Linux"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="MIT License"></a>
</p>

---

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

## Download

| Platform | Download | Technology | Status |
|----------|----------|-----------|--------|
| **macOS** | [CodeFire-macOS.zip](https://github.com/websitebutlers/codefire-app/releases/latest/download/CodeFire-macOS.zip) | Swift / SwiftUI | **Beta** — primary platform, actively developed |
| **Windows** | [CodeFire.Setup.exe](https://github.com/websitebutlers/codefire-app/releases/latest) | Electron / React | **Early Alpha** — see note below |
| **Linux (AppImage)** | [CodeFire.AppImage](https://github.com/websitebutlers/codefire-app/releases/latest) | Electron / React | **Early Alpha** — see note below |
| **Linux (deb)** | [codefire.deb](https://github.com/websitebutlers/codefire-app/releases/latest) | Electron / React | **Early Alpha** — see note below |

> **macOS:** Unzip and drag to Applications. Signed and notarized by Apple.
> **Windows:** Run the installer. Requires Windows 10+.
> **Linux:** `chmod +x CodeFire-*.AppImage && ./CodeFire-*.AppImage` or `sudo dpkg -i codefire-*.deb`

### Windows & Linux — Early Alpha

The Windows and Linux builds are **early alpha** and under active development. Expect missing features, rough edges, and bugs. The macOS Swift app is the primary platform and has the most complete feature set.

**What works:** Core project management, task tracking, built-in terminal, settings panel, basic Git integration.

**What's in progress:** MCP server integration, session monitoring, semantic search, and general stability improvements.

**We're looking for contributors!** If you're a developer on Windows or Linux and want to help build out the Electron app, check the [open issues](https://github.com/websitebutlers/codefire-app/issues) or see [CONTRIBUTING.md](CONTRIBUTING.md) to get started. The Electron app lives in the [`electron/`](electron/) directory.

## Build from Source

### macOS

```bash
cd swift
swift build -c release
```

See [`swift/README.md`](swift/) for full build and signing instructions.

### Windows / Linux

```bash
cd electron
npm install
npm run dist
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
