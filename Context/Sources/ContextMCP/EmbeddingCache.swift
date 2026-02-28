import Foundation

/// LRU cache for query embedding vectors. Avoids redundant OpenRouter API calls
/// for repeated or similar queries within the same MCP session.
final class EmbeddingCache {
    private var cache: [String: [Float]] = [:]
    private var accessOrder: [String] = []
    private let maxEntries: Int

    init(maxEntries: Int = 50) {
        self.maxEntries = maxEntries
    }

    /// Get a cached embedding vector for the given query, or nil if not cached.
    func get(_ query: String) -> [Float]? {
        let key = normalize(query)
        guard let vector = cache[key] else { return nil }

        // Move to end of access order (most recently used)
        if let idx = accessOrder.firstIndex(of: key) {
            accessOrder.remove(at: idx)
            accessOrder.append(key)
        }

        return vector
    }

    /// Store an embedding vector for the given query.
    func set(_ query: String, vector: [Float]) {
        let key = normalize(query)

        // Evict oldest if at capacity
        if cache[key] == nil && cache.count >= maxEntries {
            if let oldest = accessOrder.first {
                cache.removeValue(forKey: oldest)
                accessOrder.removeFirst()
            }
        }

        cache[key] = vector
        if let idx = accessOrder.firstIndex(of: key) {
            accessOrder.remove(at: idx)
        }
        accessOrder.append(key)
    }

    /// Normalize query string for cache key (lowercase, trim, collapse whitespace).
    private func normalize(_ query: String) -> String {
        query.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .whitespaces)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
