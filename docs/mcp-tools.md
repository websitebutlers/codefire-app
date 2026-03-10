# CodeFire MCP Server — Tool Reference

CodeFire exposes **68 MCP tools** that AI coding agents (Claude Code, Gemini CLI, Codex CLI, OpenCode) can use to interact with your development environment. The MCP server runs locally alongside the CodeFire app.

## Setup

Add to your AI agent's MCP configuration:

```json
{
  "mcpServers": {
    "codefire": {
      "command": "node",
      "args": ["path/to/codefire/electron/src/mcp/server.ts"]
    }
  }
}
```

The server auto-detects the current project based on the working directory.

---

## Project Management

| Tool | Description |
|------|-------------|
| `get_current_project` | Auto-detect the current CodeFire project based on the working directory |
| `list_projects` | List all CodeFire-tracked projects |

## Task Management

| Tool | Description |
|------|-------------|
| `list_tasks` | List tasks for a project or globally. Filter by status (`todo`, `in_progress`, `done`) |
| `get_task` | Get a task by ID, including its notes |
| `create_task` | Create a new task in CodeFire |
| `update_task` | Update a task (title, description, status, priority) |

## Task Notes

| Tool | Description |
|------|-------------|
| `list_task_notes` | Get all notes for a specific task |
| `create_task_note` | Add a note to a task |

## Notes

| Tool | Description |
|------|-------------|
| `list_notes` | List notes for a project or globally |
| `get_note` | Get a single note by ID |
| `create_note` | Create a new note |
| `update_note` | Update a note |
| `delete_note` | Delete a note by ID |
| `search_notes` | Full-text search across notes |

## Sessions

| Tool | Description |
|------|-------------|
| `list_sessions` | List coding sessions for a project |
| `search_sessions` | Full-text search across session summaries |

## Billing / Clients

| Tool | Description |
|------|-------------|
| `list_clients` | List all billing clients |
| `create_client` | Create a new billing client |

## Images

| Tool | Description |
|------|-------------|
| `list_images` | List generated images for a project |
| `get_image` | Get a generated image by ID, including metadata and file path |
| `generate_image` | Generate an image using AI (requires OpenRouter API key) |
| `edit_image` | Edit an existing image with an AI prompt |

## Code Search

| Tool | Description |
|------|-------------|
| `search_code` | Full-text search across indexed code chunks |
| `context_search` | Semantic code search across the current project |

## Git Operations

| Tool | Description |
|------|-------------|
| `git_status` | Get git status (branch, changed files, clean state) |
| `git_diff` | Get git diff output |
| `git_log` | Get recent commit log entries |
| `git_stage` | Stage files for commit (`git add`) |
| `git_unstage` | Unstage files (`git reset HEAD`) |
| `git_commit` | Create a git commit with the given message |

## Browser Automation

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate the browser to a URL |
| `browser_snapshot` | Get the accessibility tree of the current page |
| `browser_extract` | Extract text content from a page element using CSS selector |
| `browser_screenshot` | Take a PNG screenshot of the current page |
| `browser_click` | Click an element by its ref |
| `browser_type` | Type text into an input or textarea element |
| `browser_select` | Select an option from a `<select>` dropdown |
| `browser_scroll` | Scroll the page by direction/amount |
| `browser_wait` | Wait for an element to appear on the page |
| `browser_press` | Press a key or key combination |
| `browser_eval` | Execute JavaScript on the page (gated behind confirmation) |
| `browser_hover` | Hover over an element |
| `browser_upload` | Set a file on an `<input type="file">` element |
| `browser_drag` | Drag an element to a target element |
| `browser_iframe` | Switch execution context to an iframe |
| `browser_list_tabs` | List all open browser tabs |
| `browser_tab_open` | Open a new browser tab |
| `browser_tab_close` | Close a browser tab by its ID |
| `browser_tab_switch` | Switch the active browser tab |
| `browser_clear_session` | Clear browsing data (cookies, cache, localStorage) |
| `browser_get_cookies` | Get cookies for the current page |
| `browser_set_cookie` | Set a cookie on the current page |
| `browser_get_storage` | Read localStorage or sessionStorage contents |

## Network Inspection

| Tool | Description |
|------|-------------|
| `browser_network_requests` | Get recent network requests captured by the browser |
| `browser_network_clear` | Clear the captured network request log |
| `browser_network_inspect` | Get full details of a specific network request by index |

## Environment Detection

| Tool | Description |
|------|-------------|
| `detect_ai_agents` | Detect installed AI coding agents |
| `detect_coding_agents` | Detect which AI coding agents/CLIs are installed |
| `detect_dev_environment` | Detect development tools and runtimes |
| `detect_project_stack` | Detect the technology stack of the current project |
| `detect_services` | Detect cloud services and deployment platforms |
| `get_system_info` | Returns system information |
| `get_project_environment` | Detect the development environment for a project |

## Environment Configuration

| Tool | Description |
|------|-------------|
| `list_env_files` | List environment files in the project |
| `get_env_variables` | Parse and return variables from a specific environment file |

## Patterns & Architecture

| Tool | Description |
|------|-------------|
| `get_patterns` | List recorded code patterns and conventions |
| `get_project_profile` | Get a comprehensive project profile |

---

## Security Notes

- **`browser_eval`**: Executes arbitrary JavaScript in the browser webview. Gated behind user confirmation to prevent exfiltration via prompt injection.
- **`get_env_variables`**: Returns environment file contents which may contain secrets. Use with caution.
- **`browser_get_cookies` / `browser_get_storage`**: Can access session tokens and sensitive browser state.
- All tools operate locally — no data is sent to external servers by the MCP server itself.
