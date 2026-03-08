import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { scanArchitecture, scanSchema } from '../services/ProjectAnalyzer'
import { getPathValidator } from '../services/PathValidator'

export interface DetectedService {
  name: string
  configFile: string
  configPath: string
  dashboardUrl: string | null
  icon: string // lucide icon name
}

interface ServiceDefinition {
  name: string
  configFiles: string[]
  dashboardUrl: string | null
  icon: string
}

const KNOWN_SERVICES: ServiceDefinition[] = [
  {
    name: 'Firebase',
    configFiles: ['firebase.json', '.firebaserc'],
    dashboardUrl: 'https://console.firebase.google.com',
    icon: 'Flame',
  },
  {
    name: 'Supabase',
    configFiles: ['supabase/config.toml', 'supabase/.temp/project-ref', 'supabase/migrations'],
    dashboardUrl: 'https://supabase.com/dashboard',
    icon: 'Database',
  },
  {
    name: 'Vercel',
    configFiles: ['vercel.json', '.vercel/project.json'],
    dashboardUrl: 'https://vercel.com/dashboard',
    icon: 'Triangle',
  },
  {
    name: 'Netlify',
    configFiles: ['netlify.toml', '.netlify/state.json'],
    dashboardUrl: 'https://app.netlify.com',
    icon: 'Globe',
  },
  {
    name: 'AWS',
    configFiles: ['samconfig.toml', 'serverless.yml', 'serverless.yaml', 'cdk.json', '.aws/config'],
    dashboardUrl: 'https://console.aws.amazon.com',
    icon: 'Cloud',
  },
  {
    name: 'Docker',
    configFiles: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
    dashboardUrl: null,
    icon: 'Container',
  },
  {
    name: 'PostgreSQL',
    configFiles: ['docker-compose.yml'], // Will check content for postgres service
    dashboardUrl: null,
    icon: 'Database',
  },
  {
    name: 'Redis',
    configFiles: ['redis.conf'],
    dashboardUrl: null,
    icon: 'Database',
  },
  {
    name: 'Prisma',
    configFiles: ['prisma/schema.prisma'],
    dashboardUrl: null,
    icon: 'Database',
  },
  {
    name: 'Drizzle',
    configFiles: ['drizzle.config.ts', 'drizzle.config.js'],
    dashboardUrl: null,
    icon: 'Database',
  },
]

/**
 * Register IPC handlers for service detection.
 */
