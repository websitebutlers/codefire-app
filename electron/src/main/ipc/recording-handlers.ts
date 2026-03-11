import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import Database from 'better-sqlite3'
import { RecordingDAO } from '../database/dao/RecordingDAO'
import { getConfigValue } from '../services/ConfigStore'
import * as path from 'node:path'
import * as fs from 'node:fs'

export function registerRecordingHandlers(db: Database.Database) {
  const recordingDAO = new RecordingDAO(db)

  ipcMain.handle('recordings:list', (_e, projectId: string) =>
    recordingDAO.list(projectId)
  )

  ipcMain.handle('recordings:get', (_e, id: string) =>
    recordingDAO.getById(id)
  )

  ipcMain.handle(
    'recordings:create',
    (_e, data: { projectId: string; title: string }) => {
      const recordingsDir = path.join(app.getPath('userData'), 'recordings')
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true })
      }
      const audioPath = path.join(
        recordingsDir,
        `${Date.now()}-${data.title.replace(/[^a-zA-Z0-9]/g, '_')}.webm`
      )
      return recordingDAO.create({
        projectId: data.projectId,
        title: data.title,
        audioPath,
      })
    }
  )

  ipcMain.handle(
    'recordings:update',
    (
      _e,
      id: string,
      data: {
        title?: string
        duration?: number
        transcript?: string
        status?: string
        errorMessage?: string
      }
    ) => recordingDAO.update(id, data)
  )

  ipcMain.handle('recordings:delete', (_e, id: string) => {
    const recording = recordingDAO.getById(id)
    if (recording) {
      try {
        if (fs.existsSync(recording.audioPath)) {
          fs.unlinkSync(recording.audioPath)
        }
      } catch {
        // File may already be gone
      }
    }
    return recordingDAO.delete(id)
  })

  ipcMain.handle(
    'recordings:saveAudio',
    (_e, id: string, audioData: ArrayBuffer) => {
      const recording = recordingDAO.getById(id)
      if (!recording) return false
      fs.writeFileSync(recording.audioPath, Buffer.from(audioData))
      return true
    }
  )

  ipcMain.handle(
    'recordings:importFile',
    async (_e, projectId: string) => {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
        title: 'Import Audio File',
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'wav', 'webm', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'mp4'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) return null

      const sourcePath = result.filePaths[0]
      const ext = path.extname(sourcePath)
      const baseName = path.basename(sourcePath, ext)

      const recordingsDir = path.join(app.getPath('userData'), 'recordings')
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true })
      }

      const audioPath = path.join(
        recordingsDir,
        `${Date.now()}-${baseName.replace(/[^a-zA-Z0-9]/g, '_')}${ext}`
      )

      fs.copyFileSync(sourcePath, audioPath)

      return recordingDAO.create({
        projectId,
        title: baseName,
        audioPath,
      })
    }
  )

  ipcMain.handle(
    'recordings:transcribe',
    async (_e, id: string) => {
      const recording = recordingDAO.getById(id)
      if (!recording) throw new Error('Recording not found')
      if (!fs.existsSync(recording.audioPath)) {
        throw new Error('Audio file not found')
      }

      const apiKey = getConfigValue('openRouterKey')
      if (!apiKey) {
        throw new Error('OpenRouter API key not set. Add one in Settings → Engine.')
      }

      recordingDAO.update(id, { status: 'transcribing' })

      try {
        const audioBuffer = fs.readFileSync(recording.audioPath)
        const ext = path.extname(recording.audioPath).toLowerCase()
        const mimeTypes: Record<string, string> = {
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'audio/webm',
          '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
          '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma', '.mp4': 'audio/mp4',
        }
        const mimeType = mimeTypes[ext] || 'audio/webm'
        const audioBase64 = audioBuffer.toString('base64')
        // Map MIME type to OpenRouter audio format
        const formatMap: Record<string, string> = {
          'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/webm': 'webm',
          'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/flac': 'flac',
          'audio/aac': 'aac', 'audio/x-ms-wma': 'wma',
        }
        const audioFormat = formatMap[mimeType] || 'webm'

        const response = await fetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'google/gemini-3.1-flash-lite-preview',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'input_audio',
                      input_audio: {
                        data: audioBase64,
                        format: audioFormat,
                      },
                    },
                    {
                      type: 'text',
                      text: 'Transcribe this audio accurately and verbatim. Return ONLY the transcription text with no additional commentary, labels, or formatting.',
                    },
                  ],
                },
              ],
            }),
          }
        )

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Gemini transcription error: ${response.status} ${error}`)
        }

        const result = (await response.json()) as {
          choices: Array<{ message: { content: string } }>
        }
        const transcript = result.choices?.[0]?.message?.content?.trim() || ''
        if (!transcript) {
          throw new Error('Gemini returned empty transcription')
        }

        return recordingDAO.update(id, {
          transcript,
          status: 'done',
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        recordingDAO.update(id, { status: 'error', errorMessage: message })
        throw err
      }
    }
  )
}
