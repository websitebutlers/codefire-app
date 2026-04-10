import SwiftUI
import AppKit

// MARK: - CodeViewerView (NSViewRepresentable)

struct CodeViewerView: NSViewRepresentable {
    let content: String
    let language: String?
    var onCreateTask: ((String) -> Void)? = nil
    var onAddToNotes: ((String) -> Void)? = nil
    var onInsertIntoTerminal: ((String) -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: NSViewRepresentableContext<CodeViewerView>) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = true
        scrollView.backgroundColor = NSColor.textBackgroundColor

        let textView = FileTextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.textColor = NSColor.labelColor
        textView.backgroundColor = NSColor.textBackgroundColor
        textView.autoresizingMask = [.width]
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = true
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true

        textView.onCreateTask = onCreateTask
        textView.onAddToNotes = onAddToNotes
        textView.onInsertIntoTerminal = onInsertIntoTerminal

        scrollView.documentView = textView

        // Line number ruler
        scrollView.hasVerticalRuler = true
        scrollView.rulersVisible = true
        let ruler = LineNumberRulerView(textView: textView)
        scrollView.verticalRulerView = ruler

        context.coordinator.textView = textView
        context.coordinator.rulerView = ruler

        applyHighlighting(to: textView, coordinator: context.coordinator)

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: NSViewRepresentableContext<CodeViewerView>) {
        let coord = context.coordinator
        if let fileTV = coord.textView as? FileTextView {
            fileTV.onCreateTask = onCreateTask
            fileTV.onAddToNotes = onAddToNotes
            fileTV.onInsertIntoTerminal = onInsertIntoTerminal
        }
        if coord.lastContent != content || coord.lastLanguage != language {
            if let textView = coord.textView {
                applyHighlighting(to: textView, coordinator: coord)
            }
        }
    }

    private func applyHighlighting(to textView: NSTextView, coordinator: Coordinator) {
        let highlighted = SyntaxHighlighter.highlight(content, language: language)
        textView.textStorage?.setAttributedString(highlighted)
        coordinator.lastContent = content
        coordinator.lastLanguage = language
        coordinator.rulerView?.needsDisplay = true
    }

    class Coordinator {
        var textView: NSTextView?
        var rulerView: LineNumberRulerView?
        var lastContent: String?
        var lastLanguage: String?
    }
}

// MARK: - Line Number Ruler

class LineNumberRulerView: NSRulerView {
    private weak var textView: NSTextView?

    init(textView: NSTextView) {
        self.textView = textView
        super.init(scrollView: textView.enclosingScrollView!, orientation: .verticalRuler)
        self.ruleThickness = 44
        self.clientView = textView

        NotificationCenter.default.addObserver(
            self, selector: #selector(textDidChange),
            name: NSText.didChangeNotification, object: textView
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(boundsDidChange),
            name: NSView.boundsDidChangeNotification,
            object: textView.enclosingScrollView?.contentView
        )
    }

    required init(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @objc private func textDidChange(_ notification: Notification) {
        needsDisplay = true
    }

    @objc private func boundsDidChange(_ notification: Notification) {
        needsDisplay = true
    }

    override func drawHashMarksAndLabels(in rect: NSRect) {
        guard let textView, let layoutManager = textView.layoutManager,
              let textContainer = textView.textContainer else { return }

        let visibleRect = scrollView?.contentView.bounds ?? rect
        let rulerBgColor = NSColor.controlBackgroundColor.withAlphaComponent(0.6)
        rulerBgColor.setFill()
        rect.fill()

        // Draw separator line on right edge
        NSColor.separatorColor.setStroke()
        let sepPath = NSBezierPath()
        sepPath.move(to: NSPoint(x: rect.maxX - 0.5, y: rect.minY))
        sepPath.line(to: NSPoint(x: rect.maxX - 0.5, y: rect.maxY))
        sepPath.lineWidth = 0.5
        sepPath.stroke()

        let text = textView.string as NSString
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .regular),
            .foregroundColor: NSColor.secondaryLabelColor
        ]

