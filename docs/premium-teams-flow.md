# CodeFire Teams — Setup & Usage Guide

> **Alpha Feature** — Teams is currently in alpha testing with Stripe sandbox keys. No real charges will be made. All data is on a test Supabase instance. Expect rough edges.

---

## Overview

CodeFire Teams adds real-time collaboration to CodeFire: shared projects, tasks, notes, activity feeds, project docs, review requests, and presence indicators. The free open-source version is completely unaffected — Teams is opt-in via a feature flag in Settings.

**Architecture:** Local-first with cloud sync. Your SQLite database remains the source of truth. Supabase handles auth, sync, and real-time features. Stripe handles billing.

---

## 1. Enable Premium Features

**Settings > Team**

1. Toggle **"Enable premium features"** to ON
2. Enter the connection details:
   - **Supabase URL:** `https://hofreldxofygaerodowt.supabase.co`
   - **Supabase Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvZnJlbGR4b2Z5Z2Flcm9kb3d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4Mjc2NjksImV4cCI6MjA4ODQwMzY2OX0.MBwqQBeDfu9uxb99tYTZD54P_U3tjuh2zddMUjTlCuA`
3. Click **Save**

> These are sandbox credentials. In production, the URL and key will be hardcoded into the app.

---

## 2. Create an Account

After enabling premium, the Team settings tab shows a sign-in/sign-up form.

### New user:
1. Click **"Need an account? Sign up"**
2. Enter your **display name**, **email**, and **password**
3. Click **Create Account**
4. You're now authenticated

### Existing user:
1. Enter your **email** and **password**
2. Click **Sign In**

Your auth tokens are stored in the system keychain and persist across app restarts.

---

## 3. Create a Team

Once authenticated, if you don't have a team yet, you'll see a "Create a Team" section.

1. Enter a **team name** (e.g., "Acme Dev Team")
2. The **slug** auto-generates from the name (e.g., `acme-dev-team`) — you can customize it
3. Click **Create Team**

You are automatically the team **owner**. The owner can:
- Invite and remove members
- Manage billing
- Access all synced projects

---

## 4. Subscribe to a Plan

After creating a team, you'll see the subscription options (unless you have an OSS grant).

### Plans

| Plan | Price | Included Seats | Extra Seats | Projects |
|------|-------|----------------|-------------|----------|
| **Starter** | $9/mo | 3 | $3/mo each | 5 |
| **Agency** | $40/mo | 10 | $5/mo each | Unlimited |

### To subscribe:
1. Select **Starter** or **Agency**
2. Optionally adjust the **extra seats** slider
3. Click **Subscribe** — opens Stripe Checkout in your browser
4. Complete payment

> **Sandbox testing:** Use card number `4242 4242 4242 4242`, any future expiry, any CVC.

### After subscribing:
- The "Subscribe" section is replaced by a **Manage Billing** button
- Clicking it opens the Stripe Billing Portal where you can:
  - Change plans
  - Update payment method
  - View invoices
  - Cancel subscription

### Upgrade from Starter to Agency:
- An "Upgrade to Agency" banner appears when you're on the Starter plan
- Click **Upgrade** to switch plans via Stripe Checkout

---

## 5. Invite Team Members

Once your team is created and subscribed (or has a grant):

1. In **Settings > Team > Invite Member**, enter the teammate's email
2. Select their role: **Member** or **Admin**
3. Click **Invite**

### How the invite works:
- An invite record is created in the database with status `pending`
- The invited person can accept via:
  - **Web:** Visit `https://codefire.app/invite?token=<invite-id>` — sign in or create an account, then accept
  - **In-app:** Use the accept invite flow (if they already have the app)

### Roles:
| Role | Permissions |
|------|-------------|
| **Owner** | Full control: billing, members, all data |
| **Admin** | Manage members, access all synced projects |
| **Member** | Access synced projects they're assigned to |

### Remove a member:
- Click the trash icon next to their name in the members list
- Owners cannot be removed; you cannot remove yourself

---

## 6. Sync a Project

To share a local project with your team:

