import Foundation
import SwiftUI

struct NetworkRequestEntry: Identifiable {
    let id: String  // requestId from JS
    let method: String
    let url: String
    let type: RequestType
    let startTime: Date
    var status: Int?
    var statusText: String?
    var duration: TimeInterval?
    var responseSize: Int?
    var requestHeaders: [String: String]?
    var responseHeaders: [String: String]?
    var responseBody: String?
    var isComplete: Bool = false
    var isError: Bool = false

    enum RequestType: String {
        case fetch = "fetch"
        case xhr = "xhr"

        var icon: String {
            switch self {
            case .fetch: return "arrow.up.arrow.down"
            case .xhr: return "network"
            }
        }
    }

    var statusColor: Color {
        guard let status else { return isError ? .red : .secondary }
        switch status {
        case 200..<300: return .green
        case 300..<400: return .blue
        case 400..<500: return .orange
        case 500..<600: return .red
        default: return .secondary
        }
    }

    var statusLabel: String {
        guard let status else { return isError ? "ERR" : "..." }
        if let text = statusText, !text.isEmpty {
            return "\(status) \(text)"
        }
        return "\(status)"
    }

    var formattedDuration: String {
        guard let duration else { return "..." }
        if duration < 1 {
            return "\(Int(duration * 1000))ms"
        }
        return String(format: "%.1fs", duration)
    }

    var formattedSize: String {
        guard let size = responseSize else { return "" }
        if size < 1024 { return "\(size) B" }
        if size < 1024 * 1024 { return "\(size / 1024) KB" }
        return String(format: "%.1f MB", Double(size) / (1024 * 1024))
    }

    var shortURL: String {
        guard let urlObj = URL(string: url) else { return url }
        let path = urlObj.path
        if path.isEmpty || path == "/" {
            return urlObj.host ?? url
        }
        return path
    }
}
