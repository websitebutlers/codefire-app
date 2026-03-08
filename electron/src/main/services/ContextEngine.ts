import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { ChunkDAO } from '@main/database/dao/ChunkDAO'
import { IndexDAO } from '@main/database/dao/IndexDAO'
import {
  chunkFile,
  chunkGitHistory,
  detectLanguage,
} from '@main/services/CodeChunker'

const execFileAsync = promisify(execFile)

/** Yield to the event loop so IPC and window creation aren't starved. */
const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r))

/** How many files to process before yielding. */
const INDEX_BATCH_SIZE = 30

// ─── Skip Rules ──────────────────────────────────────────────────────────────

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.build',
  'build',
  '.dart_tool',
  '__pycache__',
  '.next',
  'dist',
  '.git',
  '.gradle',
  'Pods',
  '.pub-cache',
  '.pub',
  '.swiftpm',
  'DerivedData',
  '.expo',
  'coverage',
  'vendor',
  'target',
])

const SKIP_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'zip',
  'tar',
  'gz',
  'dmg',
  'mp3',
  'mp4',
  'wav',
  'mov',
  'pdf',
  'lock',
  'sum',
])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIRECTORIES.has(dirName)
}

function shouldSkipFile(filePath: string): boolean {
  const dotIdx = filePath.lastIndexOf('.')
  if (dotIdx < 0) return false
  const ext = filePath.slice(dotIdx + 1).toLowerCase()
  return SKIP_EXTENSIONS.has(ext)
}

/**
 * Recursively enumerate all files in a directory, skipping excluded dirs/extensions.
 * Async to avoid blocking the main-process event loop for large trees.
 */
async function enumerateFiles(dirPath: string): Promise<string[]> {
  const results: string[] = []

  let entries: fs.Dirent[]
  try {
    entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        results.push(...await enumerateFiles(path.join(dirPath, entry.name)))
      }
    } else if (entry.isFile()) {
      const fullPath = path.join(dirPath, entry.name)
      if (!shouldSkipFile(fullPath)) {
        results.push(fullPath)
      }
    }
  }

  return results
}

// ─── Context Engine ──────────────────────────────────────────────────────────

/**
 * Orchestrates code indexing for a project.
 *
 * Handles full-project indexing, single-file indexing, and file removal.
 * Uses CodeChunker for semantic chunking and IndexDAO/ChunkDAO for persistence.
 */
export class ContextEngine {
  private chunkDAO: ChunkDAO
  private indexDAO: IndexDAO

  constructor(private db: Database.Database) {
    this.chunkDAO = new ChunkDAO(db)
    this.indexDAO = new IndexDAO(db)
  }

  /**
   * Index an entire project directory.
   *
   * 1. Set indexState to "indexing"
   * 2. Enumerate all files (skip excluded directories/extensions)
   * 3. For each file:
   *    - Compute SHA256 hash
   *    - Check if hash matches existing IndexedFile
   *    - If unchanged → skip
   *    - If changed → delete old chunks, re-chunk, insert new chunks
   * 4. Delete stale IndexedFile records for files no longer in project
   * 5. Chunk git history (last 200 commits)
   * 6. Set indexState to "ready" with chunk count
   * 7. On error: set indexState to "error" with message
   */
  async indexProject(
    projectId: string,
    projectPath: string
  ): Promise<void> {
    try {
      // Step 1: Set state to indexing
      this.indexDAO.updateState(projectId, {
        status: 'indexing',
        lastError: null,
      })

      // Step 2: Enumerate files (async to avoid blocking)
      const absolutePaths = await enumerateFiles(projectPath)
      const relativePaths = absolutePaths.map((p) =>
        path.relative(projectPath, p)
      )

      // Step 3: Process each file (yield every batch to keep event loop responsive)
      for (let i = 0; i < absolutePaths.length; i++) {
        if (i > 0 && i % INDEX_BATCH_SIZE === 0) {
          await yieldToEventLoop()
        }

        const absPath = absolutePaths[i]
        const relPath = relativePaths[i]

        let content: string
        try {
          content = await fsPromises.readFile(absPath, 'utf-8')
        } catch {
          continue // Skip unreadable files
        }

        const contentHash = hashContent(content)
        const existing = this.indexDAO.getFileByPath(projectId, relPath)

        // Skip unchanged files
        if (existing && existing.contentHash === contentHash) {
          continue
        }

        // Delete old chunks if file existed before
        if (existing) {
          this.chunkDAO.deleteByFile(existing.id)
        }

        // Detect language and chunk
        const language = detectLanguage(relPath)
        const chunks = chunkFile(content, language)

        // Upsert the indexed file record
        const indexedFile = this.indexDAO.upsertFile({
          projectId,
          relativePath: relPath,
          contentHash,
          language,
        })

        // Insert new chunks
        for (const chunk of chunks) {
          this.chunkDAO.insert({
            id: randomUUID(),
            fileId: indexedFile.id,
            projectId,
            chunkType: chunk.chunkType,
            symbolName: chunk.symbolName,
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            embedding: null,
          })
        }
      }

      // Step 4: Delete stale files
      this.indexDAO.deleteStaleFiles(projectId, relativePaths)

      // Step 5: Chunk git history
      await this.indexGitHistory(projectId, projectPath)

      // Step 6: Update state to ready
      const totalChunks = this.chunkDAO.countByProject(projectId)
      this.indexDAO.updateState(projectId, {
        status: 'ready',
        lastFullIndexAt: new Date().toISOString(),
        totalChunks,
        lastError: null,
      })
    } catch (error: unknown) {
      // Step 7: Set error state
      const message =
        error instanceof Error ? error.message : String(error)
      this.indexDAO.updateState(projectId, {
        status: 'error',
        lastError: message,
      })
      throw error
    }
  }

