import Foundation

struct RawNewsItem {
    let title: String
    let url: String
    let sourceName: String
    let snippet: String?
    let publishedAt: Date?
}

enum NewsFetcher {

    // MARK: - Public API

    static func fetchAll(rssFeeds: [String], subreddits: [String]) async -> [RawNewsItem] {
        var allItems: [RawNewsItem] = []

        await withTaskGroup(of: [RawNewsItem].self) { group in
            group.addTask { await fetchHackerNews() }
            group.addTask { await fetchReddit(subreddits: subreddits) }
            group.addTask { await fetchRSSFeeds(urls: rssFeeds) }

            for await items in group {
                allItems.append(contentsOf: items)
            }
        }

        return deduplicateAndCap(allItems, limit: 80)
    }

    // MARK: - Hacker News (Algolia API)

    static func fetchHackerNews() async -> [RawNewsItem] {
        let urlString = "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=30"
        guard let url = URL(string: urlString) else { return [] }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let hits = json["hits"] as? [[String: Any]] else { return [] }

            return hits.compactMap { hit -> RawNewsItem? in
                guard let title = hit["title"] as? String, !title.isEmpty else { return nil }

                let itemUrl: String
                if let url = hit["url"] as? String, !url.isEmpty {
                    itemUrl = url
                } else if let objectID = hit["objectID"] as? String {
                    itemUrl = "https://news.ycombinator.com/item?id=\(objectID)"
                } else {
                    return nil
                }

                let snippet = hit["story_text"] as? String
                var publishedAt: Date?
                if let dateStr = hit["created_at"] as? String {
                    publishedAt = ISO8601DateFormatter().date(from: dateStr)
                }

                return RawNewsItem(
                    title: title,
                    url: itemUrl,
                    sourceName: "Hacker News",
                    snippet: snippet.map { String($0.prefix(300)) },
                    publishedAt: publishedAt
                )
            }
        } catch {
            print("NewsFetcher: HN fetch failed: \(error)")
            return []
        }
    }

    // MARK: - Reddit JSON API

    static func fetchReddit(subreddits: [String]) async -> [RawNewsItem] {
        var items: [RawNewsItem] = []

        for sub in subreddits {
            let urlString = "https://www.reddit.com/r/\(sub)/top/.json?t=day&limit=25"
            guard let url = URL(string: urlString) else { continue }

            var request = URLRequest(url: url)
            request.setValue("CodeFire/1.0", forHTTPHeaderField: "User-Agent")

            do {
                let (data, _) = try await URLSession.shared.data(for: request)
                guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let dataObj = json["data"] as? [String: Any],
                      let children = dataObj["children"] as? [[String: Any]] else { continue }

                for child in children {
                    guard let postData = child["data"] as? [String: Any],
                          let title = postData["title"] as? String else { continue }

                    let postUrl = postData["url"] as? String ?? postData["permalink"] as? String ?? ""
                    let finalUrl = postUrl.hasPrefix("http") ? postUrl : "https://www.reddit.com\(postUrl)"
                    let snippet = postData["selftext"] as? String

                    var publishedAt: Date?
                    if let utc = postData["created_utc"] as? Double {
                        publishedAt = Date(timeIntervalSince1970: utc)
                    }

                    items.append(RawNewsItem(
                        title: title,
                        url: finalUrl,
                        sourceName: "r/\(sub)",
                        snippet: snippet.flatMap { $0.isEmpty ? nil : String($0.prefix(300)) },
                        publishedAt: publishedAt
                    ))
                }
            } catch {
                print("NewsFetcher: Reddit r/\(sub) fetch failed: \(error)")
            }
        }

        return items
    }

    // MARK: - RSS/Atom Feeds

    static func fetchRSSFeeds(urls: [String]) async -> [RawNewsItem] {
        var items: [RawNewsItem] = []

        await withTaskGroup(of: [RawNewsItem].self) { group in
            for urlString in urls {
                group.addTask {
                    await fetchSingleRSSFeed(urlString: urlString)
                }
            }

            for await feedItems in group {
                items.append(contentsOf: feedItems)
            }
        }

        return items
    }

    private static func fetchSingleRSSFeed(urlString: String) async -> [RawNewsItem] {
        guard let url = URL(string: urlString) else { return [] }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let parser = RSSParser(feedUrl: urlString)
            return parser.parse(data: data)
        } catch {
            print("NewsFetcher: RSS fetch failed for \(urlString): \(error)")
            return []
        }
    }

    // MARK: - Deduplication

    static func deduplicateAndCap(_ items: [RawNewsItem], limit: Int = 80) -> [RawNewsItem] {
        var seen = Set<String>()
        var unique: [RawNewsItem] = []

        for item in items {
            // Normalize URL for dedup (strip trailing slashes, query params for some)
            let normalizedUrl = item.url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if seen.insert(normalizedUrl).inserted {
                unique.append(item)
            }
        }

        return Array(unique.prefix(limit))
    }
}

