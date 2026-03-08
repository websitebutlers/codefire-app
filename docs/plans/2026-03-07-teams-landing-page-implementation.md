# Teams Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a marketing page at `/teams` on codefire.app explaining CodeFire's team collaboration features.

**Architecture:** Single static HTML page matching existing site design (Tailwind CDN, Figtree font, Lucide icons, dark fire/surface theme). Add Netlify redirect and nav links.

**Tech Stack:** HTML, Tailwind CSS (CDN), Lucide Icons, Netlify

---

### Task 1: Add Netlify redirect for /teams

**Files:**
- Modify: `landing/netlify.toml`

**Step 1: Add the redirect rule**

Add before the `/*` catch-all redirect (which must remain last):

```toml
[[redirects]]
  from = "/teams"
  to = "/teams.html"
  status = 200
```

**Step 2: Commit**

```bash
git add landing/netlify.toml
git commit -m "chore: add /teams redirect to netlify config"
```

---

### Task 2: Create teams.html with full page content

**Files:**
- Create: `landing/teams.html`

**Reference files for patterns:**
- `landing/getting-started.html` — nav, footer, step-number styling, reveal animations, section-divider
- `landing/index.html` — hero pattern, feature-card class, animation keyframes

**Step 1: Create the page**

The page has these sections in order:

1. **Head** — Same as getting-started.html: Tailwind config (fire/surface colors, Figtree font), film grain overlay, nav-scrolled, text-fire-gradient, section-divider, reveal animations, step-number styles. Add feature-card style from index.html.

2. **Nav** — Identical to getting-started.html nav, but add a "Teams" link alongside "Features" and "Docs":
```html
<a href="/teams" class="hidden sm:block text-sm text-fire-400 transition-colors">Teams</a>
```

3. **Hero section** — Pattern from getting-started.html hero but with:
   - `bg-grid` background
   - Headline: `Your team's AI agents should share a brain.`
   - Subhead paragraph (the approved copy)
   - Two CTA buttons: "Download CodeFire" (bg-fire-500, links to releases/latest) and "Getting Started" (border outline, links to /getting-started)

4. **Pain points section** — Three columns using `reveal` class:
   - Each card: `bg-surface-50 border border-surface-200 rounded-2xl p-8`
   - Icon above title (Lucide): `timer` for context dies, `lock` for knowledge siloed, `eye-off` for no visibility
   - Title in `text-white font-semibold`
   - Body in `text-sm text-gray-400`
   - Use approved copy from design doc

5. **Feature grid** — 2x3 grid using `grid grid-cols-1 md:grid-cols-2 gap-6`:
   - Each card: `feature-card bg-surface-50 border border-surface-200 rounded-2xl p-8`
   - Lucide icon (32x32, text-fire-400) + title (text-white font-semibold text-lg) + description (text-sm text-gray-400)
   - Six features with icons from design doc: `kanban`, `notebook-pen`, `history`, `search`, `activity`, `shield-check`

6. **How it works** — Three steps using step-number styling:
   - Step 1: Download & create a team (icon: download)
   - Step 2: Connect your CLI (icon: terminal)
   - Step 3: Start coding together (icon: rocket)
   - Use approved copy. Link "Getting Started guide" to /getting-started.

7. **Bottom CTA** — Match the "You're all set" card from getting-started.html:
   - `rounded-2xl border border-surface-200 p-12 md:p-16 text-center` with fire gradient overlay
   - Flame icon, headline "Give your team shared memory.", subtext "Free to start. Team plans available in-app."
   - Two buttons: "Download CodeFire" (primary) + "View Getting Started Guide" (secondary)

8. **Footer** — Identical to getting-started.html footer.

9. **Scripts** — Same scroll reveal observer + nav scroll effect from getting-started.html. No platform toggling needed.

**Step 2: Verify locally**

Open `landing/teams.html` in a browser and verify:
- All sections render correctly
- Scroll reveal animations work
- Nav links work
- Icons render (Lucide)
- Responsive layout on mobile (grid collapses to single column)

**Step 3: Commit**

```bash
git add landing/teams.html
git commit -m "feat: add teams marketing page"
```

---

### Task 3: Add Teams nav link to existing pages

**Files:**
- Modify: `landing/index.html` — Add "Teams" link to nav
- Modify: `landing/getting-started.html` — Add "Teams" link to nav

**Step 1: Update nav in both files**

In both files, find the nav links area and add a Teams link. Place it between "Features" (or "Docs") and the GitHub icon:

```html
<a href="/teams" class="hidden sm:block text-sm text-gray-500 hover:text-white transition-colors">Teams</a>
```

On the teams.html page itself, this link should use `text-fire-400` (active state) instead of `text-gray-500`.

**Step 2: Commit**

```bash
git add landing/index.html landing/getting-started.html
git commit -m "chore: add Teams nav link to homepage and getting-started"
```

---

### Task 4: Deploy to Netlify

**Step 1: Deploy**

```bash
cd landing && netlify deploy --prod
```

**Step 2: Verify live**

Confirm https://codefire.app/teams loads correctly.

**Step 3: Final commit (if any fixes needed)**

Push any final fixes to git.
