import { net } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
const MODEL = 'google/gemini-2.5-flash-image'
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

interface GenerationResult {
  imagePath: string | null
  responseText: string | null
  error: string | null
}

export class ImageGenerationService {
  private conversationHistory: Record<string, unknown>[] = []

  async generate(
    prompt: string,
    apiKey: string,
    aspectRatio = '1:1',
    imageSize = '1K'
  ): Promise<GenerationResult> {
    if (!apiKey) {
      return { imagePath: null, responseText: null, error: 'OpenRouter API key not configured' }
    }

    const message = {
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    }
    this.conversationHistory.push(message)

    return this.callAPI(apiKey, aspectRatio, imageSize)
  }

  resetConversation() {
    this.conversationHistory = []
  }

  private async callAPI(
    apiKey: string,
    aspectRatio: string,
    imageSize: string
  ): Promise<GenerationResult> {
    const body = JSON.stringify({
      model: MODEL,
      modalities: ['image', 'text'],
      messages: this.conversationHistory,
      image_config: {
        aspect_ratio: aspectRatio,
        image_size: imageSize,
      },
    })

    return new Promise((resolve) => {
      const request = net.request({
        method: 'POST',
        url: ENDPOINT,
      })

      request.setHeader('Authorization', `Bearer ${apiKey}`)
      request.setHeader('Content-Type', 'application/json')
      request.setHeader('X-Title', 'CodeFire')

      let responseData = ''

      request.on('response', (response) => {
        response.on('data', (chunk) => {
          responseData += chunk.toString()
        })

        response.on('end', () => {
          if (response.statusCode !== 200) {
            resolve({
              imagePath: null,
              responseText: null,
              error: `HTTP ${response.statusCode}: ${responseData.substring(0, 300)}`,
            })
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

            // Primary: message.images[] (OpenRouter format)
            if (Array.isArray(message.images)) {
              for (const img of message.images) {
                const url = img.image_url?.url
                if (url) {
                  const commaIdx = url.indexOf(',')
                  if (commaIdx !== -1) {
                    imageBase64 = url.substring(commaIdx + 1)
                    break
                  }
                }
              }
            }

            // Fallback: content array with image_url parts
            if (!imageBase64 && Array.isArray(message.content)) {
              for (const part of message.content) {
                if (part.type === 'image_url') {
                  const url = part.image_url?.url
                  if (url) {
                    const commaIdx = url.indexOf(',')
                    if (commaIdx !== -1) {
                      imageBase64 = url.substring(commaIdx + 1)
                      break
                    }
                  }
                }
              }
            }

            if (!imageBase64) {
              resolve({
                imagePath: null,
                responseText,
                error: responseText ? null : 'No image returned',
              })
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
            if (responseText) {
              assistantContent.push({ type: 'text', text: responseText })
            }
            if (message.images) {
              assistantContent.push(...message.images)
            }
            if (assistantContent.length > 0) {
              this.conversationHistory.push({
                role: 'assistant',
                content: assistantContent,
              })
            }

            resolve({ imagePath: filePath, responseText, error: null })
          } catch (err) {
            resolve({
              imagePath: null,
              responseText: null,
              error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            })
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
