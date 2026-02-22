# Browser MCP Tools — Phase 2 Design

**Date:** 2026-02-22
**Status:** Approved
**Scope:** Browser interaction tools (click, type, select, scroll, wait)

## Overview

Add 5 interaction tools to the existing 9 read-only browser MCP tools, enabling Claude to click elements, fill forms, select dropdown options, scroll pages, and wait for async content. No permission gates — tools execute immediately, same as Phase 1.

This is Phase 2 of a multi-phase plan:
- **Phase 1 (done):** Read-only browser tools via MCP
- **Phase 2 (this):** Basic interaction (click, type, select, scroll, wait)
- **Phase 3:** JS execution, hover, keyboard events
- **Phase 4:** Agentic task mode, multi-service workflows

## Architecture

Identical to Phase 1. No new patterns, no schema changes, no new dependencies.

```
Claude Code → ContextMCP → INSERT browserCommands → GUI polls (100ms)
    → BrowserCommandExecutor dispatches → JS on WKWebView (.defaultClient world)
    → Result written back → ContextMCP polls (50ms) → Returns to Claude
```

### New Code Locations

| Component | File | Change |
|-----------|------|--------|
| 5 tool definitions | `ContextMCP/main.swift` | Add to `toolDefinitions()`, `handleToolCall`, 5 wrapper functions |
| 5 handler methods | `BrowserCommandExecutor.swift` | `handleClick`, `handleType`, `handleSelect`, `handleScroll`, `handleWait` |
| 5 JS interaction methods | `BrowserTab.swift` | Async methods using `callAsyncJavaScript` in `.defaultClient` world |

### Key Design Decisions

- **Ref-only targeting:** All tools target elements by `data-ax-ref` attribute (stamped by `browser_snapshot`). Claude must snapshot before interacting. Exception: `browser_wait` also accepts CSS selectors since the target element may not exist yet.
- **No permission gates:** Tools execute immediately, same trust model as Phase 1.
- **React/framework compatibility:** Type and select tools use the native value setter workaround + synthetic event dispatching to trigger framework change handlers.
- **Scroll-before-click:** `browser_click` automatically scrolls the element into view before clicking.
- **JS-side wait polling:** `browser_wait` polls inside JS (100ms intervals) rather than doing multiple SQLite round-trips.

## MCP Tool Definitions

### 1. `browser_click`

Click an element identified by its accessibility tree ref.

```json
{
    "name": "browser_click",
    "description": "Click an element by its ref from browser_snapshot. Automatically scrolls the element into view first.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "ref": { "type": "string", "description": "Element ref from browser_snapshot (e.g. 'e5')" },
            "tab_id": { "type": "string", "description": "Tab ID (defaults to active tab)" }
        },
        "required": ["ref"]
    }
}
```

**Returns:** `{ "clicked": true, "tag": "BUTTON", "text": "Submit" }`
**Errors:** `"Element with ref 'e5' not found. The page may have changed — use browser_snapshot to get fresh refs."`

**JS implementation:**
```js
const el = document.querySelector('[data-ax-ref="REF"]');
if (!el) return { error: "not_found" };
el.scrollIntoView({block: 'center', behavior: 'instant'});
el.focus();
el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
return { clicked: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 100) };
```

Uses `MouseEvent` with `bubbles: true` so event delegation (React/Vue) works. For `<a>` tags, native navigation proceeds if the click isn't `preventDefault()`'d. If a click triggers page navigation, `callAsyncJavaScript` may throw — catch and return: `"Click triggered navigation. Use browser_snapshot to see the new page."`

### 2. `browser_type`

Type text into an input element. Clears existing content by default.

```json
{
    "name": "browser_type",
    "description": "Type text into an input or textarea element by ref. Clears existing content by default. Works with React and other framework-controlled inputs.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "ref": { "type": "string", "description": "Element ref from browser_snapshot" },
            "text": { "type": "string", "description": "Text to type" },
            "clear": { "type": "boolean", "description": "Clear existing content first (default: true)" },
            "tab_id": { "type": "string", "description": "Tab ID (defaults to active tab)" }
        },
        "required": ["ref", "text"]
    }
}
```

**Returns:** `{ "typed": true, "ref": "e3", "value": "hello@example.com" }`
**Errors:** `"Element 'e5' (BUTTON) is not a text input."`

**JS implementation:**
```js
const el = document.querySelector('[data-ax-ref="REF"]');
if (!el) return { error: "not_found" };
const tag = el.tagName;
const editable = (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable);
if (!editable) return { error: "not_typeable", tag: tag };

el.focus();
if (clear) {
    // Use native setter to clear (React-compatible)
    const setter = Object.getOwnPropertyDescriptor(
        tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
    )?.set;
    if (setter) setter.call(el, '');
    el.dispatchEvent(new Event('input', {bubbles: true}));
}

// Set value via native setter for React compatibility
const setter = Object.getOwnPropertyDescriptor(
    tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
)?.set;
if (setter) setter.call(el, text);
else el.value = text;

el.dispatchEvent(new Event('input', {bubbles: true}));
el.dispatchEvent(new Event('change', {bubbles: true}));
return { typed: true, ref: ref, value: el.value };
```

### 3. `browser_select`

Select an option from a `<select>` dropdown by value or visible label.

```json
{
    "name": "browser_select",
    "description": "Select an option from a <select> dropdown by value or visible label text.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "ref": { "type": "string", "description": "Element ref of the <select> element" },
            "value": { "type": "string", "description": "Option value to select" },
            "label": { "type": "string", "description": "Option visible text to select (alternative to value)" },
            "tab_id": { "type": "string", "description": "Tab ID (defaults to active tab)" }
        },
        "required": ["ref"]
    }
}
```

