/**
 * Patches vite-plugin-electron's treeKillSync to handle Windows taskkill failures
 * when the Electron process has already exited. Without this patch, the dev server
 * crashes on HMR rebuild because taskkill throws on a non-existent process.
 *
 * Run automatically via postinstall.
 */
const fs = require('fs')
const path = require('path')

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'vite-plugin-electron',
  'dist',
  'index.js'
)

if (!fs.existsSync(filePath)) {
  console.log('[patch] vite-plugin-electron not found, skipping')
  process.exit(0)
}

let content = fs.readFileSync(filePath, 'utf-8')

const original = `cp.execSync(\`taskkill /pid \${pid} /T /F\`);`
const patched = `try { cp.execSync(\`taskkill /pid \${pid} /T /F\`); } catch { /* process already exited */ }`

if (content.includes(patched)) {
  console.log('[patch] vite-plugin-electron already patched')
  process.exit(0)
}

if (!content.includes(original)) {
  console.log('[patch] vite-plugin-electron: unexpected source, skipping')
  process.exit(0)
}

content = content.replace(original, patched)
fs.writeFileSync(filePath, content)
console.log('[patch] vite-plugin-electron: patched treeKillSync for Windows')
