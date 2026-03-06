# Premium Teams — Design Document

**Date:** 2026-03-06
**Status:** Approved
**Scope:** Both Swift and Electron apps

---

## Overview

CodeFire Premium adds collaborative features to the app: shared projects, tasks, notes, session summaries, and real-time presence. It uses Supabase as the sync backend and Stripe for billing. The open source version is completely unaffected — premium is an opt-in module activated via a "Set up team" toggle in Settings.

### Core Principles

1. **Local-primary** — SQLite remains the source of truth. Supabase is a sync target, not a replacement.
2. **Zero impact on free users** — If premium is never enabled, no Supabase connections, no auth UI, no sync overhead.
3. **Graceful degradation** — If subscription lapses or connectivity drops, local features work exactly as before. Sync pauses, data stays intact.
4. **Open source friendly** — OSS repo owners get free agency-tier access. Contributors get free seats.

---

## Architecture

### Module Separation

```
CodeFire App (Swift / Electron)

  Core (open source, unchanged)
    SQLite DB -> DAOs -> IPC -> Renderer

           | (optional bridge, event-based)

  Premium Module (feature-flagged)
    SyncEngine -> Supabase
    AuthService -> Supabase Auth
    BillingService -> Stripe
    ActivityFeed, Presence, Mentions, Docs, Reviews
```

The core app never imports from the premium module. The premium module hooks into the core via event listeners and the existing DAO layer. Deleting the premium folder leaves the app fully functional.

**Feature flag:** `premiumEnabled: boolean` in AppConfig. Default false.

### Supabase Project Structure

- **Auth** — Email/password (GitHub OAuth later)
- **Database** — Postgres with Row Level Security
- **Realtime** — Subscriptions for live sync + ephemeral presence
- **Edge Functions** — Stripe webhooks, mention notifications, invite emails
- **RLS** — All tables scoped to team membership + active subscription

---

## Data Model

### Supabase Tables

#### Identity and Teams

```sql
users
  id                  uuid (PK, from Supabase Auth)
  email               text
  display_name        text
  avatar_url          text?
  created_at          timestamptz

teams
  id                  uuid (PK)
  name                text
  slug                text (unique, URL-friendly)
  owner_id            uuid (FK -> users)
  stripe_customer_id  text?
  stripe_subscription_id text?
  plan                text ('starter' | 'agency')
  seat_limit          int
  project_limit       int?              -- null = unlimited (agency)
  created_at          timestamptz

team_members
  team_id             uuid (FK -> teams)
  user_id             uuid (FK -> users)
  role                text ('owner' | 'admin' | 'member')
  joined_at           timestamptz
  PRIMARY KEY (team_id, user_id)

super_admins
  user_id             uuid (PK, FK -> users)
  granted_at          timestamptz

team_grants
  id                  uuid (PK)
  team_id             uuid (FK -> teams)
  grant_type          text ('oss_project' | 'oss_contributor' | 'custom')
  plan_tier           text ('starter' | 'agency')
  seat_limit          int?              -- null = use plan default
  project_limit       int?              -- null = use plan default
  repo_url            text?             -- verified OSS repo for oss_project grants
  granted_by          uuid (FK -> users, super_admin)
  note                text?
  expires_at          timestamptz?      -- null = permanent
  created_at          timestamptz
```

#### Synced Projects

```sql
synced_projects
  id                  uuid (PK, matches local project ID)
  team_id             uuid (FK -> teams)
  name                text
  repo_url            text?
  tags                text?
  created_by          uuid (FK -> users)
  created_at          timestamptz
  updated_at          timestamptz

project_members
  project_id          uuid (FK -> synced_projects)
  user_id             uuid (FK -> users)
  role                text ('lead' | 'contributor' | 'viewer')
  added_at            timestamptz
  PRIMARY KEY (project_id, user_id)
```

#### Synced Tasks

```sql
synced_tasks
  id                  uuid (PK)
  local_id            int?
  project_id          uuid (FK -> synced_projects)
  title               text
  description         text?
  status              text ('todo' | 'in_progress' | 'done')
  priority            int (0-4)
  labels              jsonb
  assigned_to         uuid? (FK -> users)
  created_by          uuid (FK -> users)
  source              text
  created_at          timestamptz
  completed_at        timestamptz?
  updated_at          timestamptz

synced_task_notes
  id                  uuid (PK)
  task_id             uuid (FK -> synced_tasks)
  content             text
  created_by          uuid (FK -> users)
  mentions            uuid[]
  source              text
  created_at          timestamptz
```

#### Synced Notes

```sql
synced_notes
  id                  uuid (PK)
  project_id          uuid (FK -> synced_projects)
  title               text
  content             text
  pinned              boolean
  created_by          uuid (FK -> users)
  created_at          timestamptz
  updated_at          timestamptz
```

#### Collaboration Features

