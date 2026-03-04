import SwiftUI
import WebKit

struct WebViewWrapper: NSViewRepresentable {
    typealias NSViewType = WKWebView

    let webView: WKWebView

    func makeNSView(context: NSViewRepresentableContext<WebViewWrapper>) -> WKWebView {
        webView.navigationDelegate = context.coordinator
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: NSViewRepresentableContext<WebViewWrapper>) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator: NSObject, WKNavigationDelegate {
        func webView(
            _ webView: WKWebView,
            didReceive challenge: URLAuthenticationChallenge,
            completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
        ) {
            let host = challenge.protectionSpace.host
            if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
               let trust = challenge.protectionSpace.serverTrust,
               (host == "localhost" || host == "127.0.0.1") {
                completionHandler(.useCredential, URLCredential(trust: trust))
            } else {
                completionHandler(.performDefaultHandling, nil)
            }
        }
    }
}
