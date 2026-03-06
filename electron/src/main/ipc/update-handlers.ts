import { ipcMain, shell } from 'electron'
import { app } from 'electron'
import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'

const GITHUB_REPO = 'nicepkg/codefire'

function httpsGet(url: string): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, { headers: { 'User-Agent': 'CodeFire-Electron' } }, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location
        if (redirectUrl) {
          httpsGet(redirectUrl).then(resolve).catch(reject)
          return
        }
      }
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

export function registerUpdateHandlers() {
  ipcMain.handle('update:check', async () => {
    const currentVersion = app.getVersion()
    try {
      const resp = await httpsGet(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      if (resp.statusCode !== 200) {
        return { available: false, currentVersion, latestVersion: null, downloadUrl: null, releaseNotes: null }
      }
      const release = JSON.parse(resp.body)
      const latestVersion = (release.tag_name || '').replace(/^v/, '')
      const available = latestVersion !== currentVersion && latestVersion > currentVersion

      // Find the right asset for this platform
      const platform = process.platform
      const assets = release.assets || []
      let downloadUrl: string | null = null
      for (const asset of assets) {
        const name = (asset.name || '').toLowerCase()
        if (platform === 'win32' && name.endsWith('.exe')) {
          downloadUrl = asset.browser_download_url
          break
        }
        if (platform === 'linux' && name.endsWith('.appimage')) {
          downloadUrl = asset.browser_download_url
          break
        }
        if (platform === 'darwin' && name.endsWith('.dmg')) {
          downloadUrl = asset.browser_download_url
          break
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
      // Open the download URL in the default browser
      await shell.openExternal(url)
      return { success: true }
    } catch {
      return { success: false }
    }
  })
}
