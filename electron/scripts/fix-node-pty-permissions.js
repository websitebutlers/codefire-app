/**
 * electron-builder afterPack hook: restore execute permission on node-pty's spawn-helper.
 *
 * electron-builder strips the +x bit from binaries inside asar.unpacked during packaging.
 * node-pty's spawn-helper is a native executable that gets called via posix_spawnp —
 * without execute permission, terminal creation fails with "posix_spawnp failed".
 */
const path = require('path')
const fs = require('fs')
const glob = require('path')

module.exports = async function (context) {
  if (process.platform !== 'darwin' && context.electronPlatformName !== 'darwin') {
    return
  }

  const appOutDir = context.appOutDir
  const appName = context.packager.appInfo.productFilename

  // Path inside the packaged .app bundle
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

  if (!fs.existsSync(unpackedBase)) {
    console.log('[afterPack] node-pty prebuilds not found, skipping permission fix')
    return
  }

  // Fix spawn-helper in all darwin prebuilds
  const dirs = fs.readdirSync(unpackedBase).filter(d => d.startsWith('darwin-'))

  for (const dir of dirs) {
    const helperPath = path.join(unpackedBase, dir, 'spawn-helper')
    if (fs.existsSync(helperPath)) {
      fs.chmodSync(helperPath, 0o755)
      console.log(`[afterPack] Fixed execute permission: ${dir}/spawn-helper`)
    }
  }
}
