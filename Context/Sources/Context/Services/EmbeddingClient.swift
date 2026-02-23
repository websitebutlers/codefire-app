import Foundation

/// Calls OpenRouter's /embeddings endpoint to generate vector embeddings.
/// Supports batching (up to 100 texts per request) and retry with exponential backoff.
/// Sendable: all stored properties are immutable constants.
final class EmbeddingClient: Sendable {

    struct EmbeddingResult {
        let embeddings: [[Float]]
        let error: String?
    }

    private let maxRetries = 3
    private let batchSize = 100

    /// Embed a single text string. Returns 1536-dimensional vector or nil on failure.
    func embed(_ text: String) async -> (vector: [Float]?, error: String?) {
        let result = await embedBatch([text])
        if let error = result.error {
            return (nil, error)
        }
        return (result.embeddings.first, nil)
    }

    /// Embed multiple texts in batches of 20. Returns one vector per input text.
    /// If a batch fails after retries, those entries get empty embeddings.
    func embedBatch(_ texts: [String]) async -> EmbeddingResult {
        let (apiKey, model) = await MainActor.run {
            (
                ClaudeService.openRouterAPIKey,
                UserDefaults.standard.string(forKey: "embeddingModel") ?? "openai/text-embedding-3-small"
            )
        }

        guard let apiKey, !apiKey.isEmpty else {
            return EmbeddingResult(embeddings: [], error: "OpenRouter API key not configured")
        }
        var allEmbeddings: [[Float]] = []

        for batchStart in stride(from: 0, to: texts.count, by: batchSize) {
            let batchEnd = min(batchStart + batchSize, texts.count)
            let batch = Array(texts[batchStart..<batchEnd])

            var lastError: String?
            var batchEmbeddings: [[Float]]?

            for attempt in 0..<maxRetries {
                if attempt > 0 {
                    try? await Task.sleep(nanoseconds: UInt64(pow(2.0, Double(attempt - 1))) * 1_000_000_000)
                }

                let result = await callOpenRouterEmbeddings(
                    apiKey: apiKey,
                    model: model,
                    inputs: batch
                )

                if let error = result.error {
                    lastError = error
                    continue
                }

                batchEmbeddings = result.embeddings
                break
            }

            if let embeddings = batchEmbeddings {
                allEmbeddings.append(contentsOf: embeddings)
            } else {
                for _ in batch {
                    allEmbeddings.append([])
                }
                if allEmbeddings.isEmpty {
                    return EmbeddingResult(embeddings: allEmbeddings, error: lastError)
                }
            }
        }

        return EmbeddingResult(embeddings: allEmbeddings, error: nil)
    }

    // MARK: - HTTP Call

    private func callOpenRouterEmbeddings(
        apiKey: String,
        model: String,
        inputs: [String]
    ) async -> EmbeddingResult {
        let url = URL(string: "https://openrouter.ai/api/v1/embeddings")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Context App", forHTTPHeaderField: "X-Title")
        request.timeoutInterval = 30

        let body: [String: Any] = [
            "model": model,
            "input": inputs
        ]

        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else {
            return EmbeddingResult(embeddings: [], error: "Failed to encode request")
        }
        request.httpBody = bodyData

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                return EmbeddingResult(embeddings: [], error: "Invalid response")
            }

            guard httpResponse.statusCode == 200 else {
                let raw = String(data: data, encoding: .utf8) ?? "Unknown"
                return EmbeddingResult(embeddings: [], error: "HTTP \(httpResponse.statusCode): \(String(raw.prefix(200)))")
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return EmbeddingResult(embeddings: [], error: "Invalid JSON response")
            }

            if let error = json["error"] as? [String: Any],
               let message = error["message"] as? String {
                return EmbeddingResult(embeddings: [], error: message)
            }

            guard let dataArray = json["data"] as? [[String: Any]] else {
                return EmbeddingResult(embeddings: [], error: "Missing 'data' in response")
            }

            let sorted = dataArray.sorted { ($0["index"] as? Int ?? 0) < ($1["index"] as? Int ?? 0) }

            let embeddings: [[Float]] = sorted.compactMap { item in
                guard let embedding = item["embedding"] as? [NSNumber] else { return nil }
                return embedding.map { $0.floatValue }
            }

            guard embeddings.count == inputs.count else {
                return EmbeddingResult(embeddings: [], error: "Embedding count mismatch: got \(embeddings.count), expected \(inputs.count)")
            }

            return EmbeddingResult(embeddings: embeddings, error: nil)
        } catch {
            return EmbeddingResult(embeddings: [], error: error.localizedDescription)
        }
    }
}