export function registerServiceHandlers() {
  ipcMain.handle(
    'services:detect',
    (_event, projectPath: string): DetectedService[] => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      const detected: DetectedService[] = []
      const seen = new Set<string>()

      for (const service of KNOWN_SERVICES) {
        for (const configFile of service.configFiles) {
          const fullPath = path.join(projectPath, configFile)
          try {
            if (fs.existsSync(fullPath)) {
              // Special case: PostgreSQL detection via docker-compose
              if (service.name === 'PostgreSQL' && configFile.includes('docker-compose')) {
                try {
                  const content = fs.readFileSync(fullPath, 'utf-8')
                  if (!content.includes('postgres')) continue
                } catch {
                  continue
                }
              }

              if (!seen.has(service.name)) {
                seen.add(service.name)
                detected.push({
                  name: service.name,
                  configFile,
                  configPath: fullPath,
                  dashboardUrl: service.dashboardUrl,
                  icon: service.icon,
                })
              }
            }
          } catch {
            // Ignore permission errors etc.
          }
        }
      }

      // Scan package.json dependencies for additional services
      try {
        const pkgPath = path.join(projectPath, 'package.json')
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
          const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
          }
          const depServices: Array<{ name: string; dep: string; icon: string; dashboardUrl: string | null }> = [
            { name: 'Supabase', dep: '@supabase/supabase-js', icon: 'Database', dashboardUrl: 'https://supabase.com/dashboard' },
            { name: 'Firebase', dep: 'firebase', icon: 'Flame', dashboardUrl: 'https://console.firebase.google.com' },
            { name: 'Prisma', dep: 'prisma', icon: 'Database', dashboardUrl: null },
            { name: 'Drizzle', dep: 'drizzle-orm', icon: 'Database', dashboardUrl: null },
            { name: 'Stripe', dep: 'stripe', icon: 'CreditCard', dashboardUrl: 'https://dashboard.stripe.com' },
            { name: 'Auth0', dep: 'auth0', icon: 'Shield', dashboardUrl: 'https://manage.auth0.com' },
            { name: 'Clerk', dep: '@clerk/clerk-sdk-node', icon: 'Shield', dashboardUrl: 'https://dashboard.clerk.com' },
            { name: 'Sentry', dep: '@sentry/node', icon: 'Bug', dashboardUrl: 'https://sentry.io' },
            { name: 'Redis', dep: 'redis', icon: 'Database', dashboardUrl: null },
            { name: 'MongoDB', dep: 'mongodb', icon: 'Database', dashboardUrl: 'https://cloud.mongodb.com' },
            { name: 'Mongoose', dep: 'mongoose', icon: 'Database', dashboardUrl: 'https://cloud.mongodb.com' },
          ]

          for (const svc of depServices) {
            if (allDeps[svc.dep] && !seen.has(svc.name)) {
              seen.add(svc.name)
              detected.push({
                name: svc.name,
                configFile: `package.json (${svc.dep})`,
                configPath: pkgPath,
                dashboardUrl: svc.dashboardUrl,
                icon: svc.icon,
              })
            }
          }
        }
      } catch {
        // Ignore package.json parse errors
      }

      // Also scan for .env files
      try {
        const entries = fs.readdirSync(projectPath)
        const envFiles = entries.filter(
          (e) => e === '.env' || e.startsWith('.env.')
        )
        if (envFiles.length > 0 && !seen.has('Environment Variables')) {
          detected.push({
            name: 'Environment Variables',
            configFile: envFiles.join(', '),
            configPath: path.join(projectPath, envFiles[0]),
            dashboardUrl: null,
            icon: 'KeyRound',
          })
        }
      } catch {
        // Ignore
      }

      return detected
    }
  )

  // ── List .env files in a project directory ──────────────────────────────────
  ipcMain.handle(
    'services:listEnvFiles',
    (_event, projectPath: string): { name: string; path: string; varCount: number }[] => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      try {
        const entries = fs.readdirSync(projectPath)
        const envFiles = entries.filter(
          (e) => e === '.env' || e.startsWith('.env.')
        )

        return envFiles.map((name) => {
          const filePath = path.join(projectPath, name)
          let varCount = 0
          try {
            const content = fs.readFileSync(filePath, 'utf-8')
            varCount = content
              .split('\n')
              .filter((line) => {
                const trimmed = line.trim()
                return trimmed.length > 0 && !trimmed.startsWith('#') && trimmed.includes('=')
              }).length
          } catch {
            // Ignore read errors
          }
          return { name, path: filePath, varCount }
        })
      } catch {
        return []
      }
    }
  )

  // ── Read and parse a single .env file ───────────────────────────────────────
  ipcMain.handle(
    'services:readEnvFile',
    (_event, filePath: string): { key: string; value: string; comment?: string }[] => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      getPathValidator().assertAllowed(filePath)

      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const result: { key: string; value: string; comment?: string }[] = []
      let pendingComment: string | undefined

      for (const line of lines) {
        const trimmed = line.trim()

        if (trimmed.startsWith('#')) {
          // Accumulate comment lines — attach to the next variable
          const commentText = trimmed.slice(1).trim()
          pendingComment = pendingComment
            ? `${pendingComment}\n${commentText}`
            : commentText
          continue
        }

        if (trimmed.length === 0) {
          // Blank lines reset pending comment
          pendingComment = undefined
          continue
        }

        const eqIndex = trimmed.indexOf('=')
        if (eqIndex === -1) {
          pendingComment = undefined
          continue
        }

        const key = trimmed.slice(0, eqIndex).trim()
        let value = trimmed.slice(eqIndex + 1).trim()

        // Strip surrounding quotes (single or double)
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }

        const entry: { key: string; value: string; comment?: string } = { key, value }
        if (pendingComment) {
          entry.comment = pendingComment
        }
        result.push(entry)
        pendingComment = undefined
      }

      return result
    }
  )

  // ── Scan for .env template files ────────────────────────────────────────────
  ipcMain.handle(
    'services:scanTemplates',
    (
      _event,
      projectPath: string
    ): {
      name: string
      path: string
      vars: { key: string; comment?: string; defaultValue?: string }[]
    }[] => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      const templateNames = ['.env.example', '.env.template', '.env.sample']
      const results: {
        name: string
        path: string
        vars: { key: string; comment?: string; defaultValue?: string }[]
      }[] = []

      for (const name of templateNames) {
        const filePath = path.join(projectPath, name)
        try {
          if (!fs.existsSync(filePath)) continue

          const content = fs.readFileSync(filePath, 'utf-8')
          const lines = content.split('\n')
          const vars: { key: string; comment?: string; defaultValue?: string }[] = []
          let pendingComment: string | undefined

          for (const line of lines) {
            const trimmed = line.trim()

            if (trimmed.startsWith('#')) {
              const commentText = trimmed.slice(1).trim()
              pendingComment = pendingComment
                ? `${pendingComment}\n${commentText}`
                : commentText
              continue
            }

            if (trimmed.length === 0) {
              pendingComment = undefined
              continue
            }

            const eqIndex = trimmed.indexOf('=')
            if (eqIndex === -1) {
              pendingComment = undefined
              continue
            }

            const key = trimmed.slice(0, eqIndex).trim()
            let rawValue = trimmed.slice(eqIndex + 1).trim()

            // Strip surrounding quotes
            if (
              (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
              (rawValue.startsWith("'") && rawValue.endsWith("'"))
            ) {
              rawValue = rawValue.slice(1, -1)
            }

            const varEntry: { key: string; comment?: string; defaultValue?: string } = { key }
            if (pendingComment) {
              varEntry.comment = pendingComment
            }
            if (rawValue.length > 0) {
              varEntry.defaultValue = rawValue
            }
            vars.push(varEntry)
            pendingComment = undefined
          }

          results.push({ name, path: filePath, vars })
        } catch {
          // Ignore unreadable templates
        }
      }

      return results
    }
  )

  // ── Scan architecture (import graph) ─────────────────────────────────────
  ipcMain.handle(
    'services:scanArchitecture',
    (_event, projectPath: string) => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required')
      }
      return scanArchitecture(projectPath)
    }
  )

  // ── Scan database schema ─────────────────────────────────────────────────
  ipcMain.handle(
    'services:scanSchema',
    (_event, projectPath: string) => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required')
      }
      return scanSchema(projectPath)
    }
  )
}
