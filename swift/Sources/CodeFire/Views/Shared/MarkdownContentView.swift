import SwiftUI

// MARK: - Markdown Content View

/// Parses markdown into block-level elements and renders each with proper styling.
/// Shared between the chat panel and the notes editor preview.
struct MarkdownContentView: View {
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(parseBlocks().enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .textSelection(.enabled)
    }

    // MARK: - Block Types

    private enum Block {
        case heading(level: Int, text: String)
        case paragraph(text: String)
        case listItem(text: String)
        case numberedItem(number: String, text: String)
        case blockquote(text: String)
        case codeBlock(code: String, language: String?)
        case table(headers: [String], rows: [[String]])
        case divider
    }

    // MARK: - Parser

    private func parseBlocks() -> [Block] {
        var blocks: [Block] = []
        let lines = content.components(separatedBy: "\n")
        var i = 0

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Code block (fenced)
            if trimmed.hasPrefix("```") {
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var codeLines: [String] = []
                i += 1
                while i < lines.count {
                    if lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                        i += 1
                        break
                    }
                    codeLines.append(lines[i])
                    i += 1
                }
                blocks.append(.codeBlock(
                    code: codeLines.joined(separator: "\n"),
                    language: language.isEmpty ? nil : language
                ))
                continue
            }

            // Horizontal rule
            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                blocks.append(.divider)
                i += 1
                continue
            }

            // Heading
            if trimmed.hasPrefix("#") {
                let level = trimmed.prefix(while: { $0 == "#" }).count
                if level <= 6 {
                    let text = String(trimmed.dropFirst(level)).trimmingCharacters(in: .whitespaces)
                    blocks.append(.heading(level: level, text: text))
                    i += 1
                    continue
                }
            }

            // Blockquote
            if trimmed.hasPrefix("> ") || trimmed == ">" {
                var quoteLines: [String] = []
                while i < lines.count {
                    let l = lines[i].trimmingCharacters(in: .whitespaces)
                    if l.hasPrefix("> ") {
                        quoteLines.append(String(l.dropFirst(2)))
                    } else if l == ">" {
                        quoteLines.append("")
                    } else {
                        break
                    }
                    i += 1
                }
                blocks.append(.blockquote(text: quoteLines.joined(separator: "\n")))
                continue
            }

            // Unordered list item
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                let text = String(trimmed.dropFirst(2))
                blocks.append(.listItem(text: text))
                i += 1
                continue
            }

            // Numbered list item
            if let match = trimmed.range(of: #"^\d+[\.\)]\s"#, options: .regularExpression) {
                let prefix = String(trimmed[match])
                let number = prefix.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: ".)"))
                let text = String(trimmed[match.upperBound...])
                blocks.append(.numberedItem(number: number, text: text))
                i += 1
                continue
            }

            // Table (pipes with separator row)
            if trimmed.hasPrefix("|") && trimmed.hasSuffix("|") {
                var tableLines: [String] = []
                while i < lines.count {
                    let l = lines[i].trimmingCharacters(in: .whitespaces)
                    guard l.hasPrefix("|") else { break }
                    tableLines.append(l)
                    i += 1
                }
                if tableLines.count >= 2 {
                    let parseCells: (String) -> [String] = { line in
                        line.split(separator: "|", omittingEmptySubsequences: false)
                            .map { $0.trimmingCharacters(in: .whitespaces) }
                            .filter { !$0.isEmpty }
                    }
                    let headers = parseCells(tableLines[0])
                    // Skip separator row (row of dashes)
                    let startRow = tableLines.count > 1 && tableLines[1].contains("---") ? 2 : 1
                    let rows = tableLines[startRow...].map { parseCells($0) }
                    blocks.append(.table(headers: headers, rows: Array(rows)))
                }
                continue
            }

            // Empty line — skip
            if trimmed.isEmpty {
                i += 1
                continue
            }

            // Paragraph — collect consecutive non-special lines
            var paraLines: [String] = []
            while i < lines.count {
                let l = lines[i].trimmingCharacters(in: .whitespaces)
                if l.isEmpty || l.hasPrefix("#") || l.hasPrefix("```") || l.hasPrefix("> ")
                    || l.hasPrefix("- ") || l.hasPrefix("* ") || l.hasPrefix("+ ")
                    || l == "---" || l == "***" || l == "___" {
                    break
                }
                if let _ = l.range(of: #"^\d+[\.\)]\s"#, options: .regularExpression) {
                    break
                }
                paraLines.append(lines[i])
                i += 1
            }
            if !paraLines.isEmpty {
                blocks.append(.paragraph(text: paraLines.joined(separator: " ")))
            }
        }

        return blocks
    }

    // MARK: - Block Rendering

    @ViewBuilder
    private func blockView(_ block: Block) -> some View {
        switch block {
        case .heading(let level, let text):
            inlineText(text)
                .font(.system(size: headingSize(level), weight: .semibold))
                .padding(.top, level <= 2 ? 4 : 2)

        case .paragraph(let text):
            inlineText(text)
                .font(.system(size: 12))

        case .listItem(let text):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\u{2022}")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                inlineText(text)
                    .font(.system(size: 12))
            }
            .padding(.leading, 4)

        case .numberedItem(let number, let text):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(number).")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .frame(minWidth: 16, alignment: .trailing)
                inlineText(text)
                    .font(.system(size: 12))
            }
            .padding(.leading, 4)

        case .blockquote(let text):
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color.accentColor.opacity(0.5))
                    .frame(width: 3)
                inlineText(text)
                    .font(.system(size: 12))
                    .italic()
                    .foregroundStyle(.secondary)
                    .padding(.leading, 8)
            }
            .padding(.vertical, 2)

        case .codeBlock(let code, _):
            Text(code)
                .font(.system(size: 11, design: .monospaced))
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color(nsColor: .textBackgroundColor).opacity(0.5))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
                )
                .textSelection(.enabled)

        case .table(let headers, let rows):
            VStack(alignment: .leading, spacing: 0) {
                // Header row
                HStack(spacing: 0) {
                    ForEach(Array(headers.enumerated()), id: \.offset) { _, header in
                        inlineText(header)
                            .font(.system(size: 11, weight: .semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                    }
                }
                .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))

                Divider()

                // Data rows
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                    HStack(spacing: 0) {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            inlineText(cell)
                                .font(.system(size: 11))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                        }
                    }
                    .background(rowIdx % 2 == 1 ? Color(nsColor: .controlBackgroundColor).opacity(0.2) : Color.clear)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
            )

        case .divider:
            Divider()
                .padding(.vertical, 2)
        }
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1: return 16
        case 2: return 14
        case 3: return 13
        default: return 12
        }
    }

    // MARK: - Inline Markdown Rendering

    /// Renders inline markdown: **bold**, *italic*, `code`
    private func inlineText(_ text: String) -> Text {
        var result = Text("")
        var remaining = text[text.startIndex...]

        while !remaining.isEmpty {
            // Bold: **text**
            if remaining.hasPrefix("**"),
               let endRange = remaining[remaining.index(remaining.startIndex, offsetBy: 2)...]
                .range(of: "**") {
                let inner = remaining[remaining.index(remaining.startIndex, offsetBy: 2)..<endRange.lowerBound]
                result = result + Text(inner).bold()
                remaining = remaining[endRange.upperBound...]
                continue
            }

            // Inline code: `code`
            if remaining.hasPrefix("`"),
               let endIdx = remaining[remaining.index(after: remaining.startIndex)...]
                .firstIndex(of: "`") {
                let inner = remaining[remaining.index(after: remaining.startIndex)..<endIdx]
                result = result + Text(inner)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(Color(nsColor: .systemOrange))
                remaining = remaining[remaining.index(after: endIdx)...]
                continue
            }

            // Italic: *text* (but not **)
            if remaining.hasPrefix("*") && !remaining.hasPrefix("**"),
               let endIdx = remaining[remaining.index(after: remaining.startIndex)...]
                .firstIndex(of: "*") {
                let inner = remaining[remaining.index(after: remaining.startIndex)..<endIdx]
                result = result + Text(inner).italic()
                remaining = remaining[remaining.index(after: endIdx)...]
                continue
            }

            // Plain character
            let nextSpecial = remaining.dropFirst().firstIndex(where: { $0 == "*" || $0 == "`" })
                ?? remaining.endIndex
            result = result + Text(remaining[remaining.startIndex..<nextSpecial])
            remaining = remaining[nextSpecial...]
        }

        return result
    }
}
