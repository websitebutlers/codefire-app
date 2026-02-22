# Browser MCP Tools — Phase 3 Design

**Date:** 2026-02-22
**Status:** Approved
**Scope:** JS execution, keyboard events, hover

## Overview

Add 3 tools to the existing 14 browser MCP tools: `browser_press` (keyboard events), `browser_eval` (arbitrary JS execution), and `browser_hover` (mouseover/mouseenter). No permission gates — tools execute immediately, same as Phase 1 & 2.

This is Phase 3 of a multi-phase plan:
- **Phase 1 (done):** Read-only browser tools via MCP
- **Phase 2 (done):** Basic interaction (click, type, select, scroll, wait)
- **Phase 3 (this):** JS execution, keyboard events, hover
- **Phase 4:** Agentic task mode, multi-service workflows

## Architecture

Identical to Phase 1 & 2. No new patterns, no schema changes, no new dependencies.

```
Claude Code → ContextMCP → INSERT browserCommands → GUI polls (100ms)
    → BrowserCommandExecutor dispatches → JS on WKWebView (.defaultClient world)
    → Result written back → ContextMCP polls (50ms) → Returns to Claude
```

### New Code Locations

| Component | File | Change |
|-----------|------|--------|
| 3 tool definitions | `ContextMCP/main.swift` | Add to `toolDefinitions()`, `handleToolCall`, 3 wrapper functions |
| 3 handler methods | `BrowserCommandExecutor.swift` | `handlePress`, `handleEval`, `handleHover` |
| 3 JS methods | `BrowserTab.swift` | `pressKey(ref:key:modifiers:)`, `evalJavaScript(expression:)`, `hoverElement(ref:)` |

### Timeouts

- `browser_press`: 5s (standard)
- `browser_eval`: 10s (JS could be doing async work)
- `browser_hover`: 5s (standard)

## MCP Tool Definitions

### 1. `browser_press`

Press a key or key combination, optionally targeting a specific element.

```json
{
    "name": "browser_press",
    "description": "Press a key or key combination. Targets a specific element by ref, or the currently focused element if no ref is provided.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "key": { "type": "string", "description": "Key to press: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space, Delete, Home, End, PageUp, PageDown, or any single character" },
            "modifiers": {
                "type": "array",
                "items": { "type": "string", "enum": ["shift", "ctrl", "alt", "meta"] },
                "description": "Modifier keys to hold (e.g. ['meta'] for Cmd+key on Mac)"
            },
            "ref": { "type": "string", "description": "Element ref to target (defaults to focused element)" },
            "tab_id": { "type": "string", "description": "Tab ID (defaults to active tab)" }
        },
        "required": ["key"]
    }
}
```

**Returns:** `{ "pressed": true, "key": "Enter", "modifiers": [], "target": "INPUT" }`
**Errors:** `"No element is focused. Provide a ref or click an element first."` or `"Unknown key 'Foo'."`

**JS implementation:**
```js
const el = ref
    ? document.querySelector('[data-ax-ref="' + ref + '"]')
    : document.activeElement;
if (!el) return { error: ref ? "not_found" : "no_focused_element" };

const opts = {
    key: key,
    code: keyCodeMap[key] || ('Key' + key.toUpperCase()),
    bubbles: true, cancelable: true, view: window,
    shiftKey: modifiers.includes('shift'),
    ctrlKey: modifiers.includes('ctrl'),
    altKey: modifiers.includes('alt'),
    metaKey: modifiers.includes('meta')
};

if (ref) el.focus();
el.dispatchEvent(new KeyboardEvent('keydown', opts));
if (key.length === 1) el.dispatchEvent(new KeyboardEvent('keypress', opts));
el.dispatchEvent(new KeyboardEvent('keyup', opts));

// Handle native behaviors that synthetic events don't trigger
if (key === 'Enter') {
    const form = el.closest('form');
    if (form) form.requestSubmit();
    else if (el.tagName === 'A' || el.tagName === 'BUTTON') el.click();
} else if (key === 'Tab') {
    const focusable = Array.from(document.querySelectorAll(
        'a,button,input,textarea,select,[tabindex]:not([tabindex="-1"])'
    )).filter(e => !e.disabled && e.offsetParent !== null);
    const idx = focusable.indexOf(el);
    const next = modifiers.includes('shift')
        ? focusable[idx - 1] || focusable[focusable.length - 1]
        : focusable[idx + 1] || focusable[0];
    if (next) next.focus();
}

return { pressed: true, key: key, modifiers: modifiers || [], target: el.tagName };
```

### 2. `browser_eval`

Execute arbitrary JavaScript on the page and return the result.

