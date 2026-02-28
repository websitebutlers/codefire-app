import SwiftUI

// MARK: - DiffViewerView

struct DiffViewerView: View {
    let filePath: String

    @State private var diffLines: [DiffLine] = []
    @State private var isLoading = true
    @State private var hasChanges = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !hasChanges {
                VStack(spacing: 10) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                    Text("No uncommitted changes")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.secondary)
                    Text("This file matches the last committed version")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView([.horizontal, .vertical]) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(diffLines.enumerated()), id: \.offset) { _, line in
                            diffLineView(line)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .onAppear { loadDiff() }
    }

    // MARK: - Diff Line View

    private func diffLineView(_ line: DiffLine) -> some View {
        HStack(spacing: 0) {
            // Line prefix
            Text(line.prefix)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(line.prefixColor)
                .frame(width: 16, alignment: .center)

            // Line content
            Text(line.text)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(line.textColor)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 0.5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(line.backgroundColor)
    }

    // MARK: - Load Diff

    private func loadDiff() {
        isLoading = true

        DispatchQueue.global(qos: .userInitiated).async {
            let result = runGitDiff(for: filePath)
            let parsed = parseDiff(result)

            DispatchQueue.main.async {
                self.diffLines = parsed
                self.hasChanges = !parsed.isEmpty
                self.isLoading = false
            }
        }
    }

    // MARK: - Git Diff

    private func runGitDiff(for path: String) -> String {
        let process = Process()
        let pipe = Pipe()

        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["diff", "--no-color", "--", path]

        // Set working directory to the file's parent directory
        let fileURL = URL(fileURLWithPath: path)
        process.currentDirectoryURL = fileURL.deletingLastPathComponent()

        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()

            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8) ?? ""
        } catch {
            return ""
        }
    }

    // MARK: - Parse Diff

    private func parseDiff(_ diff: String) -> [DiffLine] {
        Self.parseDiffStatic(diff)
    }

    /// Static parser usable from other views (e.g. GitChangesView).
    static func parseDiffStatic(_ diff: String) -> [DiffLine] {
        guard !diff.isEmpty else { return [] }

        var lines: [DiffLine] = []
        let rawLines = diff.components(separatedBy: "\n")
        var oldLine = 0
        var newLine = 0

        for rawLine in rawLines {
            if rawLine.hasPrefix("@@") {
                // Parse hunk header: @@ -old,count +new,count @@
                let parts = rawLine.components(separatedBy: " ")
                if parts.count >= 3 {
                    let oldPart = parts[1].dropFirst() // remove "-"
                    let newPart = parts[2].dropFirst() // remove "+"
                    oldLine = Int(oldPart.components(separatedBy: ",").first ?? "0") ?? 0
                    newLine = Int(newPart.components(separatedBy: ",").first ?? "0") ?? 0
                }
                lines.append(DiffLine(type: .header, text: rawLine, prefix: " "))
            } else if rawLine.hasPrefix("+") && !rawLine.hasPrefix("+++") {
                let text = String(rawLine.dropFirst())
                lines.append(DiffLine(type: .addition, text: text, prefix: "+", newLineNumber: newLine))
                newLine += 1
            } else if rawLine.hasPrefix("-") && !rawLine.hasPrefix("---") {
                let text = String(rawLine.dropFirst())
                lines.append(DiffLine(type: .deletion, text: text, prefix: "-", oldLineNumber: oldLine))
                oldLine += 1
            } else if rawLine.hasPrefix("diff ") || rawLine.hasPrefix("index ") ||
                        rawLine.hasPrefix("---") || rawLine.hasPrefix("+++") {
                continue
            } else if rawLine.hasPrefix(" ") {
                let text = String(rawLine.dropFirst())
                lines.append(DiffLine(type: .context, text: text, prefix: " ", oldLineNumber: oldLine, newLineNumber: newLine))
                oldLine += 1
                newLine += 1
            } else if !rawLine.isEmpty {
                lines.append(DiffLine(type: .context, text: rawLine, prefix: " "))
            }
        }

        return lines
    }
}

// MARK: - DiffLine Model

struct DiffLine {
    enum LineType {
        case context
        case addition
        case deletion
        case header
    }

    let type: LineType
    let text: String
    let prefix: String
    var oldLineNumber: Int?
    var newLineNumber: Int?

    var backgroundColor: Color {
        switch type {
        case .addition: return Color.green.opacity(0.12)
        case .deletion: return Color.red.opacity(0.12)
        case .header: return Color.blue.opacity(0.08)
        case .context: return Color.clear
        }
    }

    var textColor: Color {
        switch type {
        case .addition: return Color.green
        case .deletion: return Color.red
        case .header: return Color.secondary
        case .context: return Color.primary
        }
    }

    var prefixColor: Color {
        switch type {
        case .addition: return Color.green
        case .deletion: return Color.red
        case .header: return Color.secondary
        case .context: return Color.secondary
        }
    }
}
