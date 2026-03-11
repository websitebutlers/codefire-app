# MCP Auto-Setup Design

**Date:** 2026-03-10
**Status:** Approved
**Platform:** Electron (macOS primary, Windows/Linux secondary)

## Problem

The Electron app bundles an MCP server inside the `.app` bundle, but the path changes with every update or install location. Users must manually find the path and run `claude mcp add codefire node /path/to/server.js`. The Swift app had a stable binary path that worked effortlessly — the Electron app needs the same experience.

### Why macOS needs a stable path

`process.resourcesPath` inside the `.app` bundle works for the running app, but AI CLIs (Claude Code, Gemini) need to spawn the MCP server independently. If the user runs the app from the DMG without dragging to `/Applications`, or installs to a non-standard location, the bundle path is unreliable. A user-data path (`~/Library/Application Support/CodeFire/mcp-server/`) is always writable, always predictable, and matches what the Swift app did.

## Solution

Two mechanisms working together:

1. **Stable path sync** — On every app launch, copy the MCP server to a predictable, update-proof location
2. **Auto-register with confirmation** — On first launch (or when config is missing), prompt the user to register the MCP server with their AI CLI

## Stable Path Sync

### Target paths by platform

All platforms use `app.getPath('userData')` + `/mcp-server/` as the stable path:

| Platform | Resolved stable path |
|----------|----------------------|
| macOS | `~/Library/Application Support/CodeFire/mcp-server/server.js` |
| Windows | `%APPDATA%/CodeFire/mcp-server/server.js` |
| Linux | `~/.config/CodeFire/mcp-server/server.js` |

### Source path

All platforms use `process.resourcesPath` to locate the bundled MCP server — Electron sets this correctly for all install types (`.app`, `.deb`, AppImage, NSIS).

### Behavior

- Runs on every app launch, before any MCP registration checks
- Skips if `!app.isPackaged` (dev mode uses `dist-electron/mcp/server.js` directly)
- Compares `package.json` version in stable path vs. bundle — skips copy if versions match (avoids unnecessary startup delay from copying `node_modules` on every launch)
- When versions differ, copies the entire `mcp-server/` directory (server.js, package.json, node_modules)
- Linux already has partial implementation via `MCPServerManager.syncMcpServerForLinux()` — replace with cross-platform `syncMcpServer()`

### `getMcpServerPath()` change

After sync, `getMcpServerPath()` returns:
- **Dev mode**: `path.join(__dirname, '..', 'mcp', 'server.js')` (unchanged)
- **All packaged platforms**: `path.join(app.getPath('userData'), 'mcp-server', 'server.js')`

This replaces the current platform-specific branching.

## Global Auto-Register

### Detection

On app launch, after stable path sync, check if `codefire` is registered in CLI configs:

1. **Claude Code**: Check `~/.claude.json` → `mcpServers.codefire`
2. **Gemini CLI**: Check `~/.gemini/settings.json` → `mcpServers.codefire` (only if `gemini` binary found in PATH)
3. **Codex CLI**: Check `~/.codex/config.toml` → `[mcp_servers.codefire]` (only if `codex` binary found in PATH)

OpenCode is excluded from global registration — it requires per-project config.

CLI binary detection: use `which <binary>` on macOS/Linux, `where <binary>` on Windows. Binary names: `claude`, `gemini`, `codex`.

### Confirmation dialog

Show after main window is visible (not before — avoids the app appearing to hang). Use `BrowserWindow.once('show', ...)` to trigger.

When `codefire` is missing from a detected CLI config, show a native Electron `dialog.showMessageBox`:

**Title:** "Set up CodeFire MCP Server"

**Message:** "CodeFire can register its MCP server with [Claude Code / detected CLIs] so your AI agent has access to your tasks, notes, and project context. Set up now?"

**Buttons:**
- **Yes** (default, focused) — registers the MCP server using the stable path
- **Not now** — skips, checks again on next launch
- **Don't ask again** — sets `mcpAutoSetupDismissed: true` in ConfigStore, never prompts again

### Registration

When user confirms, write the config entry using fully resolved absolute paths (no tildes, no env vars):