```json
{
    "name": "browser_eval",
    "description": "Execute JavaScript on the page and return the result. The expression is evaluated and its return value is serialized as JSON. Use for reading page state, calling APIs, or handling edge cases other tools can't cover.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "expression": { "type": "string", "description": "JavaScript expression or statement to evaluate. Use 'return' to return a value." },
            "tab_id": { "type": "string", "description": "Tab ID (defaults to active tab)" }
        },
        "required": ["expression"]
    }
}
```

**Returns:** `{ "result": <serialized return value> }` or `{ "error": "ReferenceError: foo is not defined" }`

**JS implementation:**

The expression is passed directly to `callAsyncJavaScript`, which wraps it in an async function body. This means:
- `return document.title` works (returns the title)
- `return await fetch('/api/user').then(r => r.json())` works (async)
- If the expression throws, catch and return `{ "error": errorMessage }`
- If the result is `undefined`, return `{ "result": null }`
- If the result is not JSON-serializable, return `{ "error": "Result is not JSON-serializable" }`

No additional JS wrapper needed — `callAsyncJavaScript` already provides the execution context.

### 3. `browser_hover`

Hover over an element to trigger mouseenter/mouseover events.

```json
{
    "name": "browser_hover",
    "description": "Hover over an element by ref. Triggers mouseenter and mouseover events. Useful for dropdown menus, tooltips, and hover-state UI.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "ref": { "type": "string", "description": "Element ref from browser_snapshot" },
            "tab_id": { "type": "string", "description": "Tab ID (defaults to active tab)" }
        },
        "required": ["ref"]
    }
}
```

**Returns:** `{ "hovered": true, "tag": "LI", "text": "Settings" }`
**Errors:** `"Element with ref 'e5' not found. The page may have changed — use browser_snapshot to get fresh refs."`

**JS implementation:**
```js
const el = document.querySelector('[data-ax-ref="' + ref + '"]');
if (!el) return { error: "not_found" };
el.scrollIntoView({block: 'center', behavior: 'instant'});
el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: false, cancelable: false, view: window}));
el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, cancelable: true, view: window}));
return { hovered: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 100) };
```

Note: `mouseenter` does NOT bubble (per spec), while `mouseover` does. Both are dispatched so frameworks using either event model work correctly.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Stale ref (element not found) | Return error with message to re-snapshot |
| `browser_press` with no ref and no focused element | Return `{ "error": "no_focused_element" }` |
| `browser_press` Enter inside a `<form>` | Dispatch keyboard events + call `form.requestSubmit()` |
| `browser_press` Enter on a link/button | Dispatch keyboard events + call `el.click()` |
| `browser_press` Tab | Dispatch keyboard events + move focus to next focusable element |
| `browser_press` unknown key name | Return `{ "error": "unknown_key" }` with list of supported keys |
| `browser_eval` throws | Catch and return `{ "error": "TypeError: ..." }` (not a tool error) |
| `browser_eval` returns undefined | Return `{ "result": null }` |
| `browser_eval` returns non-serializable | Return `{ "error": "Result is not JSON-serializable" }` |
| `browser_eval` hangs | IPC polling timeout (10s) returns timeout error |
| `browser_hover` triggers navigation | Same as click — catch and return navigation note |

## Example Workflow

```
Claude: browser_navigate("https://myapp.com/search")
Claude: browser_snapshot()
        → textbox "Search" [ref=e3]
          button "Search" [ref=e4]
          navigation
            listitem
              link "Settings" [ref=e7]

Claude: browser_type(ref="e3", text="browser automation")
        → { typed: true, value: "browser automation" }

Claude: browser_press(key="Enter")
        → { pressed: true, key: "Enter", target: "INPUT" }
        (form.requestSubmit() fires, page navigates to results)

Claude: browser_snapshot()
        → heading "Results for 'browser automation'"
          ...

Claude: browser_hover(ref="e7")
        → { hovered: true, tag: "LI", text: "Settings" }
        (dropdown menu appears)

Claude: browser_snapshot()
        → menu "Settings"
          menuitem "Profile" [ref=e12]
          menuitem "Preferences" [ref=e13]

Claude: browser_eval(expression="return localStorage.getItem('user_theme')")
        → { result: "dark" }
```

## Out of Scope (Phase 4+)

- Drag and drop
- File upload
- iframe traversal
- Domain allowlisting / permission tiers
- Agentic task orchestration mode
- Prompt injection defenses
- Session isolation per agent task
- Persistent login sessions

## Estimated Scope

~200 lines new code across 3 files. No schema changes, no new dependencies. Same IPC pattern as Phase 1 & 2. Brings total tool count from 14 to 17.