  /**
   * Index (or re-index) a single file.
   */
  async indexFile(
    projectId: string,
    projectPath: string,
    relativePath: string
  ): Promise<void> {
    const absPath = path.join(projectPath, relativePath)

    let content: string
    try {
      content = fs.readFileSync(absPath, 'utf-8')
    } catch {
      // File can't be read — remove it from the index
      await this.removeFile(projectId, relativePath)
      return
    }

    const contentHash = hashContent(content)
    const existing = this.indexDAO.getFileByPath(projectId, relativePath)

    // Skip if unchanged
    if (existing && existing.contentHash === contentHash) return

    // Delete old chunks
    if (existing) {
      this.chunkDAO.deleteByFile(existing.id)
    }

    // Chunk the file
    const language = detectLanguage(relativePath)
    const chunks = chunkFile(content, language)

    // Upsert indexed file record
    const indexedFile = this.indexDAO.upsertFile({
      projectId,
      relativePath,
      contentHash,
      language,
    })

    // Insert new chunks
    for (const chunk of chunks) {
      this.chunkDAO.insert({
        id: randomUUID(),
        fileId: indexedFile.id,
        projectId,
        chunkType: chunk.chunkType,
        symbolName: chunk.symbolName,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding: null,
      })
    }

    // Update total chunk count
    const totalChunks = this.chunkDAO.countByProject(projectId)
    this.indexDAO.updateState(projectId, { totalChunks })
  }

  /**
   * Remove a file from the index.
   */
  async removeFile(
    projectId: string,
    relativePath: string
  ): Promise<void> {
    const existing = this.indexDAO.getFileByPath(projectId, relativePath)
    if (!existing) return

    this.chunkDAO.deleteByFile(existing.id)
    this.indexDAO.deleteFile(existing.id)

    // Update total chunk count
    const totalChunks = this.chunkDAO.countByProject(projectId)
    this.indexDAO.updateState(projectId, { totalChunks })
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Index git history as commit chunks.
   * Uses a virtual file with id `__git_history__:{projectId}`.
   */
  private async indexGitHistory(
    projectId: string,
    projectPath: string
  ): Promise<void> {
    const gitFileId = `__git_history__:${projectId}`

    // Delete old git history chunks
    this.chunkDAO.deleteByFile(gitFileId)

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', projectPath, 'log', '--oneline', '-n', '200'],
        { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }
      )

      if (!stdout.trim()) return

      const chunks = chunkGitHistory(stdout)
      for (const chunk of chunks) {
        this.chunkDAO.insert({
          id: randomUUID(),
          fileId: gitFileId,
          projectId,
          chunkType: chunk.chunkType,
          symbolName: chunk.symbolName,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          embedding: null,
        })
      }
    } catch {
      // Not a git repo or git not available — skip silently
    }
  }
}
