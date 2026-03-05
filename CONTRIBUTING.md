# Contributing to CodeFire

Thanks for your interest in contributing! CodeFire is a monorepo with two platform-specific apps that share a common database schema and MCP protocol.

## Repository Structure

```
swift/          macOS app (Swift/SwiftUI) — Beta
electron/       Windows/Linux app (Electron/React) — Alpha
landing/        Marketing website
assets/         Shared screenshots and branding
scripts/        Build and packaging scripts
```

## Which directory should I work in?

| If you're working on... | Go to... |
|------------------------|----------|
| macOS features or bugs | `swift/` |
| Windows/Linux features or bugs | `electron/` |
| The marketing website | `landing/` |
| Build/packaging scripts | `scripts/` |

## Shared Database Schema

Both the Swift and Electron apps read and write the same SQLite database (`~/Library/Application Support/CodeFire/codefire.db` on macOS, platform-appropriate paths elsewhere). If you modify the database schema in one app, you **must** update the other to match.

- **Swift migrations:** `swift/Sources/CodeFire/Services/DatabaseService.swift`
- **Electron migrations:** `electron/src/main/database/migrations/index.ts`

## Development Setup

### macOS (Swift)

```bash
cd swift
swift build
# Run with: swift run CodeFire
```

Requires Xcode 15+ or Swift 5.9+ toolchain.

### Electron

```bash
cd electron
npm install
npm run dev
```

Requires Node.js 18+.

### Running Tests

```bash
# Electron tests
cd electron
npm test
```

## Branch Naming

- `feature/<description>` — New features
- `fix/<description>` — Bug fixes
- `chore/<description>` — Maintenance, refactoring, docs

## Pull Request Guidelines

1. Target the `main` branch
2. Include a clear description of what changed and why
3. If your change affects both apps, note that in the PR description
4. Keep PRs focused — one feature or fix per PR
5. Add tests for new Electron functionality

## Code Style

- **Swift:** Follow standard Swift conventions. The project uses SwiftUI and Swift Package Manager.
- **Electron/React:** TypeScript with React. Use the existing patterns in `electron/src/renderer/` for components and hooks.
