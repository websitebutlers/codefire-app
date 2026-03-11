/**
 * electron-builder afterPack hook:
 * 1. Restore execute permission on node-pty's spawn-helper (macOS only).
 * 2. Install MCP server dependencies in the packaged extraResources.
 *
 * electron-builder applies .gitignore rules when copying extraResources,
 * which excludes mcp-server/node_modules/ (a build artifact listed in .gitignore).
 * We run npm install here to ensure the MCP server has its dependencies.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

module.exports = async function (context) {
  const appOutDir = context.appOutDir
  const appName = context.packager.appInfo.productFilename
  const platform = context.electronPlatformName || process.platform

  // --- 1. Fix node-pty spawn-helper permissions (macOS) ---
  if (platform === 'darwin') {
    const unpackedBase = path.join(
      appOutDir,
      `${appName}.app`,
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'prebuilds'
    )

    if (fs.existsSync(unpackedBase)) {
      const dirs = fs.readdirSync(unpackedBase).filter(d => d.startsWith('darwin-'))
      for (const dir of dirs) {
        const helperPath = path.join(unpackedBase, dir, 'spawn-helper')
        if (fs.existsSync(helperPath)) {
          fs.chmodSync(helperPath, 0o755)
          console.log(`[afterPack] Fixed execute permission: ${dir}/spawn-helper`)
        }
      }
    } else {
      console.log('[afterPack] node-pty prebuilds not found, skipping permission fix')
    }
  }

  // --- 2. Install MCP server dependencies ---
  let mcpDir
  if (platform === 'darwin') {
    mcpDir = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources', 'mcp-server')
  } else {
    mcpDir = path.join(appOutDir, 'resources', 'mcp-server')
  }

  if (fs.existsSync(path.join(mcpDir, 'package.json'))) {
    console.log('[afterPack] Installing MCP server dependencies in', mcpDir)
    try {
      execFileSync('npm', ['install', '--omit=dev'], { cwd: mcpDir, stdio: 'inherit' })
      console.log('[afterPack] MCP server dependencies installed successfully')
    } catch (err) {
      console.error('[afterPack] Failed to install MCP server dependencies:', err.message)
      throw err
    }
  } else {
    console.warn('[afterPack] MCP server package.json not found at', mcpDir)
  }
}
