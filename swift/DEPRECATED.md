# Swift App — Deprecated

The native Swift/SwiftUI macOS app has been **removed from distribution as of April 1, 2026**.

The Electron app (`../electron/`) is now the sole CodeFire platform, serving macOS, Windows, and Linux.

## Why?

- Maintaining two implementations (Swift + Electron) with feature parity was unsustainable
- The Electron app reached feature parity and surpassed the Swift app in several areas (browser automation, chat RAG, recordings/transcription)
- A single codebase allows faster iteration across all platforms

## What about existing Swift users?

- The Swift app will continue to work locally but will no longer receive updates
- Users should migrate to the Electron macOS build (DMG available on the releases page)
- The SQLite database is compatible — projects, tasks, notes, and sessions carry over automatically

## Code status

This directory is retained for reference but is not actively maintained. Do not submit PRs for new Swift features.