// MARK: - RSS/Atom XML Parser

private class RSSParser: NSObject, XMLParserDelegate {
    private let feedUrl: String
    private var items: [RawNewsItem] = []

    // State
    private var currentElement = ""
    private var inItem = false
    private var currentTitle = ""
    private var currentLink = ""
    private var currentDescription = ""
    private var currentPubDate = ""

    // Feed-level info for source name
    private var feedTitle = ""
    private var inChannel = false
    private var gotFeedTitle = false

    init(feedUrl: String) {
        self.feedUrl = feedUrl
    }

    func parse(data: Data) -> [RawNewsItem] {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.parse()
        return Array(items.prefix(10))
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName: String?,
                attributes: [String: String] = [:]) {
        currentElement = elementName

        if elementName == "item" || elementName == "entry" {
            inItem = true
            currentTitle = ""
            currentLink = ""
            currentDescription = ""
            currentPubDate = ""
        } else if elementName == "channel" || elementName == "feed" {
            inChannel = true
        }

        // Atom links use href attribute
        if inItem && elementName == "link", let href = attributes["href"] {
            currentLink = href
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inItem {
            switch currentElement {
            case "title": currentTitle += string
            case "link": currentLink += string
            case "description", "summary", "content": currentDescription += string
            case "pubDate", "updated", "published": currentPubDate += string
            default: break
            }
        } else if inChannel && currentElement == "title" && !gotFeedTitle {
            feedTitle += string
        }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName: String?) {
        if elementName == "item" || elementName == "entry" {
            inItem = false

            let title = currentTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let link = currentLink.trimmingCharacters(in: .whitespacesAndNewlines)

            guard !title.isEmpty, !link.isEmpty else { return }

            let sourceName = feedTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let snippet = currentDescription.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)

            var publishedAt: Date?
            let dateStr = currentPubDate.trimmingCharacters(in: .whitespacesAndNewlines)
            if !dateStr.isEmpty {
                publishedAt = parseDate(dateStr)
            }

            items.append(RawNewsItem(
                title: title,
                url: link,
                sourceName: sourceName.isEmpty ? (URL(string: feedUrl)?.host ?? "RSS") : sourceName,
                snippet: snippet.isEmpty ? nil : String(snippet.prefix(300)),
                publishedAt: publishedAt
            ))
        } else if elementName == "channel" || elementName == "feed" {
            inChannel = false
            gotFeedTitle = true
        }
    }

    private func parseDate(_ string: String) -> Date? {
        // Try RFC 2822 (RSS)
        let rfc2822 = DateFormatter()
        rfc2822.locale = Locale(identifier: "en_US_POSIX")
        rfc2822.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        if let date = rfc2822.date(from: string) { return date }

        // Try RFC 2822 without day name
        rfc2822.dateFormat = "dd MMM yyyy HH:mm:ss Z"
        if let date = rfc2822.date(from: string) { return date }

        // Try ISO 8601 (Atom)
        return ISO8601DateFormatter().date(from: string)
    }
}
