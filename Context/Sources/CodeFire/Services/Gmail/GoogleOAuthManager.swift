import Foundation
import AppKit

@MainActor
class GoogleOAuthManager: NSObject, ObservableObject {
    @Published var isAuthenticating = false

    var clientId: String { UserDefaults.standard.string(forKey: "gmailClientId") ?? "" }
    var clientSecret: String {
        KeychainHelper.read(key: "gmailClientSecret") ?? ""
    }

    private let authURL = "https://accounts.google.com/o/oauth2/v2/auth"
    private let tokenURL = "https://oauth2.googleapis.com/token"
    private let scopes = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send"

    func startOAuthFlow() async -> GmailTokens? {
        isAuthenticating = true
        defer { isAuthenticating = false }

        // Start a temporary local HTTP server to receive Google's OAuth callback
        let server = LoopbackOAuthServer()
        guard let port = server.start() else {
            print("GoogleOAuth: failed to start loopback server")
            return nil
        }

        let redirectURI = "http://127.0.0.1:\(port)"

        var components = URLComponents(string: authURL)!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scopes),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent"),
        ]

        guard let authorizationURL = components.url else {
            server.stop()
            return nil
        }

        // Open Google sign-in in the user's default browser
        NSWorkspace.shared.open(authorizationURL)

        // Wait for the OAuth callback (times out after 5 minutes)
        let code = await server.waitForAuthCode()
        server.stop()

        guard let authCode = code else { return nil }
        return await exchangeCodeForTokens(code: authCode, redirectURI: redirectURI)
    }

    private func exchangeCodeForTokens(code: String, redirectURI: String) async -> GmailTokens? {
        var request = URLRequest(url: URL(string: tokenURL)!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "code=\(code)",
            "client_id=\(clientId)",
            "client_secret=\(clientSecret)",
            "redirect_uri=\(redirectURI)",
            "grant_type=authorization_code",
        ].joined(separator: "&")
        request.httpBody = body.data(using: .utf8)

        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String,
              let refreshToken = json["refresh_token"] as? String,
              let expiresIn = json["expires_in"] as? Int
        else { return nil }

        return GmailTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: Date().addingTimeInterval(TimeInterval(expiresIn))
        )
    }

    func refreshAccessToken(accountId: String) async -> String? {
        guard let refreshToken = KeychainHelper.read(key: "refreshToken-\(accountId)") else {
            return nil
        }

        var request = URLRequest(url: URL(string: tokenURL)!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "refresh_token=\(refreshToken)",
            "client_id=\(clientId)",
            "client_secret=\(clientSecret)",
            "grant_type=refresh_token",
        ].joined(separator: "&")
        request.httpBody = body.data(using: .utf8)

        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String,
              let expiresIn = json["expires_in"] as? Int
        else { return nil }

        try? KeychainHelper.save(key: "accessToken-\(accountId)", value: accessToken)
        let expiry = Date().addingTimeInterval(TimeInterval(expiresIn))
        try? KeychainHelper.save(
            key: "tokenExpiry-\(accountId)",
            value: String(expiry.timeIntervalSince1970)
        )

        return accessToken
    }

    func getValidToken(for accountId: String) async -> String? {
        if let expiryStr = KeychainHelper.read(key: "tokenExpiry-\(accountId)"),
           let expiry = Double(expiryStr),
           Date().timeIntervalSince1970 < expiry - 60,
           let token = KeychainHelper.read(key: "accessToken-\(accountId)") {
            return token
        }
        return await refreshAccessToken(accountId: accountId)
    }

    func saveTokens(_ tokens: GmailTokens, accountId: String) {
        try? KeychainHelper.save(key: "accessToken-\(accountId)", value: tokens.accessToken)
        try? KeychainHelper.save(key: "refreshToken-\(accountId)", value: tokens.refreshToken)
        try? KeychainHelper.save(
            key: "tokenExpiry-\(accountId)",
            value: String(tokens.expiresAt.timeIntervalSince1970)
        )
    }

    func deleteTokens(accountId: String) {
        KeychainHelper.delete(key: "accessToken-\(accountId)")
        KeychainHelper.delete(key: "refreshToken-\(accountId)")
        KeychainHelper.delete(key: "tokenExpiry-\(accountId)")
    }
}

