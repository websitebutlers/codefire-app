import Foundation

class GmailAPIService {
    private let baseURL = "https://gmail.googleapis.com/gmail/v1/users/me"
    private let oauthManager: GoogleOAuthManager

    init(oauthManager: GoogleOAuthManager) {
        self.oauthManager = oauthManager
    }

    // MARK: - Fetch User Profile

    func fetchProfile(accountId: String) async -> String? {
        guard let data = try? await request(path: "/profile", accountId: accountId) else {
            return nil
        }
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["emailAddress"] as? String
    }

    // MARK: - List Messages

    struct MessageListResponse {
        let messageIds: [(id: String, threadId: String)]
        let nextPageToken: String?
    }

    func listMessages(
        accountId: String,
        query: String = "",
        after: Date? = nil,
        pageToken: String? = nil,
        maxResults: Int = 50
    ) async -> MessageListResponse? {
        var q = query
        if let after {
            let epoch = Int(after.timeIntervalSince1970)
            q += (q.isEmpty ? "" : " ") + "after:\(epoch)"
        }

        var params = "maxResults=\(maxResults)"
        if !q.isEmpty { params += "&q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q)" }
        if let pageToken { params += "&pageToken=\(pageToken)" }

        guard let data = try? await request(path: "/messages?\(params)", accountId: accountId),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        let messages = (json["messages"] as? [[String: Any]])?.compactMap { msg -> (String, String)? in
            guard let id = msg["id"] as? String, let threadId = msg["threadId"] as? String else { return nil }
            return (id, threadId)
        } ?? []

        return MessageListResponse(
            messageIds: messages,
            nextPageToken: json["nextPageToken"] as? String
        )
    }

    // MARK: - Get Full Message

    struct GmailMessage {
        let id: String
        let threadId: String
        let from: String
        let subject: String
        let snippet: String
        let body: String
        let date: Date
        let isCalendarInvite: Bool
    }

    func getMessage(id: String, accountId: String) async -> GmailMessage? {
        guard let data = try? await request(path: "/messages/\(id)?format=full", accountId: accountId),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        let payload = json["payload"] as? [String: Any] ?? [:]
        let headers = (payload["headers"] as? [[String: String]]) ?? []

        let from = headers.first { $0["name"]?.lowercased() == "from" }?["value"] ?? ""
        let subject = headers.first { $0["name"]?.lowercased() == "subject" }?["value"] ?? "(no subject)"
        let dateStr = headers.first { $0["name"]?.lowercased() == "date" }?["value"] ?? ""
        let contentType = headers.first { $0["name"]?.lowercased() == "content-type" }?["value"] ?? ""
        let snippet = json["snippet"] as? String ?? ""

        let isCalendar = contentType.contains("calendar") ||
            (payload["parts"] as? [[String: Any]])?.contains { ($0["mimeType"] as? String)?.contains("calendar") == true } == true

        let body = extractPlainTextBody(from: payload)

        // Prefer internalDate (epoch ms) — always present and reliable
        let date: Date
        if let internalMs = json["internalDate"] as? String, let ms = Double(internalMs) {
            date = Date(timeIntervalSince1970: ms / 1000)
        } else {
            date = parseGmailDate(dateStr) ?? Date()
        }

        return GmailMessage(
            id: json["id"] as? String ?? id,
            threadId: json["threadId"] as? String ?? "",
            from: from,
            subject: subject,
            snippet: snippet,
            body: body,
            date: date,
            isCalendarInvite: isCalendar
        )
    }

    // MARK: - Send Reply

    func sendReply(
        accountId: String,
        threadId: String,
        inReplyTo: String,
        to: String,
        subject: String,
        body: String
    ) async -> Bool {
        let profile = await fetchProfile(accountId: accountId) ?? ""
        let message = [
            "From: \(profile)",
            "To: \(to)",
            "Subject: Re: \(subject)",
            "In-Reply-To: \(inReplyTo)",
            "References: \(inReplyTo)",
            "",
            body
        ].joined(separator: "\r\n")

        guard let messageData = message.data(using: .utf8) else { return false }
        let encoded = messageData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        let payload: [String: Any] = [
            "raw": encoded,
            "threadId": threadId,
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: payload) else { return false }

        guard let _ = try? await request(
            path: "/messages/send",
            accountId: accountId,
            method: "POST",
            body: jsonData,
            contentType: "application/json"
        ) else { return false }

        return true
    }

    // MARK: - HTTP Helper

    private func request(
        path: String,
        accountId: String,
        method: String = "GET",
        body: Data? = nil,
        contentType: String? = nil
    ) async throws -> Data {
        guard let token = await oauthManager.getValidToken(for: accountId) else {
            throw GmailAPIError.noToken
        }

        let url = URL(string: baseURL + path)!
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body { req.httpBody = body }
        if let ct = contentType { req.setValue(ct, forHTTPHeaderField: "Content-Type") }

        let (data, response) = try await URLSession.shared.data(for: req)
        let httpResponse = response as? HTTPURLResponse
        guard let statusCode = httpResponse?.statusCode, 200..<300 ~= statusCode else {
            throw GmailAPIError.httpError(httpResponse?.statusCode ?? 0)
        }
        return data
    }

    // MARK: - Body Extraction

    private func extractPlainTextBody(from payload: [String: Any]) -> String {
        if let mimeType = payload["mimeType"] as? String, mimeType == "text/plain" {
            if let body = payload["body"] as? [String: Any],
               let data = body["data"] as? String {
                return decodeBase64URL(data)
            }
        }

        if let parts = payload["parts"] as? [[String: Any]] {
            for part in parts {
                let result = extractPlainTextBody(from: part)
                if !result.isEmpty { return result }
            }
        }

        return ""
    }

    private func decodeBase64URL(_ str: String) -> String {
        var base64 = str
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    private func parseGmailDate(_ dateStr: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        for format in ["EEE, dd MMM yyyy HH:mm:ss Z", "dd MMM yyyy HH:mm:ss Z"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: dateStr) { return date }
        }
        return nil
    }

    enum GmailAPIError: Error {
        case noToken
        case httpError(Int)
    }
}