        let glyphRange = layoutManager.glyphRange(forBoundingRect: visibleRect, in: textContainer)
        let charRange = layoutManager.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)

        var lineNumber = 1
        // Count lines before visible range
        text.enumerateSubstrings(in: NSRange(location: 0, length: charRange.location), options: [.byLines, .substringNotRequired]) { _, _, _, _ in
            lineNumber += 1
        }

        text.enumerateSubstrings(in: charRange, options: [.byLines, .substringNotRequired]) { _, substringRange, _, _ in
            let glyphIdx = layoutManager.glyphIndexForCharacter(at: substringRange.location)
            var lineRect = layoutManager.lineFragmentRect(forGlyphAt: glyphIdx, effectiveRange: nil)
            lineRect.origin.y -= visibleRect.origin.y

            let lineStr = "\(lineNumber)" as NSString
            let strSize = lineStr.size(withAttributes: attrs)
            let drawPoint = NSPoint(
                x: self.ruleThickness - strSize.width - 8,
                y: lineRect.origin.y + (lineRect.height - strSize.height) / 2
            )
            lineStr.draw(at: drawPoint, withAttributes: attrs)
            lineNumber += 1
        }
    }
}

// MARK: - Syntax Highlighter

struct SyntaxHighlighter {

    // MARK: - Language Configuration

    struct LanguageConfig {
        let keywords: Set<String>
        let lineComment: String?
        let blockCommentStart: String?
        let blockCommentEnd: String?
        let stringDelimiters: [Character]

        static let swift = LanguageConfig(
            keywords: ["import", "func", "var", "let", "class", "struct", "enum", "protocol",
                       "extension", "if", "else", "guard", "switch", "case", "default", "for",
                       "while", "repeat", "return", "throw", "throws", "try", "catch", "do",
                       "in", "where", "as", "is", "nil", "true", "false", "self", "Self",
                       "super", "init", "deinit", "typealias", "associatedtype", "static",
                       "private", "fileprivate", "internal", "public", "open", "override",
                       "mutating", "nonmutating", "lazy", "weak", "unowned", "inout", "some",
                       "any", "async", "await", "@Published", "@State", "@Binding",
                       "@ObservedObject", "@EnvironmentObject", "@StateObject", "@MainActor"],
            lineComment: "//",
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            stringDelimiters: ["\""]
        )

        static let typescript = LanguageConfig(
            keywords: ["import", "export", "from", "function", "const", "let", "var", "class",
                       "interface", "type", "enum", "if", "else", "switch", "case", "default",
                       "for", "while", "do", "return", "throw", "try", "catch", "finally",
                       "new", "this", "super", "extends", "implements", "async", "await",
                       "yield", "of", "in", "typeof", "instanceof", "void", "null", "undefined",
                       "true", "false", "static", "private", "protected", "public", "readonly",
                       "abstract", "as", "any", "string", "number", "boolean", "never", "unknown"],
            lineComment: "//",
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            stringDelimiters: ["\"", "'", "`"]
        )

        static let python = LanguageConfig(
            keywords: ["import", "from", "def", "class", "if", "elif", "else", "for", "while",
                       "return", "yield", "try", "except", "finally", "raise", "with", "as",
                       "pass", "break", "continue", "and", "or", "not", "in", "is", "lambda",
                       "None", "True", "False", "self", "global", "nonlocal", "assert", "del",
                       "async", "await"],
            lineComment: "#",
            blockCommentStart: nil,
            blockCommentEnd: nil,
            stringDelimiters: ["\"", "'"]
        )

        static let go = LanguageConfig(
            keywords: ["package", "import", "func", "var", "const", "type", "struct", "interface",
                       "map", "chan", "if", "else", "switch", "case", "default", "for", "range",
                       "return", "go", "defer", "select", "break", "continue", "fallthrough",
                       "goto", "nil", "true", "false", "make", "new", "len", "cap", "append",
                       "error", "string", "int", "bool", "byte", "float64", "int64"],
            lineComment: "//",
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            stringDelimiters: ["\"", "`"]
        )

        static let rust = LanguageConfig(
            keywords: ["use", "mod", "fn", "let", "mut", "const", "static", "struct", "enum",
                       "trait", "impl", "pub", "crate", "super", "self", "Self", "if", "else",
                       "match", "for", "while", "loop", "return", "break", "continue", "move",
                       "ref", "as", "in", "where", "type", "unsafe", "async", "await", "dyn",
                       "true", "false", "Some", "None", "Ok", "Err"],
            lineComment: "//",
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            stringDelimiters: ["\""]
        )

        static let dart = LanguageConfig(
            keywords: ["import", "library", "part", "class", "abstract", "extends", "implements",
                       "mixin", "with", "enum", "typedef", "if", "else", "switch", "case",
                       "default", "for", "while", "do", "return", "throw", "try", "catch",
                       "finally", "new", "const", "final", "var", "void", "dynamic", "this",
                       "super", "static", "async", "await", "yield", "true", "false", "null",
                       "late", "required", "override", "covariant"],
            lineComment: "//",
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            stringDelimiters: ["\"", "'"]
        )