**Claude Code** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "codefire": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/nick/Library/Application Support/CodeFire/mcp-server/server.js"]
    }
  }
}
```

Prefer `claude mcp add codefire -- node <path>` CLI command first. Fall back to direct JSON file write if CLI fails.

Back up `~/.claude.json` to `~/.claude.json.bak` before any direct file write.

Refactor `DeepLinkService.installMCP()` to accept a `serverPath` parameter instead of computing it internally. Both the deep link flow and the auto-register flow call the same function with the stable path.

### Path update on subsequent launches

If `codefire` is already registered but points to an old/wrong path (any path that doesn't match the current stable path), silently update it. No prompt needed.

Exception: if the registered path contains `dist-electron` or a recognizable dev-mode pattern, don't update — the user is likely a developer running from source.

## Per-Project Detection

### When it triggers

When a project window opens (`ProjectLayout` mounts or project is selected):

1. Check if the project has a `.mcp.json` with a `codefire` entry

### UI

If missing, show a **non-modal banner** at the top of the project window:

- "This project isn't connected to CodeFire's MCP server. [Connect] [Dismiss]"
- **Connect** — writes `.mcp.json` into the project root with the stable MCP path
- **Dismiss** — hides the banner for this project (store dismissed project paths in ConfigStore — paths are more stable than IDs across re-imports)
- Banner is subtle (info-style, not warning/error) — not disruptive

### `.mcp.json` format

```json
{
  "mcpServers": {
    "codefire": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/nick/Library/Application Support/CodeFire/mcp-server/server.js"]
    }
  }
}
```

### Scope

This is secondary to the global setup. Most users will use global registration. Per-project is for users who prefer isolated configs or use OpenCode.

## MCP Secrets Sync

### Behavior

- On every app launch, call `writeMCPSecrets()` to sync secrets to the stable location
- When settings change (OpenRouter key, OpenAI key), update the file immediately
- The MCP server reads this file at startup to get API keys

### File location

Same as existing: `app.getPath('userData')/mcp-secrets.json` (e.g., `~/Library/Application Support/CodeFire/mcp-secrets.json`). No change from current location — the MCP server already looks here.

### Contents

```json
{
  "openRouterKey": "sk-or-...",
  "openAiKey": "sk-..."
}
```

**Fix required:** Current `writeMCPSecrets()` only writes `openRouterKey`. Add `openAiKey` to the output.

Write atomically: write to a temp file in the same directory, then `fs.renameSync` to the final path. Set file permissions to `0o600` on macOS/Linux. On Windows, rely on user-profile directory ACLs (POSIX mode bits are ignored).

## Implementation Scope

### Files to modify

1. **`MCPServerManager.ts`** — Replace `syncMcpServerForLinux()` with cross-platform `syncMcpServer()`. Add `checkAndPromptMCPRegistration()`. Add `updateStaleConfigPaths()`. Simplify `getMcpServerPath()`.
2. **`DeepLinkService.ts`** — Refactor `installMCP()` to accept a `serverPath` parameter. Add `~/.claude.json` backup before writes.
3. **`src/main/index.ts`** — Call `syncMcpServer()` then `checkAndPromptMCPRegistration()` after main window shows.
4. **`ConfigStore.ts`** — Add `mcpAutoSetupDismissed` and `mcpDismissedProjects` to defaults. Fix `writeMCPSecrets()` to include `openAiKey` and use atomic writes.
5. **`src/shared/models.ts`** — Add new keys to `AppConfig` interface.
6. **`settings-handlers.ts`** — Add new keys to `ALLOWED_SETTINGS_KEYS`. Trigger `writeMCPSecrets()` when `openAiKey` changes (in addition to existing `openRouterKey` trigger).
7. **`ProjectLayout.tsx`** — Add per-project MCP detection check via IPC.
8. **New component: `MCPBanner.tsx`** — The per-project connection banner.
9. **New IPC handler** — `mcp:checkProjectConfig` and `mcp:installProjectConfig` in `mcp-handlers.ts`.

### Files NOT modified

- `mcp/server.ts` — No changes to the MCP server itself
- `electron-builder` config — extraResources already bundles mcp-server correctly

### New ConfigStore keys

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `mcpAutoSetupDismissed` | boolean | false | User chose "Don't ask again" |
| `mcpDismissedProjects` | string[] | [] | Project paths where banner was dismissed |

## Edge Cases

- **App not in /Applications**: Works fine — we copy to stable user-data path regardless of install location
- **Multiple CodeFire versions**: Last-launched version wins (overwrites stable path). Version check in `package.json` prevents unnecessary copies.
- **No Node.js in PATH**: Claude Code bundles its own Node runtime. The `command: "node"` in the config is resolved by the spawning CLI, not the system PATH.
- **Permissions errors**: If we can't write to the stable path or CLI config, log the error and show a helpful dialog explaining what to do manually.
- **CLI not installed**: Only prompt for CLIs whose binaries are found in PATH.
- **Dev mode**: `syncMcpServer()` is skipped. `getMcpServerPath()` returns the dev build path. Auto-register still runs but uses the dev path (developer can dismiss).
- **Concurrent launches**: Use a simple version-file check before copying. If two instances race, the result is the same (same version overwrites itself). No lock file needed.
- **User has custom MCP path**: If the registered path contains `dist-electron` or other dev patterns, don't auto-update it.