1. Open the project in CodeFire
2. The sync mechanism tracks the project for cloud sync
3. Team members with access can see synced tasks, notes, and activity

> Currently, project sync is triggered via the `premium:syncProject` IPC call. A UI button for this is planned.

---

## 7. Collaboration Features

Once your team is set up and projects are synced, these features become available:

### Activity Feed (Activity tab)
- Shows a chronological timeline of team activity
- Event types: task created/updated, notes added, sessions shared, docs edited, reviews requested
- Each event shows the user, action, and relative timestamp
- Toggle to **Summaries** sub-tab to see shared coding session summaries

### Project Docs (Docs tab)
- Team wiki for each project
- Create, edit, and delete docs
- Auto-saves with 1-second debounce
- Sidebar navigation for switching between docs
- Shows who created and last edited each doc

### Review Requests (Reviews tab)
- Request a code review from a team member on any task
- Select the reviewer and add an optional comment
- Reviewer can **Approve**, **Request Changes**, or **Dismiss**
- Status badges: yellow (pending), green (approved), red (changes requested), gray (dismissed)
- Both requester and reviewer receive notifications

### Notifications (Bell icon in header)
- Unread count badge on the bell icon
- Click to see notification list
- Types: @mentions, review requests, review resolutions
- Mark individual or all notifications as read

### Presence (Avatars in project header)
- Shows which team members are currently viewing the same project
- Compact avatar row with initials
- Real-time updates via Supabase Realtime

### Session Summaries
- Share coding session summaries with your team
- Shows model used, git branch, duration, files changed
- Visible in the Activity tab under "Summaries"

---

## 8. Billing Portal (Web)

Team owners can manage billing from any browser:

1. Visit `https://codefire.app/billing?team=<team-id>`
2. Sign in with your CodeFire account
3. You'll be redirected to the Stripe Billing Portal

---

## 9. OSS Grants

Open-source projects and contributors can receive free Teams access via grants.

Grant types:
- **OSS Project** — free team for an open-source project
- **OSS Contributor** — free access for individual contributors
- **Custom** — ad-hoc grants with custom limits

Grants override the billing requirement. If a team has an active grant, no subscription is needed. Grants can have expiration dates and custom seat/project limits.

> Grants are managed by CodeFire super admins via **Settings > Admin** (visible only to super admins).

---

## 10. Testing with Seed Data

A seed script is included for populating test data:

```bash
cd scripts
./seed-premium-test.sh
```

The script prompts for your credentials and seeds:
- 5 activity events
- 3 project docs
- 2 session summaries
- 3 review requests (pending, approved, changes requested)
- 3 notifications (2 unread)

### Stripe Test Cards

| Card | Behavior |
|------|----------|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined |
| `4000 0025 0000 3155` | Requires 3D Secure |

Use any future expiration date and any 3-digit CVC.

---

## Troubleshooting

**"Premium not configured" error**
- Make sure you've entered both the Supabase URL and Anon Key in Settings > Team > Connection
- Click Save after entering the values

**Sign-in fails**
- Check your email and password
- If you signed up but can't sign in, check if email confirmation is required in the Supabase dashboard

**Billing button does nothing**
- The Stripe Checkout and Billing Portal open in your system browser, not in-app
- Check if your browser blocked a popup

**No activity / empty tabs**
- Activity, Docs, and Reviews require synced projects with team data
- Run the seed script to populate test data

**Notifications not appearing**
- Notifications are polled every 30 seconds
- Check that your user ID matches the notification's `user_id`

---

## Platform Support

| Feature | Electron (Win/Linux) | Swift (macOS) |
|---------|---------------------|---------------|
| Auth & team management | Yes | Yes |
| Billing (Stripe) | Yes | Yes |
| Activity feed | Yes | Yes |
| Project docs | Yes | Yes |
| Review requests | Yes | Yes |
| Notifications | Yes | Yes |
| Presence | Yes | Yes |
| Session summaries | Yes | Yes |
| Invite acceptance (web) | Yes | Yes |
| Billing portal (web) | Yes | Yes |