        static let java = LanguageConfig(
            keywords: ["import", "package", "class", "interface", "enum", "extends", "implements",
                       "public", "private", "protected", "static", "final", "abstract", "void",
                       "if", "else", "switch", "case", "default", "for", "while", "do", "return",
                       "throw", "throws", "try", "catch", "finally", "new", "this", "super",
                       "null", "true", "false", "instanceof", "synchronized", "volatile",
                       "transient", "native", "break", "continue"],
            lineComment: "//",
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            stringDelimiters: ["\""]
        )

        static let shell = LanguageConfig(
            keywords: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done",
                       "case", "esac", "function", "return", "exit", "echo", "export",
                       "local", "readonly", "set", "unset", "shift", "source", "in"],
            lineComment: "#",
            blockCommentStart: nil,
            blockCommentEnd: nil,
            stringDelimiters: ["\"", "'"]
        )

        static let generic = LanguageConfig(
            keywords: [],
            lineComment: nil,
            blockCommentStart: nil,
            blockCommentEnd: nil,
            stringDelimiters: ["\"", "'"]
        )

        static func config(for language: String?) -> LanguageConfig {
            switch language {
            case "swift": return .swift
            case "typescript", "javascript": return .typescript
            case "python": return .python
            case "go": return .go
            case "rust": return .rust
            case "dart": return .dart
            case "java": return .java
            case "shell": return .shell
            default: return .generic
            }
        }
    }

    // MARK: - Colors

    private static let keywordColor = NSColor.systemPurple
    private static let stringColor = NSColor.systemOrange
    private static let commentColor = NSColor.systemGreen
    private static let numberColor = NSColor.systemBlue
    private static let typeColor = NSColor.systemTeal
    private static let defaultColor = NSColor.labelColor

    // MARK: - Highlight

    static func highlight(_ code: String, language: String?) -> NSAttributedString {
        let config = LanguageConfig.config(for: language)
        let baseFont = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        let baseAttrs: [NSAttributedString.Key: Any] = [
            .font: baseFont,
            .foregroundColor: defaultColor
        ]

        let result = NSMutableAttributedString(string: code, attributes: baseAttrs)
        let lines = code.components(separatedBy: "\n")
        var offset = 0
        var inBlockComment = false

        for line in lines {
            let lineLength = line.count
            let lineRange = NSRange(location: offset, length: lineLength)

            if inBlockComment {
                // Continue block comment
                if let endToken = config.blockCommentEnd,
                   let endIdx = line.range(of: endToken) {
                    let endPos = line.distance(from: line.startIndex, to: endIdx.upperBound)
                    result.addAttribute(.foregroundColor, value: commentColor,
                                        range: NSRange(location: offset, length: endPos))
                    inBlockComment = false
                    highlightSegment(line: String(line[endIdx.upperBound...]),
                                     offset: offset + endPos,
                                     config: config, result: result)
                } else {
                    result.addAttribute(.foregroundColor, value: commentColor, range: lineRange)
                }
            } else {
                highlightLine(line, offset: offset, config: config, result: result, inBlockComment: &inBlockComment)
            }

            offset += lineLength + 1 // +1 for newline
        }

        return result
    }

    private static func highlightLine(_ line: String, offset: Int, config: LanguageConfig,
                                       result: NSMutableAttributedString, inBlockComment: inout Bool) {
        // Check for line comment
        if let commentToken = config.lineComment,
           let commentRange = line.range(of: commentToken) {
            let beforeComment = String(line[line.startIndex..<commentRange.lowerBound])
            let commentStart = line.distance(from: line.startIndex, to: commentRange.lowerBound)

            // Only apply if not inside a string
            if !isInsideString(beforeComment, delimiters: config.stringDelimiters) {
                highlightSegment(line: beforeComment, offset: offset, config: config, result: result)
                let commentNSRange = NSRange(location: offset + commentStart, length: line.count - commentStart)
                result.addAttribute(.foregroundColor, value: commentColor, range: commentNSRange)
                return
            }
        }

        // Check for block comment start
        if let startToken = config.blockCommentStart,
           let startRange = line.range(of: startToken) {
            let beforeBlock = String(line[line.startIndex..<startRange.lowerBound])
            let blockStart = line.distance(from: line.startIndex, to: startRange.lowerBound)

            if !isInsideString(beforeBlock, delimiters: config.stringDelimiters) {
                highlightSegment(line: beforeBlock, offset: offset, config: config, result: result)

                let afterStart = String(line[startRange.lowerBound...])
                if let endToken = config.blockCommentEnd,
                   let endRange = afterStart.range(of: endToken, range: afterStart.index(afterStart.startIndex, offsetBy: startToken.count)..<afterStart.endIndex) {
                    let endPos = afterStart.distance(from: afterStart.startIndex, to: endRange.upperBound)
                    result.addAttribute(.foregroundColor, value: commentColor,
                                        range: NSRange(location: offset + blockStart, length: endPos))
                    let remaining = String(afterStart[endRange.upperBound...])
                    highlightSegment(line: remaining, offset: offset + blockStart + endPos,
                                     config: config, result: result)
                } else {
                    result.addAttribute(.foregroundColor, value: commentColor,
                                        range: NSRange(location: offset + blockStart, length: line.count - blockStart))
                    inBlockComment = true
                }
                return
            }
        }

        highlightSegment(line: line, offset: offset, config: config, result: result)
    }

    private static func highlightSegment(line: String, offset: Int, config: LanguageConfig,
                                          result: NSMutableAttributedString) {
        // Strings
        highlightStrings(in: line, offset: offset, delimiters: config.stringDelimiters, result: result)

        // Keywords + types + numbers (word-by-word)
        let scanner = Scanner(string: line)
        scanner.charactersToBeSkipped = nil
        let wordChars = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_@"))

        while !scanner.isAtEnd {
            if let nonWord = scanner.scanUpToCharacters(from: wordChars) {
                // skip
                _ = nonWord
            }
            let wordStart = scanner.currentIndex
            if let word = scanner.scanCharacters(from: wordChars) {
                let wordOffset = line.distance(from: line.startIndex, to: wordStart)
                let nsRange = NSRange(location: offset + wordOffset, length: word.count)

                // Don't override string-highlighted ranges
                var existingColor: NSColor?
                if nsRange.location < result.length {
                    existingColor = result.attribute(.foregroundColor, at: nsRange.location, effectiveRange: nil) as? NSColor
                }
                if existingColor == stringColor || existingColor == commentColor {
                    continue
                }

                if config.keywords.contains(word) {
                    result.addAttribute(.foregroundColor, value: keywordColor, range: nsRange)
                } else if word.first?.isUppercase == true && word.count > 1 && !word.allSatisfy({ $0.isUppercase || $0 == "_" }) {
                    result.addAttribute(.foregroundColor, value: typeColor, range: nsRange)
                } else if word.first?.isNumber == true {
                    result.addAttribute(.foregroundColor, value: numberColor, range: nsRange)
                }
            }
        }
    }

    private static func highlightStrings(in line: String, offset: Int, delimiters: [Character],
                                          result: NSMutableAttributedString) {
        var i = line.startIndex
        while i < line.endIndex {
            let ch = line[i]
            if delimiters.contains(ch) {
                let startPos = line.distance(from: line.startIndex, to: i)
                var j = line.index(after: i)
                while j < line.endIndex {
                    if line[j] == "\\" {
                        j = line.index(after: j)
                        if j < line.endIndex { j = line.index(after: j) }
                        continue
                    }
                    if line[j] == ch {
                        j = line.index(after: j)
                        break
                    }
                    j = line.index(after: j)
                }
                let endPos = line.distance(from: line.startIndex, to: j)
                let nsRange = NSRange(location: offset + startPos, length: endPos - startPos)
                result.addAttribute(.foregroundColor, value: stringColor, range: nsRange)
                i = j
                continue
            }
            i = line.index(after: i)
        }
    }

    private static func isInsideString(_ text: String, delimiters: [Character]) -> Bool {
        var openDelimiter: Character?
        for (idx, ch) in text.enumerated() {
            if ch == "\\" { continue }
            if let open = openDelimiter {
                if ch == open {
                    // Check previous char isn't escape
                    let prevIdx = text.index(text.startIndex, offsetBy: idx - 1, limitedBy: text.startIndex)
                    if let prev = prevIdx, text[prev] == "\\" { continue }
                    openDelimiter = nil
                }
            } else if delimiters.contains(ch) {
                openDelimiter = ch
            }
        }
        return openDelimiter != nil
    }
}
