# CodeFire MCP — OpenCode Setup

## Step 1: Connect the MCP Server

Add the CodeFire MCP server to your OpenCode config. CodeFire must be installed and running.

### macOS (Swift app)

Add to `opencode.jsonc` in your project root (or global config):
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

### Windows (Electron app)

Add to `opencode.jsonc`:
```json
{
  "mcpServers": {
    "codefire": {
      "type": "local",
      "command": ["node", "%APPDATA%\\CodeFire\\resources\\mcp-server\\server.js"]
    }
  }
}
```

### Linux (Electron app)

Add to `opencode.jsonc`:
```json
{
  "mcpServers": {
    "codefire": {
      "type": "local",
      "command": ["node", "~/.local/share/CodeFire/mcp-server/server.js"]
    }
  }
}
```

> **Note:** The AppImage auto-syncs the MCP server to `~/.local/share/CodeFire/mcp-server/` on first launch. For deb installs, use `/opt/CodeFire/resources/mcp-server/server.js` instead.

### Verify it's connected

Start a new OpenCode session and ask: "What MCP tools do you have from codefire?" — you should see 60+ tools listed.

## Step 2: Add Instructions

Create an agent instruction file at `~/.config/opencode/agents/codefire.md` or add the section below to your project's `AGENTS.md`. This tells OpenCode how to use the CodeFire tools effectively.

---

## Copy Everything Below This Line

```markdown
## CodeFire MCP

CodeFire provides persistent memory across coding sessions via MCP. Tasks, notes, and project context survive between conversations.

### Session Workflow

**Every session MUST start with:**
1. `get_current_project` — confirm which project is auto-detected
2. `list_tasks(status: "in_progress")` — resume unfinished work
3. `list_tasks(status: "todo")` — know what's queued
4. `list_notes(pinned_only: true)` — read critical context from prior sessions
5. Brief the user on what you found

**Every session MUST end with:**
1. Update all task statuses accurately
2. `add_task_note` on anything unfinished — what's done, what's left, gotchas
3. `create_note` session summary if significant work was done

### Task Management

| Tool | Purpose |
|------|---------|
| `list_tasks` | List tasks by status (todo/in_progress/done) |
| `create_task` | Create a new task (title required) |
| `update_task` | Update status, priority, title, description, labels |
| `add_task_note` | Add progress notes to a task |
| `get_task` | Get full task details + notes |

**Rules:**
- User asks you to do something? `create_task` immediately
- Starting work? `update_task` to `in_progress` BEFORE writing code
- Finished? `update_task` to `done` AFTER verifying
- Log progress with `add_task_note` — what you tried, what worked, decisions made

**Priority levels:** 0=none, 1=low, 2=medium, 3=high, 4=urgent
**Statuses:** `todo`, `in_progress`, `done`

### Notes — Institutional Memory

| Tool | Purpose |
|------|---------|
| `list_notes` | List project notes (use `pinned_only: true` for critical context) |
| `create_note` | Create a persistent note (title + markdown content) |
| `update_note` | Update note content |
| `search_notes` | Full-text search across notes |

**Capture immediately when you discover:**
- Gotchas or non-obvious behaviors
- Architecture patterns and conventions
- Bug patterns and their fixes
- Important decisions and rationale

**Pin** architecture decisions and critical gotchas. Don't pin session summaries.

### Context Search

`context_search` performs hybrid vector + keyword search across the indexed codebase.

| Tool | Purpose |
|------|---------|
| `context_search` | Semantic code search (query required, optional: limit, types) |

**Types filter:** `function`, `class`, `block`, `doc`, `commit`

Use for understanding how features work, finding patterns, and exploring code BEFORE making changes.

### Browser Automation

Use for visual verification and E2E testing instead of asking the user to manually test.

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Open a URL |
| `browser_screenshot` | Capture current page |
| `browser_click` / `browser_type` | Interact with elements |
| `browser_console_logs` | Capture JS console output |

### Git Operations

| Tool | Purpose |
|------|---------|
| `git_status` | Check working tree state |
| `git_diff` | View changes |
| `git_log` | View commit history |
| `git_stage` | Stage files |
| `git_commit` | Create a commit |
```
