import Database from 'better-sqlite3'
import type { GeneratedImage } from '@shared/models'

export class ImageDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string): GeneratedImage[] {
    return this.db
      .prepare('SELECT * FROM generatedImages WHERE projectId = ? ORDER BY createdAt DESC')
      .all(projectId) as GeneratedImage[]
  }

  getById(id: number): GeneratedImage | undefined {
    return this.db
      .prepare('SELECT * FROM generatedImages WHERE id = ?')
      .get(id) as GeneratedImage | undefined
  }

  create(data: {
    projectId: string
    prompt: string
    filePath: string
    model: string
    responseText?: string
    aspectRatio?: string
    imageSize?: string
    parentImageId?: number
    mediaType?: string
    negativePrompt?: string
    seed?: number
    durationSeconds?: number
    audioEnabled?: number
    resolution?: string
    referenceImages?: string
    status?: string
    generationId?: string
  }): GeneratedImage {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO generatedImages (projectId, prompt, responseText, filePath, model, aspectRatio, imageSize, parentImageId, mediaType, negativePrompt, seed, durationSeconds, audioEnabled, resolution, referenceImages, status, generationId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.prompt,
        data.responseText ?? null,
        data.filePath,
        data.model,
        data.aspectRatio ?? '1:1',
        data.imageSize ?? '1K',
        data.parentImageId ?? null,
        data.mediaType ?? 'image',
        data.negativePrompt ?? null,
        data.seed ?? null,
        data.durationSeconds ?? null,
        data.audioEnabled ?? 0,
        data.resolution ?? null,
        data.referenceImages ?? null,
        data.status ?? 'complete',
        data.generationId ?? null,
        now
      )
    return this.getById(Number(result.lastInsertRowid))!
  }

  update(id: number, data: Partial<{
    status: string
    filePath: string
    responseText: string
    generationId: string
  }>): boolean {
    const fields: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`)
        values.push(value)
      }
    }
    if (fields.length === 0) return false
    values.push(id)
    const result = this.db
      .prepare(`UPDATE generatedImages SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)
    return result.changes > 0
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM generatedImages WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}