**Returns:** `{ "selected": true, "value": "us-east-1", "label": "US East (N. Virginia)" }`
**Errors:** `"No option matching value 'xyz'. Available options: [{'value': 'us-east-1', 'label': 'US East'}, ...]"`

**JS implementation:**
```js
const el = document.querySelector('[data-ax-ref="REF"]');
if (!el || el.tagName !== 'SELECT') return { error: "not_select", tag: el?.tagName };

const options = Array.from(el.options);
let target;
if (value) target = options.find(o => o.value === value);
else if (label) target = options.find(o => o.text.trim() === label);

if (!target) {
    return { error: "no_match", available: options.map(o => ({value: o.value, label: o.text.trim()})) };
}

// Use native setter for React compatibility
const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
if (setter) setter.call(el, target.value);
else el.value = target.value;

el.dispatchEvent(new Event('change', {bubbles: true}));
return { selected: true, value: target.value, label: target.text.trim() };
```

### 4. `browser_scroll`

Scroll the page or scroll a specific element into view.

```json
{
    "name": "browser_scroll",
    "description": "Scroll the page by direction/amount, or scroll a specific element into view. Returns scroll position to help gauge remaining content.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "ref": { "type": "string", "description": "Scroll this element into view (overrides direction/amount)" },
            "direction": { "type": "string", "description": "Scroll direction: up, down, top, bottom", "enum": ["up", "down", "top", "bottom"] },
            "amount": { "type": "integer", "description": "Pixels to scroll (default: 500). Ignored for top/bottom." },
            "tab_id": { "type": "string", "description": "Tab ID (defaults to active tab)" }
        }
    }
}
```

**Returns:** `{ "scrolled": true, "scrollY": 1200, "scrollHeight": 4500, "viewportHeight": 900 }`

**JS implementation:**
```js
if (ref) {
    const el = document.querySelector('[data-ax-ref="REF"]');
    if (!el) return { error: "not_found" };
    el.scrollIntoView({block: 'center', behavior: 'instant'});
} else {
    const amt = amount || 500;
    switch (direction) {
        case 'down':  window.scrollBy(0, amt); break;
        case 'up':    window.scrollBy(0, -amt); break;
        case 'top':   window.scrollTo(0, 0); break;
        case 'bottom': window.scrollTo(0, document.body.scrollHeight); break;
    }
}
return {
    scrolled: true,
    scrollY: Math.round(window.scrollY),
    scrollHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight
};
```

### 5. `browser_wait`

Wait for an element to appear in the DOM. Useful after clicks that trigger async content loads.

```json
{
    "name": "browser_wait",
    "description": "Wait for an element to appear on the page. Use after clicking something that triggers async loading. Accepts a ref from a previous snapshot or a CSS selector for elements that don't exist yet.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "ref": { "type": "string", "description": "Wait for element with this ref to exist" },
            "selector": { "type": "string", "description": "CSS selector to wait for (use when element doesn't have a ref yet)" },
            "timeout": { "type": "integer", "description": "Max seconds to wait (default: 5, max: 15)" },
            "tab_id": { "type": "string", "description": "Tab ID (defaults to active tab)" }
        }
    }
}
```

**Returns:** `{ "found": true, "elapsed_ms": 1200 }` or `{ "found": false, "elapsed_ms": 5000 }`

Not an error on timeout — Claude decides whether to retry.

**JS implementation:**
```js
const maxMs = Math.min((timeout || 5), 15) * 1000;
const query = ref ? '[data-ax-ref="' + ref + '"]' : selector;
if (!query) return { error: "missing_param", message: "Provide ref or selector" };

const start = Date.now();
return new Promise((resolve) => {
    const check = () => {
        if (document.querySelector(query)) {
            resolve({ found: true, elapsed_ms: Date.now() - start });
        } else if (Date.now() - start >= maxMs) {
            resolve({ found: false, elapsed_ms: Date.now() - start });
        } else {
            setTimeout(check, 100);
        }
    };
    check();
});
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Stale ref (element not found) | Return error with message to re-snapshot |
| Type into non-input | Return error with element tag name |
| Select with no matching option | Return error with list of available options |
| Click triggers navigation | Catch JS error, return success with navigation note |
| Wait timeout | Return `found: false` (not an error) |
| Page not loaded | Standard "no active tab" error from Phase 1 |

## Example Workflow

```
Claude: browser_navigate("https://myapp.com/login")
Claude: browser_snapshot()
        → heading "Sign In" [level=1]
          textbox "Email" [ref=e3]
          textbox "Password" [ref=e4]
          button "Sign In" [ref=e5]
          link "Forgot password?" [ref=e6]

Claude: browser_type(ref="e3", text="user@test.com")
        → { typed: true, value: "user@test.com" }

Claude: browser_type(ref="e4", text="password123")
        → { typed: true, value: "password123" }

Claude: browser_click(ref="e5")
        → { clicked: true, tag: "BUTTON", text: "Sign In" }

Claude: browser_wait(selector=".dashboard")
        → { found: true, elapsed_ms: 800 }

Claude: browser_snapshot()
        → heading "Dashboard" [level=1]
          region "Stats"
            ...
```

## Out of Scope (Phase 3+)

- JavaScript execution tool
- Hover events / tooltip triggering
- Keyboard events (Enter, Escape, Tab, arrows)
- Drag and drop
- File upload
- iframe traversal
- Domain allowlisting / permission tiers
- Agentic task orchestration mode

## Estimated Scope

~300 lines new code across 3 files. No schema changes, no new dependencies. Same IPC pattern as Phase 1.
