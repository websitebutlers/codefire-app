// ─── Context Injector ───────────────────────────────────────────────────────
//
// Injects a managed section into AI CLI instruction files (CLAUDE.md, GEMINI.md, etc.)
// telling the agent about CodeFire's MCP tools. Also installs MCP config entries.
//
// Uses marker-based replacement to avoid overwriting user content.
// Matches Swift's ContextInjector behavior.
//

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import { DeepLinkService, type CLIProvider } from './DeepLinkService'

const SECTION_START = '<!-- CodeFire managed section -->'
const SECTION_END = '<!-- End CodeFire section -->'

const MANAGED_CONTENT = `${SECTION_START}
# CodeFire
This project uses CodeFire for session memory.
Use the \`codefire\` MCP tools to retrieve project history,
active tasks, patterns, and codebase structure when needed.
${SECTION_END}`

/** Map of CLI provider to its instruction file name */
const INSTRUCTION_FILES: Record<CLIProvider, string> = {
  claude: 'CLAUDE.md',
  gemini: 'GEMINI.md',
  codex: 'AGENTS.md',
  opencode: 'INSTRUCTIONS.md',
}

export class ContextInjector {
  private db: Database.Database
  private deepLinkService: DeepLinkService

  constructor(db: Database.Database) {
    this.db = db
    this.deepLinkService = new DeepLinkService()
  }

  /**
   * Inject the managed section into an instruction file for a specific CLI.
   * Creates the file if it doesn't exist.
   * Replaces existing managed section if found.
   */
  updateInstructionFile(cli: CLIProvider, projectPath: string): boolean {
    const fileName = INSTRUCTION_FILES[cli]
    if (!fileName) return false

    const filePath = path.join(projectPath, fileName)

    try {
      let content = ''
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf-8')
      }

      const updated = this.replaceManagedSection(content, MANAGED_CONTENT)
      fs.writeFileSync(filePath, updated, 'utf-8')
      return true
    } catch (err) {
      console.error(`[ContextInjector] Failed to update ${filePath}:`, err)
      return false
    }
  }

  /**
   * Remove the managed section from an instruction file.
   * Deletes the file if it becomes empty.
   */
  removeInstructionFile(cli: CLIProvider, projectPath: string): boolean {
    const fileName = INSTRUCTION_FILES[cli]
    if (!fileName) return false

    const filePath = path.join(projectPath, fileName)
    if (!fs.existsSync(filePath)) return true

    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const cleaned = this.removeManagedSection(content)

      if (cleaned.trim().length === 0) {
        fs.unlinkSync(filePath)
      } else {
        fs.writeFileSync(filePath, cleaned, 'utf-8')
      }
      return true
    } catch (err) {
      console.error(`[ContextInjector] Failed to remove section from ${filePath}:`, err)
      return false
    }
  }

  /**
   * Check if a managed section exists in the instruction file.
   */
  hasInstructionFile(cli: CLIProvider, projectPath: string): boolean {
    const fileName = INSTRUCTION_FILES[cli]
    if (!fileName) return false

    const filePath = path.join(projectPath, fileName)
    if (!fs.existsSync(filePath)) return false

    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return content.includes(SECTION_START) && content.includes(SECTION_END)
    } catch {
      return false
    }
  }

  /**
   * Install MCP config for a CLI provider.
   * Delegates to DeepLinkService for the actual config writing.
   */
  installMCP(cli: CLIProvider): { success: boolean; error?: string } {
    const result = this.deepLinkService.handleURL(`codefire://install-mcp?client=${cli}`)
    if (!result) return { success: false, error: 'Invalid CLI provider' }
    return { success: result.success, error: result.error }
  }

  /**
   * Set up both instruction file and MCP config for a project + CLI.
   */
  setupProject(cli: CLIProvider, projectPath: string): { instructionFile: boolean; mcpConfig: boolean } {
    const instructionFile = this.updateInstructionFile(cli, projectPath)
    const mcpResult = this.installMCP(cli)
    return { instructionFile, mcpConfig: mcpResult.success }
  }

  /**
   * Inject instruction files for all projects that have a Claude directory.
   * Called when instructionInjection setting is enabled.
   */
  injectAllProjects(cli: CLIProvider = 'claude'): number {
    const projectDAO = new ProjectDAO(this.db)
    const projects = projectDAO.list()
    let count = 0

    for (const project of projects) {
      if (!project.path || project.id === '__global__') continue
      if (!fs.existsSync(project.path)) continue

      if (!this.hasInstructionFile(cli, project.path)) {
        if (this.updateInstructionFile(cli, project.path)) {
          count++
        }
      }
    }

    return count
  }

  /**
   * Remove managed sections from all projects.
   * Called when instructionInjection setting is disabled.
   */
  removeAllInjections(cli: CLIProvider = 'claude'): number {
    const projectDAO = new ProjectDAO(this.db)
    const projects = projectDAO.list()
    let count = 0

    for (const project of projects) {
      if (!project.path || project.id === '__global__') continue
      if (this.removeInstructionFile(cli, project.path)) {
        count++
      }
    }

    return count
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Replace or append the managed section in file content.
   */
  private replaceManagedSection(content: string, section: string): string {
    const startIdx = content.indexOf(SECTION_START)
    const endIdx = content.indexOf(SECTION_END)

    if (startIdx !== -1 && endIdx !== -1) {
      // Replace existing section
      const before = content.substring(0, startIdx)
      const after = content.substring(endIdx + SECTION_END.length)
      return before + section + after
    }

    // Append to end
    if (content.length === 0) return section + '\n'
    const separator = content.endsWith('\n') ? '\n' : '\n\n'
    return content + separator + section + '\n'
  }

  /**
   * Remove the managed section from file content.
   */
  private removeManagedSection(content: string): string {
    const startIdx = content.indexOf(SECTION_START)
    const endIdx = content.indexOf(SECTION_END)

    if (startIdx === -1 || endIdx === -1) return content

    const before = content.substring(0, startIdx)
    const after = content.substring(endIdx + SECTION_END.length)
    let result = before + after

    // Clean up triple newlines
    result = result.replace(/\n{3,}/g, '\n\n')
    return result
  }
}
