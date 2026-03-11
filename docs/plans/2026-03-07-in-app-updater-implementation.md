# In-App Updater Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete in-app auto-updater for both Electron and Swift — checks GitHub Releases every 6 hours, shows notification, user clicks to download and install.

**Architecture:** Both platforms poll `api.github.com/repos/websitebutlers/codefire-app/releases/latest`. Swift side is already complete — just needs interval adjustment. Electron needs repo fix, proper semver comparison, periodic checks, and a notification banner component.

**Tech Stack:** Electron (TypeScript/React), Swift/SwiftUI, GitHub Releases API

---

## Status of Existing Code

### Swift (90% complete)
- `Services/UpdateService.swift` — fully implemented: version check, download .zip, extract, replace app, relaunch
- `CodeFireApp.swift` — wired with `startPeriodicChecks()` on launch
- `Views/SettingsView.swift` — has check button, download button, progress bar
- `Services/AppSettings.swift` — `checkForUpdates` toggle, `githubRepo` defaults to `websitebutlers/codefire-app`
- **Only fix needed:** Change default interval from 3600s (1hr) to 21600s (6hr)

### Electron (40% complete)
- `src/main/ipc/update-handlers.ts` — exists but wrong repo, bad version compare, download just opens browser
- `src/renderer/components/Settings/SettingsTabGeneral.tsx` — manual check button exists
- `src/shared/types.ts` — `UpdateChannel` already defined
- `src/renderer/lib/api.ts` — `update.check()` and `update.download()` already typed
- **Needs:** Fix handler, add periodic checks from main process, add notification banner in renderer

---

### Task 1: Fix Swift update interval

**Files:**
- Modify: `swift/Sources/CodeFire/CodeFireApp.swift:233`

**Step 1: Change interval to 6 hours**

In `CodeFireApp.swift`, the `startPeriodicChecks` call uses default interval (3600s). Pass 21600:

```swift
updateService.startPeriodicChecks(
    owner: String(parts[0]),
    repo: String(parts[1]),
    interval: 21600
)
```

**Step 2: Verify Swift builds**

Run: `cd swift && swift build 2>&1 | tail -5`
Expected: `Build complete!`

**Step 3: Commit**

```bash
git add swift/Sources/CodeFire/CodeFireApp.swift
git commit -m "fix: set Swift update check interval to 6 hours"
```

---

### Task 2: Fix Electron update handler

**Files:**
- Modify: `electron/src/main/ipc/update-handlers.ts`

**Step 1: Fix the handler**

Rewrite `update-handlers.ts` with:
- Correct repo: `websitebutlers/codefire-app`
- Proper semver comparison (split on `.`, compare numerically)
- Use `net` from electron instead of raw `https` for proper proxy support
- Keep `update:download` opening browser for now (Electron auto-updater is a separate enhancement)

```typescript
import { ipcMain, shell, net } from 'electron'
import { app } from 'electron'

const GITHUB_REPO = 'websitebutlers/codefire-app'

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

async function fetchJSON(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    request.setHeader('User-Agent', 'CodeFire-Electron')
    request.setHeader('Accept', 'application/vnd.github+json')
    let body = ''
    request.on('response', (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const location = response.headers['location']
        if (location) {
          const redirectUrl = Array.isArray(location) ? location[0] : location
          fetchJSON(redirectUrl).then(resolve).catch(reject)
          return
        }
      }
      response.on('data', (chunk) => { body += chunk.toString() })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch { reject(new Error('Invalid JSON')) }
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

export function registerUpdateHandlers() {
  ipcMain.handle('update:check', async () => {
    const currentVersion = app.getVersion()
    try {
      const release = await fetchJSON(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
      )
      const latestVersion = (release.tag_name || '').replace(/^v/, '')
      const available = compareVersions(latestVersion, currentVersion) > 0

      // Find the right asset for this platform
      const platform = process.platform
      const assets = release.assets || []
      let downloadUrl: string | null = null
      for (const asset of assets) {
        const name = (asset.name || '').toLowerCase()
        if (platform === 'win32' && name.endsWith('.exe')) {
          downloadUrl = asset.browser_download_url; break
        }
        if (platform === 'linux' && name.endsWith('.appimage')) {
          downloadUrl = asset.browser_download_url; break
        }
        if (platform === 'darwin' && name.endsWith('.dmg')) {
          downloadUrl = asset.browser_download_url; break
        }
      }

      return {
        available,
        currentVersion,
        latestVersion,
        downloadUrl,
        releaseNotes: release.body || null,
      }
    } catch {
      return { available: false, currentVersion, latestVersion: null, downloadUrl: null, releaseNotes: null }
    }
  })

  ipcMain.handle('update:download', async (_e, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch {
      return { success: false }
    }
  })
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd electron && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

**Step 3: Commit**

```bash
git add electron/src/main/ipc/update-handlers.ts
git commit -m "fix: correct repo and version comparison in update handler"
```

---

### Task 3: Add periodic update checks from main process

**Files:**
- Modify: `electron/src/main/index.ts`
- Modify: `electron/src/shared/types.ts` (add `update:available` receive channel)

**Step 1: Add update:available to types**

In `types.ts`, add a new receive channel type after existing `DeepLinkReceiveChannel`:

```typescript
export type UpdateReceiveChannel = 'update:available'
```

**Step 2: Add periodic checker to main/index.ts**

After the deep link setup block (~line 139), add a periodic update checker that runs `update:check` logic and pushes results to all windows via `webContents.send`:

```typescript
// Periodic update check — every 6 hours
function startUpdateChecker() {
  const CHECK_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours

  const doCheck = async () => {
    try {
      const result = await ipcMain.emit // No — use the handler directly
      // Instead, replicate the logic or import it
    } catch {}
  }

  // Actually: just have the renderer poll. Simpler.
}
```

**Actually — simpler approach:** Have the renderer check on mount + set an interval. No main process timer needed. This avoids duplicating logic and the renderer already has `update:check` wired up.

Add a `useUpdateChecker` hook that checks on mount and every 6 hours, and renders a banner when an update is available.

**Step 2 (revised): Create useUpdateChecker hook**

Create `electron/src/renderer/hooks/useUpdateChecker.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string | null
  downloadUrl: string | null
  releaseNotes: string | null
}

