import { net } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getModelById } from '@shared/media-models'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

interface GenerationResult {
  imagePath: string | null
  responseText: string | null
  error: string | null
}

export interface GenerateOptions {
  prompt: string
  apiKey: string
  model: string
  aspectRatio?: string
  imageSize?: string
  seed?: number
  referenceImages?: string[] // file paths for img2img / style transfer / character ref
}

export class ImageGenerationService {
  private conversationHistory: Record<string, unknown>[] = []

  async generate(opts: GenerateOptions): Promise<GenerationResult> {
    if (!opts.apiKey) {
      return { imagePath: null, responseText: null, error: 'OpenRouter API key not configured' }
    }

    const contentParts: Record<string, unknown>[] = []

    // Add reference images (for img2img, style transfer, character ref)
    if (opts.referenceImages?.length) {
      for (const refPath of opts.referenceImages) {
        try {
          const imgData = fs.readFileSync(refPath)
          const ext = path.extname(refPath).toLowerCase().replace('.', '')
          const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`
          const dataUrl = `data:${mime};base64,${imgData.toString('base64')}`
          contentParts.push({ type: 'image_url', image_url: { url: dataUrl } })
        } catch (err) {
          return { imagePath: null, responseText: null, error: `Failed to read reference image: ${err instanceof Error ? err.message : String(err)}` }
        }
      }
    }

    contentParts.push({ type: 'text', text: opts.prompt })

    const message = { role: 'user', content: contentParts }
    this.conversationHistory.push(message)

    return this.callAPI(opts)
  }

  async editImage(
    originalImagePath: string,
    editPrompt: string,
    opts: Omit<GenerateOptions, 'prompt'>
  ): Promise<GenerationResult> {
    if (!opts.apiKey) {
      return { imagePath: null, responseText: null, error: 'OpenRouter API key not configured' }
    }

    let imageDataUrl: string
    try {
      const imgData = fs.readFileSync(originalImagePath)
      imageDataUrl = `data:image/png;base64,${imgData.toString('base64')}`
    } catch (err) {
      return { imagePath: null, responseText: null, error: `Failed to read image: ${err instanceof Error ? err.message : String(err)}` }
    }

    this.conversationHistory = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: editPrompt },
        ],
      },
    ]

    return this.callAPI({ ...opts, prompt: editPrompt })
  }

  resetConversation() {
    this.conversationHistory = []
  }

  private async callAPI(opts: GenerateOptions): Promise<GenerationResult> {
    // Look up model to get correct output modalities
    const modelDef = getModelById(opts.model)
    const modalities = modelDef?.outputModalities ?? ['image', 'text']

    const bodyObj: Record<string, unknown> = {
      model: opts.model,
      modalities,
      messages: this.conversationHistory,
      image_config: {
        aspect_ratio: opts.aspectRatio ?? '1:1',
        image_size: opts.imageSize ?? '1K',
      },
    }

    if (opts.seed !== undefined) {
      bodyObj.seed = opts.seed
    }

    const body = JSON.stringify(bodyObj)
    console.log('[ImageGen] REQUEST model:', opts.model, 'modalities:', modalities, 'aspectRatio:', opts.aspectRatio, 'imageSize:', opts.imageSize)

    return new Promise((resolve) => {
      const request = net.request({ method: 'POST', url: ENDPOINT })
      request.setHeader('Authorization', `Bearer ${opts.apiKey}`)
      request.setHeader('Content-Type', 'application/json')
      request.setHeader('X-Title', 'CodeFire')

      let responseData = ''

      request.on('response', (response) => {
        response.on('data', (chunk) => { responseData += chunk.toString() })

        response.on('end', () => {
          console.log('[ImageGen] RESPONSE status:', response.statusCode)
          if (response.statusCode !== 200) {
            console.log('[ImageGen] RESPONSE error body:', responseData.substring(0, 1000))
            resolve({ imagePath: null, responseText: null, error: `HTTP ${response.statusCode}: ${responseData.substring(0, 300)}` })
            return
          }

          try {
            const json = JSON.parse(responseData)

            if (json.error?.message) {
              resolve({ imagePath: null, responseText: null, error: json.error.message })
              return
            }

            const message = json.choices?.[0]?.message
            if (!message) {
              resolve({ imagePath: null, responseText: null, error: 'Unexpected response format' })
              return
            }

            if (message.refusal) {
              resolve({ imagePath: null, responseText: null, error: `Model refused: ${message.refusal}` })
              return
            }

            // Extract text
            let responseText: string | null = null
            if (typeof message.content === 'string' && message.content) {
              responseText = message.content
            } else if (Array.isArray(message.content)) {
              for (const part of message.content) {
                if (part.type === 'text' && part.text) {
                  responseText = part.text
                }
              }
            }

            // Extract image data
            let imageBase64: string | null = null

            if (Array.isArray(message.images)) {
              for (const img of message.images) {
                const url = img.image_url?.url
                if (url) {
                  const commaIdx = url.indexOf(',')
                  if (commaIdx !== -1) { imageBase64 = url.substring(commaIdx + 1); break }
                }
              }
            }

            if (!imageBase64 && Array.isArray(message.content)) {
              for (const part of message.content) {
                if (part.type === 'image_url') {
                  const url = part.image_url?.url
                  if (url) {
                    const commaIdx = url.indexOf(',')
                    if (commaIdx !== -1) { imageBase64 = url.substring(commaIdx + 1); break }
                  }
                }
              }
            }

            if (!imageBase64) {
              resolve({ imagePath: null, responseText, error: responseText ? null : 'No image returned' })
              return
            }

            // Save image to disk
            const imagesDir = path.join(app.getPath('userData'), 'generated-images')
            if (!fs.existsSync(imagesDir)) {
              fs.mkdirSync(imagesDir, { recursive: true })
            }
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`
            const filePath = path.join(imagesDir, fileName)
            fs.writeFileSync(filePath, Buffer.from(imageBase64, 'base64'))

            // Append assistant message to conversation history
            const assistantContent: Record<string, unknown>[] = []
            if (responseText) { assistantContent.push({ type: 'text', text: responseText }) }
            if (message.images) { assistantContent.push(...message.images) }
            if (assistantContent.length > 0) {
              this.conversationHistory.push({ role: 'assistant', content: assistantContent })
            }

            resolve({ imagePath: filePath, responseText, error: null })
          } catch (err) {
            resolve({ imagePath: null, responseText: null, error: `Parse error: ${err instanceof Error ? err.message : String(err)}` })
          }
        })
      })

      request.on('error', (err) => {
        resolve({ imagePath: null, responseText: null, error: err.message })
      })

      request.write(body)
      request.end()
    })
  }
}
