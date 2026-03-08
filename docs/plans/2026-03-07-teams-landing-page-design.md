# Teams Landing Page Design

## Overview

A marketing page at `/teams` on codefire.app explaining the benefits of CodeFire for development teams. Targets dev team leads, CTOs, and developers who collaborate. Primary CTA is downloading CodeFire and setting up a team in-app.

## Page Structure

### Section 1: Hero

- **Headline:** "Your team's AI agents should share a brain."
- **Subhead:** When one developer's agent discovers a gotcha, fixes a bug, or makes an architecture decision — every other agent on the team should know about it. CodeFire gives your team shared persistent memory across every AI coding session.
- **CTAs:** "Download CodeFire" → /releases/latest | "Getting Started" → /getting-started

### Section 2: Pain Points (3-column)

Three cards framing the problem:

1. **Context dies between sessions** — Your agent spends the first 5 minutes of every session re-discovering what the last session already knew. Multiply that by every developer on your team.
2. **Knowledge stays siloed** — Dev A fixes a tricky deployment issue. Dev B hits the same issue next week. Their agents have no way to share what was learned.
3. **No visibility into AI-assisted work** — Team leads have no idea what their agents are doing — what tasks are in progress, what decisions were made, or what's blocking progress.

### Section 3: Feature Grid (2x3)

Six feature cards with icon, title, and 2-sentence description:

1. **Shared Task Board** (kanban) — Drag-and-drop Kanban visible to the whole team. When one agent creates or completes a task, every team member's agent sees it instantly.
2. **Shared Notes & Decisions** (notebook-pen) — Architecture decisions, gotchas, and bug patterns captured as persistent notes. Pin critical context so every agent reads it at session start.
3. **Session History** (history) — See what every developer's agent worked on — token usage, tool calls, and session summaries. Full transparency into AI-assisted work.
4. **Semantic Code Search** (search) — Vector + keyword hybrid search across your indexed codebase. Every agent on the team can search by meaning, not just string matching.
5. **Activity Feed** (activity) — Real-time visibility into what's happening across the team — task updates, note creation, session activity, and code changes.
6. **Role-Based Access** (shield-check) — Invite team members as leads, contributors, or viewers. Control who can create tasks, edit notes, and manage the team.

### Section 4: How It Works (3 steps)

1. **Download & create a team** — Install CodeFire, go to Settings, and create a team. Invite your developers by email — they'll get a link to join.
2. **Connect your CLI** — Each developer adds the CodeFire MCP server to their CLI tool. One command for Claude Code, a config snippet for others.
3. **Start coding together** — Every agent on the team now shares tasks, notes, session context, and code search. Context accumulates — sessions get smarter over time.

Links to /getting-started for detailed setup.

### Section 5: Bottom CTA

- **Icon:** flame
- **Headline:** "Give your team shared memory."
- **Subtext:** Free to start. Team plans available in-app.
- **Buttons:** "Download CodeFire" (primary) + "View Getting Started Guide" (secondary)

## Technical Details

- New file: `landing/teams.html`
- Add redirect in `landing/netlify.toml`: `/teams` → `/teams.html`
- Add nav link to Teams page from homepage and other pages
- Matches existing site design: dark theme, Tailwind CDN, Figtree font, Lucide icons, fire/surface color palette, film grain overlay, scroll-triggered reveals
- No JavaScript logic needed beyond existing patterns (scroll reveals, nav scroll effect)