export function useUpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const check = useCallback(async () => {
    try {
      const result = await api.update.check()
      if (result.available) {
        setUpdateInfo(result)
      }
    } catch {
      // Silent fail
    }
  }, [])

  useEffect(() => {
    // Check on mount
    check()

    // Check every 6 hours
    const interval = setInterval(check, 6 * 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [check])

  const dismiss = useCallback(() => setDismissed(true), [])

  return {
    updateAvailable: updateInfo?.available && !dismissed,
    updateInfo,
    dismiss,
    download: updateInfo?.downloadUrl
      ? () => api.update.download(updateInfo.downloadUrl!)
      : null,
  }
}
```

**Step 3: Commit**

```bash
git add electron/src/renderer/hooks/useUpdateChecker.ts
git commit -m "feat: add useUpdateChecker hook with 6-hour polling"
```

---

### Task 4: Add update notification banner

**Files:**
- Create: `electron/src/renderer/components/UpdateBanner.tsx`
- Modify: `electron/src/renderer/layouts/MainLayout.tsx` (add banner)
- Modify: `electron/src/renderer/layouts/ProjectLayout.tsx` (add banner)

**Step 1: Create UpdateBanner component**

```tsx
import { Download, X } from 'lucide-react'
import { useUpdateChecker } from '../hooks/useUpdateChecker'

export function UpdateBanner() {
  const { updateAvailable, updateInfo, dismiss, download } = useUpdateChecker()

  if (!updateAvailable || !updateInfo) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-codefire-orange/10 border-b border-codefire-orange/20">
      <Download className="w-4 h-4 text-codefire-orange shrink-0" />
      <p className="text-xs text-neutral-200 flex-1">
        <span className="font-medium">CodeFire v{updateInfo.latestVersion}</span> is available
        <span className="text-neutral-500 ml-1">(you have v{updateInfo.currentVersion})</span>
      </p>
      {download && (
        <button
          onClick={download}
          className="px-3 py-1 rounded text-xs bg-codefire-orange/20 text-codefire-orange
                     hover:bg-codefire-orange/30 transition-colors font-medium"
        >
          Update Now
        </button>
      )}
      <button
        onClick={dismiss}
        className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
```

**Step 2: Add banner to MainLayout**

Find the top of the layout's return JSX and add `<UpdateBanner />` as the first child, before the existing layout content.

**Step 3: Add banner to ProjectLayout**

Same — add `<UpdateBanner />` at the top.

**Step 4: Verify TypeScript compiles**

Run: `cd electron && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add electron/src/renderer/components/UpdateBanner.tsx \
  electron/src/renderer/layouts/MainLayout.tsx \
  electron/src/renderer/layouts/ProjectLayout.tsx \
  electron/src/renderer/hooks/useUpdateChecker.ts
git commit -m "feat: add update notification banner to Electron app"
```

---

### Task 5: Verify end-to-end

**Step 1: Run Electron dev**

```bash
cd electron && npm run dev
```

Open Settings → General tab. Click "Check for Updates". Verify it shows correct version info.

**Step 2: Verify Swift builds**

```bash
cd swift && swift build
```

**Step 3: Final commit if any tweaks needed**

---

## Summary

| Platform | What exists | What to do |
|----------|-------------|------------|
| Swift | UpdateService fully implemented, wired in CodeFireApp + SettingsView | Change interval to 6hr |
| Electron | update-handlers.ts (wrong repo, bad semver), settings button only | Fix handler, add hook + banner |
