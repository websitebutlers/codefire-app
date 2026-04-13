import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { ImageDAO } from '../database/dao/ImageDAO'
import { ImageGenerationService } from '../services/ImageGenerationService'
import { getPathValidator } from '../services/PathValidator'

export function registerImageHandlers(db: Database.Database) {
  const imageDAO = new ImageDAO(db)
  const imageGenService = new ImageGenerationService()

  ipcMain.handle('images:list', (_e, projectId: string) =>
    imageDAO.list(projectId)
  )

  ipcMain.handle('images:get', (_e, id: number) =>
    imageDAO.getById(id)
  )

  ipcMain.handle(
    'images:create',
    (
      _e,
      data: {
        projectId: string
        prompt: string
        filePath: string
        model: string
        responseText?: string
        aspectRatio?: string
        imageSize?: string
        parentImageId?: number
      }
    ) => imageDAO.create(data)
  )

  ipcMain.handle('images:delete', (_e, id: number) => {
    const record = imageDAO.getById(id)
    const ok = imageDAO.delete(id)
    if (ok && record?.filePath) {
      try { fs.unlinkSync(record.filePath) } catch { /* file may already be gone */ }
    }
    return ok
  })

  ipcMain.handle('images:readFile', (_e, filePath: string) => {
    try {
      getPathValidator().assertAllowed(filePath)
      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase().replace('.', '')
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'images:generate',
    async (
      _e,
      data: {
        projectId: string
        prompt: string
        apiKey: string
        model?: string
        aspectRatio?: string
        imageSize?: string
        seed?: number
        referenceImages?: string[]
      }
    ) => {
      const modelId = data.model || 'google/gemini-2.5-flash-image'

      const result = await imageGenService.generate({
        prompt: data.prompt,
        apiKey: data.apiKey,
        model: modelId,
        aspectRatio: data.aspectRatio,
        imageSize: data.imageSize,
        seed: data.seed,
        referenceImages: data.referenceImages,
      })

      if (result.error || !result.imagePath) {
        return { error: result.error ?? 'No image generated', image: null }
      }

      const image = imageDAO.create({
        projectId: data.projectId,
        prompt: data.prompt,
        filePath: result.imagePath,
        model: modelId,
        responseText: result.responseText ?? undefined,
        aspectRatio: data.aspectRatio,
        imageSize: data.imageSize,
        seed: data.seed,
        referenceImages: data.referenceImages?.length ? JSON.stringify(data.referenceImages) : undefined,
      })

      return { error: null, image }
    }
  )

  ipcMain.handle(
    'images:edit',
    async (
      _e,
      data: {
        imageId: number
        prompt: string
        apiKey: string
        model?: string
        aspectRatio?: string
        imageSize?: string
      }
    ) => {
      const original = imageDAO.getById(data.imageId)
      if (!original) {
        return { error: 'Original image not found', image: null }
      }

      const modelId = data.model || original.model

      const result = await imageGenService.editImage(
        original.filePath,
        data.prompt,
        {
          apiKey: data.apiKey,
          model: modelId,
          aspectRatio: data.aspectRatio ?? original.aspectRatio ?? '1:1',
          imageSize: data.imageSize ?? original.imageSize ?? '1K',
        }
      )

      if (result.error || !result.imagePath) {
        return { error: result.error ?? 'No image generated', image: null }
      }

      const image = imageDAO.create({
        projectId: original.projectId,
        prompt: data.prompt,
        filePath: result.imagePath,
        model: modelId,
        responseText: result.responseText ?? undefined,
        aspectRatio: data.aspectRatio ?? original.aspectRatio ?? '1:1',
        imageSize: data.imageSize ?? original.imageSize ?? '1K',
        parentImageId: original.id,
      })

      return { error: null, image }
    }
  )

  // Reset conversation cache
  ipcMain.handle('images:resetConversation', () => {
    imageGenService.resetConversation()
    return true
  })
}
