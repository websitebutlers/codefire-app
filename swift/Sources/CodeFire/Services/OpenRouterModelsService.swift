import Foundation

// MARK: - Model

struct OpenRouterModel: Codable, Identifiable, Hashable {
    let id: String           // e.g. "qwen/qwen3-coder"
    let name: String         // e.g. "Qwen: Qwen3 Coder 480B"
    let contextLength: Int
    let promptPrice: Double  // per million tokens
    let completionPrice: Double
    let supportsTools: Bool
}

// MARK: - Service

@MainActor
class OpenRouterModelsService: ObservableObject {
    static let shared = OpenRouterModelsService()

    @Published var models: [OpenRouterModel] = []
    @Published var isLoading = false
    @Published var lastError: String?

    private let cacheKey = "openRouterModelsCache"
    private let cacheTimestampKey = "openRouterModelsCacheTimestamp"
    private let cacheTTL: TimeInterval = 3600

    private init() {
        // Load from cache immediately so models are available before any async fetch
        if let cached = loadFromCache() {
            models = cached
        }
    }

    /// Human-readable name for a model ID.
    /// Checks fetched models first, then derives from the ID.
    func displayName(for modelId: String) -> String {
        if let model = models.first(where: { $0.id == modelId }) {
            return model.name
        }
        // Derive from ID: "qwen/qwen3-coder" -> "Qwen3 Coder"
        let slug = modelId.contains("/") ? String(modelId.split(separator: "/").last!) : modelId
        return slug
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    /// Load models from cache if fresh, otherwise fetch from API.
    func loadModels() async {
        if isCacheFresh(), !models.isEmpty { return }
        await fetchAndCache()
    }

    /// Force refresh, ignoring cache.
    func refreshModels() async {
        await fetchAndCache()
    }

    private func fetchAndCache() async {
        isLoading = true
        lastError = nil
        do {
            let fetched = try await fetchFromAPI()
            models = fetched
            saveToCache(fetched)
        } catch {
            lastError = error.localizedDescription
            // Keep stale cache data if available
        }
        isLoading = false
    }

    // MARK: - API

    private nonisolated func fetchFromAPI() async throws -> [OpenRouterModel] {
        let url = URL(string: "https://openrouter.ai/api/v1/models?category=programming")!
        var request = URLRequest(url: url)
        request.setValue("CodeFire", forHTTPHeaderField: "X-Title")
        request.timeoutInterval = 15

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        let decoded = try JSONDecoder().decode(ModelsResponse.self, from: data)

        return decoded.data
            .filter { raw in
                raw.supportedParameters?.contains("tools") == true
            }
            .map { raw in
                let promptPerMillion = (Double(raw.pricing?.prompt ?? "0") ?? 0) * 1_000_000
                let completionPerMillion = (Double(raw.pricing?.completion ?? "0") ?? 0) * 1_000_000
                return OpenRouterModel(
                    id: raw.id,
                    name: cleanModelName(raw.name),
                    contextLength: raw.contextLength ?? 0,
                    promptPrice: promptPerMillion,
                    completionPrice: completionPerMillion,
                    supportsTools: true
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Strip provider prefix that OpenRouter often repeats in model names.
    /// e.g. "Qwen: Qwen3 Coder 480B A35B (free)" -> "Qwen3 Coder 480B A35B (free)"
    private nonisolated func cleanModelName(_ raw: String) -> String {
        if let colonRange = raw.range(of: ": ") {
            return String(raw[colonRange.upperBound...]).trimmingCharacters(in: .whitespaces)
        }
        return raw
    }

    // MARK: - Cache

    private func loadFromCache() -> [OpenRouterModel]? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode([OpenRouterModel].self, from: data)
    }

    private func saveToCache(_ models: [OpenRouterModel]) {
        if let data = try? JSONEncoder().encode(models) {
            UserDefaults.standard.set(data, forKey: cacheKey)
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: cacheTimestampKey)
        }
    }

    private func isCacheFresh() -> Bool {
        let timestamp = UserDefaults.standard.double(forKey: cacheTimestampKey)
        guard timestamp > 0 else { return false }
        return Date().timeIntervalSince1970 - timestamp < cacheTTL
    }
}

// MARK: - API Response Types

private struct ModelsResponse: Codable {
    let data: [RawModel]
}

private struct RawModel: Codable {
    let id: String
    let name: String
    let contextLength: Int?
    let pricing: Pricing?
    let supportedParameters: [String]?

    enum CodingKeys: String, CodingKey {
        case id, name, pricing
        case contextLength = "context_length"
        case supportedParameters = "supported_parameters"
    }
}

private struct Pricing: Codable {
    let prompt: String?
    let completion: String?
}
