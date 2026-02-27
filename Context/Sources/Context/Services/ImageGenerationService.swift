import Foundation
import GRDB

actor ImageGenerationService {

    struct GenerationResult {
        let imageData: Data
        let responseText: String?
        let error: String?
    }

    private let model = "google/gemini-3.1-flash-image-preview"
    private let endpoint = "https://openrouter.ai/api/v1/chat/completions"

    // Per-session conversation history for multi-turn editing
    private var conversationHistory: [[String: Any]] = []

    /// Generate an image from a text prompt.
    func generateImage(
        prompt: String,
        aspectRatio: String = "1:1",
        imageSize: String = "1K"
    ) async -> GenerationResult {
        let message: [String: Any] = [
            "role": "user",
            "content": [["type": "text", "text": prompt]]
        ]
        conversationHistory.append(message)
        return await callAPI(aspectRatio: aspectRatio, imageSize: imageSize)
    }

    /// Edit an existing image with a text prompt (image-to-image).
    func editImage(
        imageData: Data,
        prompt: String,
        aspectRatio: String = "1:1",
        imageSize: String = "1K"
    ) async -> GenerationResult {
        let base64 = imageData.base64EncodedString()
        let dataURL = "data:image/png;base64,\(base64)"
        let message: [String: Any] = [
            "role": "user",
            "content": [
                ["type": "text", "text": prompt],
                ["type": "image_url", "image_url": ["url": dataURL]]
            ]
        ]
        conversationHistory.append(message)
        return await callAPI(aspectRatio: aspectRatio, imageSize: imageSize)
    }

    /// Clear conversation history to start a fresh session.
    func resetConversation() {
        conversationHistory = []
    }

    // MARK: - API Call

    private func callAPI(
        aspectRatio: String,
        imageSize: String
    ) async -> GenerationResult {
        let apiKey = await MainActor.run { ClaudeService.openRouterAPIKey }
        guard let apiKey, !apiKey.isEmpty else {
            return GenerationResult(imageData: Data(), responseText: nil, error: "OpenRouter API key not configured")
        }

        let body: [String: Any] = [
            "model": model,
            "modalities": ["image", "text"],
            "messages": conversationHistory,
            "image_config": [
                "aspect_ratio": aspectRatio,
                "image_size": imageSize
            ]
        ]

        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else {
            return GenerationResult(imageData: Data(), responseText: nil, error: "Failed to encode request")
        }

        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Context App", forHTTPHeaderField: "X-Title")
        request.httpBody = bodyData
        request.timeoutInterval = 120 // Image generation can take 10-30s

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                return GenerationResult(imageData: Data(), responseText: nil, error: "Invalid response")
            }

            guard httpResponse.statusCode == 200 else {
                let raw = String(data: data, encoding: .utf8) ?? "Unknown"
                return GenerationResult(imageData: Data(), responseText: nil, error: "HTTP \(httpResponse.statusCode): \(String(raw.prefix(300)))")
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return GenerationResult(imageData: Data(), responseText: nil, error: "Invalid JSON response")
            }

            if let error = json["error"] as? [String: Any],
               let message = error["message"] as? String {
                return GenerationResult(imageData: Data(), responseText: nil, error: message)
            }

            // Parse response: extract image data and optional text
            guard let choices = json["choices"] as? [[String: Any]],
                  let firstChoice = choices.first,
                  let message = firstChoice["message"] as? [String: Any],
                  let content = message["content"] as? [[String: Any]] else {
                return GenerationResult(imageData: Data(), responseText: nil, error: "Unexpected response format")
            }

            // Append assistant message to conversation history for multi-turn
            if let rawContent = message["content"] {
                let assistantMsg: [String: Any] = [
                    "role": "assistant",
                    "content": rawContent
                ]
                conversationHistory.append(assistantMsg)
            }

            var imageData: Data?
            var responseText: String?

            for part in content {
                guard let type = part["type"] as? String else { continue }
                if type == "image_url",
                   let imageUrl = part["image_url"] as? [String: Any],
                   let urlString = imageUrl["url"] as? String,
                   let commaIndex = urlString.firstIndex(of: ",") {
                    let base64String = String(urlString[urlString.index(after: commaIndex)...])
                    imageData = Data(base64Encoded: base64String)
                } else if type == "text",
                          let text = part["text"] as? String {
                    responseText = text
                }
            }

            guard let finalImageData = imageData, !finalImageData.isEmpty else {
                return GenerationResult(imageData: Data(), responseText: responseText, error: "No image in response")
            }

            return GenerationResult(imageData: finalImageData, responseText: responseText, error: nil)
        } catch {
            return GenerationResult(imageData: Data(), responseText: nil, error: error.localizedDescription)
        }
    }

    // MARK: - File Management

    /// Save image data to disk and create a DB record. Returns the saved GeneratedImage.
    /// This is a static function that runs on MainActor since it accesses DatabaseService.shared.
    @MainActor
    static func saveGeneration(
        imageData: Data,
        prompt: String,
        responseText: String?,
        projectId: String,
        projectPath: String,
        aspectRatio: String,
        imageSize: String,
        parentImageId: Int64? = nil
    ) -> GeneratedImage? {
        // Build save directory
        let saveDir: URL
        if projectPath.isEmpty {
            let appSupport = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first!.appendingPathComponent("Context/generated-images", isDirectory: true)
            saveDir = appSupport
        } else {
            saveDir = URL(fileURLWithPath: projectPath)
                .appendingPathComponent("assets/generated", isDirectory: true)
        }

        do {
            try FileManager.default.createDirectory(at: saveDir, withIntermediateDirectories: true)
        } catch {
            print("ImageGenerationService: failed to create directory: \(error)")
            return nil
        }

        // Generate unique filename
        let timestamp = Int(Date().timeIntervalSince1970)
        let filename = "gen_\(timestamp)_\(UUID().uuidString.prefix(8)).png"
        let filePath = saveDir.appendingPathComponent(filename)

        do {
            try imageData.write(to: filePath)
        } catch {
            print("ImageGenerationService: failed to write image: \(error)")
            return nil
        }

        // Insert DB record
        var image = GeneratedImage(
            projectId: projectId,
            prompt: prompt,
            responseText: responseText,
            filePath: filePath.path,
            aspectRatio: aspectRatio,
            imageSize: imageSize,
            parentImageId: parentImageId,
            createdAt: Date()
        )

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try image.insert(db)
            }
            return image
        } catch {
            print("ImageGenerationService: failed to insert DB record: \(error)")
            return nil
        }
    }
}