```sql
activity_events
  id                  uuid (PK)
  project_id          uuid (FK -> synced_projects)
  user_id             uuid (FK -> users)
  event_type          text ('task_created' | 'task_completed' | 'task_assigned' |
                            'note_created' | 'note_pinned' | 'session_shared' |
                            'review_requested' | 'review_approved' | 'mention')
  entity_type         text ('task' | 'note' | 'session' | 'review')
  entity_id           uuid
  metadata            jsonb
  created_at          timestamptz

session_summaries
  id                  uuid (PK)
  project_id          uuid (FK -> synced_projects)
  user_id             uuid (FK -> users)
  session_slug        text?
  model               text?
  git_branch          text?
  summary             text
  files_changed       jsonb
  duration_mins       int?
  started_at          timestamptz?
  ended_at            timestamptz?
  shared_at           timestamptz

project_docs
  id                  uuid (PK)
  project_id          uuid (FK -> synced_projects)
  title               text
  content             text              -- markdown
  sort_order          int
  created_by          uuid (FK -> users)
  last_edited_by      uuid? (FK -> users)
  created_at          timestamptz
  updated_at          timestamptz

review_requests
  id                  uuid (PK)
  project_id          uuid (FK -> synced_projects)
  task_id             uuid (FK -> synced_tasks)
  requested_by        uuid (FK -> users)
  assigned_to         uuid (FK -> users)
  status              text ('pending' | 'approved' | 'changes_requested' | 'dismissed')
  comment             text?
  created_at          timestamptz
  resolved_at         timestamptz?

notifications
  id                  uuid (PK)
  user_id             uuid (FK -> users)
  project_id          uuid (FK -> synced_projects)
  type                text ('mention' | 'assignment' | 'review_request' | 'review_resolved')
  title               text
  body                text?
  entity_type         text
  entity_id           uuid
  is_read             boolean default false
  created_at          timestamptz
```

#### Invites

```sql
team_invites
  id                  uuid (PK)
  team_id             uuid (FK -> teams)
  email               text
  role                text ('admin' | 'member')
  invited_by          uuid (FK -> users)
  status              text ('pending' | 'accepted' | 'expired')
  token               text (unique)
  created_at          timestamptz
  expires_at          timestamptz       -- 7 days
```

### Local SQLite Additions

One table for sync bookkeeping. Core schema untouched.

```sql
sync_state
  entity_type         text              -- 'task' | 'note' | 'project'
  local_id            text
  remote_id           text              -- Supabase UUID
  last_synced_at      text
  dirty               integer           -- 1 = local changes not yet pushed
  PRIMARY KEY (entity_type, local_id)
```

SQLite triggers on synced tables (tasks, notes) automatically set `dirty = 1` on local changes. Existing DAOs remain unchanged.

### Presence (Ephemeral)

No database table. Uses Supabase Realtime channels:

```typescript
channel.track({
  user_id: 'uuid',
  display_name: 'Nick',
  active_file: 'src/main/index.ts',
  git_branch: 'feature/premium',
  online_at: new Date().toISOString()
})
```

---

## Sync Engine

### Change Tracking

SQLite triggers on synced tables flag dirty records:

```sql
CREATE TRIGGER IF NOT EXISTS sync_task_dirty
AFTER UPDATE ON tasks
BEGIN
  INSERT OR REPLACE INTO sync_state (entity_type, local_id, remote_id, last_synced_at, dirty)
  VALUES ('task', NEW.id,
    (SELECT remote_id FROM sync_state WHERE entity_type='task' AND local_id=NEW.id),
    (SELECT last_synced_at FROM sync_state WHERE entity_type='task' AND local_id=NEW.id),
    1);
END;
```

### Push Flow (Local -> Supabase)

Every 5 seconds (debounced):
1. Query `sync_state WHERE dirty = 1`
2. Read full entity from local SQLite
3. Map local fields to Supabase columns
4. Batch upsert to Supabase
5. On success: `dirty = 0`, update `last_synced_at`
6. On conflict: run conflict resolution

### Pull Flow (Supabase -> Local)

Supabase Realtime subscriptions (no polling):
1. Subscribe to `postgres_changes` on synced tables filtered by project_id
2. On remote change: look up sync_state for the remote_id
3. If `dirty = 0`: safe to apply locally
4. If `dirty = 1`: conflict resolution
5. If no mapping: new entity from teammate, insert locally

### Conflict Resolution

**V1: Whole-record last-write-wins** using `updated_at` timestamps. The record with the more recent `updated_at` wins entirely.

**Future: Per-field LWW** if users report conflicts. Fields are compared individually by their last-modified timestamps.

Rationale: Dev teams rarely edit the same task simultaneously. Whole-record LWW is simple, predictable, and sufficient for launch.

### Offline Resilience

- **Online:** Push every 5s, pull via Realtime subscription
- **Offline:** Changes accumulate as `dirty = 1` in sync_state
- **Reconnect:** Batch push all dirty records, pull all changes since `last_synced_at`, re-establish subscriptions

