import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import electronFull from 'vite-plugin-electron'
import path from 'path'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        // Start Electron on first build, skip restart on subsequent rebuilds
        // to prevent killing active terminals/MCP connections
        onstart({ startup }) {
          if (!process.electronApp) {
            startup()
          } else {
            console.log('[vite] Main process rebuilt. Restart manually to apply changes.')
          }
        },
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'src/shared'),
              '@main': path.resolve(__dirname, 'src/main'),
            },
          },
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['better-sqlite3', 'node-pty', '@supabase/supabase-js'],
            },
          },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
        // Prevent automatic reload of renderer window on preload rebuild
        // to avoid wiping out active sessions/terminals
        onstart({ reload }) {
          console.log('[vite] Preload rebuilt. Restart manually to apply changes.')
        },
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'src/shared'),
            },
          },
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron', 'os'],
            },
          },
        },
      },
    }),
    // MCP server — standalone Node.js process for AI agent integration
    electronFull([
      {
        entry: 'src/mcp/server.ts',
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'src/shared'),
            },
          },
          build: {
            outDir: 'dist-electron/mcp',
            rollupOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
})