// MARK: - Loopback OAuth Server

/// Ephemeral HTTP server on 127.0.0.1 that captures the Google OAuth callback.
/// Google's Desktop OAuth client type requires loopback redirects — custom URL
/// schemes like codefire:// are not allowed.
private class LoopbackOAuthServer {
    private var serverFd: Int32 = -1

    /// Binds to 127.0.0.1 on a random available port. Returns the port number.
    func start() -> UInt16? {
        serverFd = socket(AF_INET, SOCK_STREAM, 0)
        guard serverFd >= 0 else { return nil }

        var opt: Int32 = 1
        setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0 // OS assigns an available port
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(serverFd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            Darwin.close(serverFd)
            serverFd = -1
            return nil
        }

        guard listen(serverFd, 1) == 0 else {
            Darwin.close(serverFd)
            serverFd = -1
            return nil
        }

        // Read back the port the OS assigned
        var assignedAddr = sockaddr_in()
        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &assignedAddr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(serverFd, $0, &addrLen)
            }
        }

        return UInt16(bigEndian: assignedAddr.sin_port)
    }

    /// Blocks until the OAuth callback arrives or 5-minute timeout expires.
    func waitForAuthCode() async -> String? {
        let fd = serverFd
        guard fd >= 0 else { return nil }

        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                // Wait up to 5 minutes for the browser redirect
                var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
                let pollResult = poll(&pfd, 1, 300_000)
                guard pollResult > 0 else {
                    continuation.resume(returning: nil)
                    return
                }

                // Accept the incoming connection
                var clientAddr = sockaddr_in()
                var clientAddrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
                let clientFd = withUnsafeMutablePointer(to: &clientAddr) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        accept(fd, $0, &clientAddrLen)
                    }
                }
                guard clientFd >= 0 else {
                    continuation.resume(returning: nil)
                    return
                }

                // Prevent SIGPIPE if browser closes connection early
                var noSigPipe: Int32 = 1
                setsockopt(clientFd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe,
                           socklen_t(MemoryLayout<Int32>.size))

                // Read the HTTP request
                var buffer = [UInt8](repeating: 0, count: 4096)
                let bytesRead = recv(clientFd, &buffer, buffer.count, 0)
                guard bytesRead > 0 else {
                    Darwin.close(clientFd)
                    continuation.resume(returning: nil)
                    return
                }

                let requestStr = String(bytes: buffer[..<bytesRead], encoding: .utf8) ?? ""

                // Extract the authorization code from: GET /?code=XXXX&scope=... HTTP/1.1
                var authCode: String? = nil
                if let firstLine = requestStr.components(separatedBy: "\r\n").first,
                   firstLine.hasPrefix("GET "),
                   let urlPart = firstLine.split(separator: " ").dropFirst().first,
                   let components = URLComponents(string: String(urlPart)),
                   let code = components.queryItems?.first(where: { $0.name == "code" })?.value {
                    authCode = code
                }

                // Send a user-friendly response page
                let html: String
                if authCode != nil {
                    html = """
                    <html><body style="font-family:-apple-system,system-ui,sans-serif;\
                    display:flex;justify-content:center;align-items:center;height:80vh;\
                    flex-direction:column;color:#333;">\
                    <h2 style="margin-bottom:8px;">Signed in successfully</h2>\
                    <p style="color:#888;">You can close this tab and return to Context.</p>\
                    </body></html>
                    """
                } else {
                    html = """
                    <html><body style="font-family:-apple-system,system-ui,sans-serif;\
                    display:flex;justify-content:center;align-items:center;height:80vh;\
                    flex-direction:column;color:#333;">\
                    <h2 style="margin-bottom:8px;color:#c00;">Authentication failed</h2>\
                    <p style="color:#888;">Please try again from Context settings.</p>\
                    </body></html>
                    """
                }

                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(html.utf8.count)\r\nConnection: close\r\n\r\n\(html)"
                response.withCString { ptr in
                    _ = send(clientFd, ptr, strlen(ptr), 0)
                }

                Darwin.close(clientFd)
                continuation.resume(returning: authCode)
            }
        }
    }

    func stop() {
        if serverFd >= 0 {
            Darwin.close(serverFd)
            serverFd = -1
        }
    }
}

struct GmailTokens {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
}