---

## Authentication

### Flow

1. User clicks "Set up team (premium)" in Settings
2. Create account or sign in (email/password, GitHub OAuth later)
3. Consent disclosure: "This enables cloud sync for selected project data"
4. New user: Create team -> Stripe checkout -> Enable sync
5. Existing team: Join via invite -> Enable sync

### Supabase Auth

Email/password as primary method. Supabase handles:
- Account creation and email verification
- Session tokens (JWT) stored securely by the Supabase client
- Token refresh

---

## Billing

### Plans

| Plan | Base Price | Included Seats | Extra Seats | Max Seats | Projects |
|------|-----------|---------------|-------------|-----------|----------|
| Starter | $9/mo | 2 | $7/seat | 5 | 5 |
| Agency | $40/mo | 1 | $10/seat | Unlimited | Unlimited |

### Stripe Integration

Products and prices configured in Stripe. Supabase Edge Functions handle webhooks:

- `checkout.session.completed` -> Activate team subscription
- `invoice.paid` -> Keep active
- `invoice.payment_failed` -> 7-day grace period, then pause sync
- `customer.subscription.updated` -> Seat count changes
- `customer.subscription.deleted` -> Downgrade to free (sync stops, local data intact)

### Subscription Enforcement

Server-side via RLS policies (authoritative). Client-side for UX (show upgrade prompts, not errors).

Billing logic waterfall:
1. Has active `team_grant`? -> Use grant's plan_tier and limits
2. Has active Stripe subscription? -> Use paid plan
3. Neither? -> Free tier (local only, no sync)

### OSS Grants

Super admins (designated in `super_admins` table) can grant free premium access:

| Grant Type | Recipient | Access |
|---|---|---|
| `oss_project` | Verified OSS repo owner | Agency-tier, manages own team, linked to repo URL |
| `oss_contributor` | CodeFire contributors | Seat on a sponsored team |
| `custom` | Beta testers, speakers, etc. | Flexible plan and limits |

Grants bypass Stripe entirely. Admin panel allows searching by email, granting/revoking, and adding notes.

---

## Collaboration Features

### Activity Feed

Per-project chronological timeline. Events generated server-side by Supabase triggers on synced tables. Displays user, action, entity, and timestamp.

### @Mentions

Parsed from `@display_name` in task note content. Resolved to user UUIDs and stored in `mentions` array. Supabase trigger fires Edge Function to create in-app notification. V1 is in-app notifications only (bell icon with unread count). Email notifications later.

### Shared Session Summaries

When a coding session ends on a synced project, the user is prompted to share the AI-generated summary. "Always share" preference available per project. Summary includes: model, branch, files changed, duration, and the summary text.

### Project Docs (Wiki)

Markdown documents per project with sidebar navigation and drag-to-reorder. Lock-based editing for V1: when someone is editing, others see "Sarah is editing" and wait. Tracks `created_by` and `last_edited_by`.

### Review Requests

Lightweight task verification. When marking a task "done", optionally request review from a teammate. Reviewer can approve (stays done), request changes (moves back to in_progress), or dismiss. Generates activity events and notifications.

### Presence

Ephemeral via Supabase Realtime channels. Shows teammate avatars in project header with online/idle/offline status. Optional: current git branch and active file. No database storage. Auto-removed on disconnect.

---

## UI Integration

### Settings — Team Tab

New tab in Settings. Before setup: description, consent disclosure, "Set up Team" button. After setup: team name, plan, member list, invite button, billing link, project sync toggles.

### Project Layout

Synced projects gain:
- Presence avatars in header
- Sync status indicator
- New tabs: Docs, Activity
- Task cards show: assigned_to, created_by
- Note cards show: created_by, updated_at

Non-synced projects are visually identical to today.

### Notification Bell

Top-right of app. Shows unread count badge. Dropdown lists recent notifications (mentions, assignments, review requests). "Mark all read" action.

### Super Admin Panel

Visible only to super admins. Settings section or separate view. Search users by email, manage team grants (create/revoke), view all active grants.

---

## What Syncs When

| Event | Sync Action |
|---|---|
| Create/edit/complete task | Mark dirty -> push on next cycle |
| Create/edit/pin note | Mark dirty -> push on next cycle |
| Teammate creates task | Realtime -> insert locally |
| Task assigned to you | Realtime -> insert + notification |
| @mention in task note | Push -> Edge Function -> notification |
| Session ends (shared) | Push summary -> activity event |
| User goes offline | Accumulate dirty, sync on reconnect |
| Subscription lapses | Sync pauses, local data intact, banner shown |

## Data That Never Syncs

- Live session state (terminal PTY output, token counts)
- Terminal sessions
- Browser commands and screenshots
- Code index and embeddings
- Gmail data
- Chat conversations
- Recordings and transcripts
- Briefings
- App config and preferences (except notification prefs)
